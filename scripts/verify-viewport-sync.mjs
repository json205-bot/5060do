import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// Proves the 5060do client half of the Gojigi viewport sync protocol
// (5060DO-20261110-1430). The previewed page is served on one port and the
// harness on another, so the iframe is genuinely cross origin: the helper must
// work through postMessage alone.
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT_DIR = process.cwd();
const OUT_DIR = path.resolve(ROOT_DIR, "out");
const BASE_PATH = "/5060do";
const SITE_PORT = Number(process.env.SYNC_SITE_PORT ?? 3112);
const HARNESS_PORT = Number(process.env.SYNC_HARNESS_PORT ?? 3113);
const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;
const HARNESS_ORIGIN = `http://127.0.0.1:${HARNESS_PORT}`;
const CHILD_URL = `${SITE_ORIGIN}${BASE_PATH}/`;
const HARNESS_URL = `${HARNESS_ORIGIN}/harness.html`;
const OUT_EVIDENCE = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "viewport-sync-20261110"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9372);
const PROFILE_DIR = path.join(tmpdir(), `5060do-vpsync-${Date.now()}`);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
        return;
      }
      const handlers = this.listeners.get(message.method) ?? [];
      for (const handler of handlers) handler(message.params, message.sessionId);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timeout`)), timeoutMs);
      const handler = (params) => {
        clearTimeout(timer);
        const handlers = this.listeners.get(method) ?? [];
        this.listeners.set(
          method,
          handlers.filter((entry) => entry !== handler),
        );
        resolve(params);
      };
      this.on(method, handler);
    });
  }
}

async function waitForEndpoint(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`endpoint not ready: ${url}`);
}

function startSiteServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", SITE_ORIGIN);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === BASE_PATH) {
        response.writeHead(302, { location: `${BASE_PATH}/` });
        response.end();
        return;
      }
      if (!pathname.startsWith(`${BASE_PATH}/`)) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      const relative = pathname.slice(BASE_PATH.length);
      let filePath = path.resolve(OUT_DIR, `.${relative}`);
      if (!filePath.startsWith(OUT_DIR)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      let info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        info = await stat(filePath).catch(() => null);
      }
      if (!info?.isFile()) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(SITE_PORT, "127.0.0.1", () => resolve(server));
  });
}

const HARNESS_HTML = `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>5060do viewport sync harness</title></head>
<body style="margin:0">
<iframe id="child" src="${CHILD_URL}" title="child" width="390" height="844" style="border:0"></iframe>
<script>
window.__messages = [];
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'gojigi-viewport-frame') return;
  window.__messages.push({
    type: data.type,
    href: typeof data.href === 'string' ? data.href : null,
    url: typeof data.url === 'string' ? data.url : null,
    scroll: typeof data.scroll === 'number' ? data.scroll : null,
    at: Date.now(),
  });
});
</script>
</body>
</html>`;

function startHarnessServer() {
  const server = createServer((request, response) => {
    if ((request.url ?? "/") !== "/harness.html") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(HARNESS_HTML);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(HARNESS_PORT, "127.0.0.1", () => resolve(server));
  });
}

const evaluate = async (cdp, sessionId, expression) => {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${result.exceptionDetails.text} ${JSON.stringify(
        result.exceptionDetails.exception?.description ?? "",
      )}`,
    );
  }
  return result.result.value;
};

const evaluateInFrame = async (cdp, sessionId, frameId, expression) => {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true, contextId: frameId },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      `frame evaluate failed: ${result.exceptionDetails.text} ${JSON.stringify(
        result.exceptionDetails.exception?.description ?? "",
      )}`,
    );
  }
  return result.result.value;
};

const screenshot = async (cdp, sessionId, fileName) => {
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId,
  );
  const filePath = path.join(OUT_EVIDENCE, fileName);
  await writeFile(filePath, Buffer.from(data, "base64"));
  return path.relative(ROOT_DIR, filePath);
};

async function waitForChildFrame(cdp, sessionId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { frameTree } = await cdp.send("Page.getFrameTree", {}, sessionId);
    const child = (frameTree.childFrames ?? []).find((entry) =>
      entry.frame.url.startsWith(CHILD_URL),
    );
    if (child) return child.frame.id;
    await sleep(200);
  }
  throw new Error("child iframe frame was not found");
}

async function waitForContext(cdp, frameId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const contextId = cdp.frameContexts?.get(frameId);
    if (contextId !== undefined) return contextId;
    await sleep(150);
  }
  throw new Error(`execution context for ${frameId} was not found`);
}

async function main() {
  if (!existsSync(path.join(OUT_DIR, "index.html"))) {
    throw new Error("out/index.html is missing. Run `npm run build` first.");
  }
  await mkdir(OUT_EVIDENCE, { recursive: true });

  const siteServer = await startSiteServer();
  const harnessServer = await startHarnessServer();
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const results = {
    childUrl: CHILD_URL,
    harnessUrl: HARNESS_URL,
    checkedAt: new Date().toISOString(),
    checks: [],
    console: [],
  };
  const check = (name, pass, detail) => {
    results.checks.push({ name, pass: Boolean(pass), detail });
  };

  try {
    const version = await waitForEndpoint(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", reject);
    });
    const cdp = new Cdp(socket);
    cdp.frameContexts = new Map();
    cdp.on("Runtime.executionContextCreated", (params) => {
      const aux = params.context.auxData ?? {};
      if (aux.frameId && aux.isDefault) {
        cdp.frameContexts.set(aux.frameId, params.context.id);
      }
    });
    cdp.on("Runtime.executionContextDestroyed", (params) => {
      for (const [frameId, contextId] of cdp.frameContexts) {
        if (contextId === params.executionContextId) cdp.frameContexts.delete(frameId);
      }
    });
    cdp.on("Runtime.consoleAPICalled", (params) => {
      results.console.push({
        type: params.type,
        text: params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
      });
    });

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 900, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

    const harnessLoaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: HARNESS_URL }, sessionId);
    await harnessLoaded;
    await sleep(2500);

    const childFrameId = await waitForChildFrame(cdp, sessionId);
    const childContextId = await waitForContext(cdp, childFrameId);
    cdp.on("Runtime.executionContextCreated", (params) => {
      const aux = params.context.auxData ?? {};
      if (aux.frameId === childFrameId && aux.isDefault) {
        cdp.frameContexts.set(childFrameId, params.context.id);
      }
    });

    const childState = await evaluateInFrame(
      cdp,
      sessionId,
      childContextId,
      `(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return {
          href: window.location.href,
          embedded: window.self !== window.top,
          readyState: document.readyState,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
          scrollTop: root.scrollTop,
        };
      })()`,
    );
    results.childState = childState;
    check("cross-origin iframe 안에서 실행", childState.embedded === true, childState);
    check(
      "스크롤 가능한 문서 높이",
      childState.scrollHeight > childState.clientHeight + 200,
      { scrollHeight: childState.scrollHeight, clientHeight: childState.clientHeight },
    );

    const messages = () => evaluate(cdp, sessionId, "window.__messages.slice()");
    const clearMessages = () => evaluate(cdp, sessionId, "window.__messages.length = 0");
    const lastOf = (list, type) => [...list].reverse().find((entry) => entry.type === type);

    const initialMessages = await messages();
    results.initialMessages = initialMessages;
    const ready = lastOf(initialMessages, "frame:ready");
    check(
      "frame:ready 수신 (source/href)",
      Boolean(ready && ready.href && ready.href.startsWith(CHILD_URL)),
      ready ?? null,
    );

    await clearMessages();
    const childRatioAfterScroll = await evaluateInFrame(
      cdp,
      sessionId,
      childContextId,
      `(() => {
        const root = document.scrollingElement ?? document.documentElement;
        const max = root.scrollHeight - root.clientHeight;
        const top = Math.round(max * 0.6);
        window.scrollTo({ top, behavior: 'instant' });
        return { max, top, ratio: root.scrollTop / max };
      })()`,
    );
    await sleep(700);
    const scrollMessages = await messages();
    results.scrollMessages = scrollMessages;
    const scrollOut = lastOf(scrollMessages, "frame:scroll");
    check(
      "frame:scroll 송신 (진행률 0.6)",
      Boolean(
        scrollOut &&
          typeof scrollOut.scroll === "number" &&
          Math.abs(scrollOut.scroll - childRatioAfterScroll.ratio) < 0.05,
      ),
      { message: scrollOut ?? null, child: childRatioAfterScroll },
    );

    await sleep(300);
    const beforeParentScroll = (await messages()).filter(
      (entry) => entry.type === "frame:scroll",
    ).length;
    const posted = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const frame = document.getElementById('child');
        frame.contentWindow.postMessage(
          { source: 'gojigi-viewport-sync', type: 'parent:scroll', scroll: 0.25 },
          '*',
        );
        return true;
      })()`,
    );
    await sleep(800);
    const childRatioAfterParent = await evaluateInFrame(
      cdp,
      sessionId,
      childContextId,
      `(() => {
        const root = document.scrollingElement ?? document.documentElement;
        const max = root.scrollHeight - root.clientHeight;
        return { ratio: max > 0 ? root.scrollTop / max : 0, scrollTop: root.scrollTop, max };
      })()`,
    );
    const afterParentScroll = (await messages()).filter(
      (entry) => entry.type === "frame:scroll",
    ).length;
    results.parentScroll = {
      posted,
      child: childRatioAfterParent,
      outboundBefore: beforeParentScroll,
      outboundAfter: afterParentScroll,
    };
    check(
      "parent:scroll 수신 후 0.25 반영",
      Math.abs(childRatioAfterParent.ratio - 0.25) < 0.02,
      childRatioAfterParent,
    );
    check(
      "수신 스크롤 재송신 없음 (루프 방지)",
      afterParentScroll === beforeParentScroll,
      { before: beforeParentScroll, after: afterParentScroll },
    );

    await clearMessages();
    const pushStateHref = await evaluateInFrame(
      cdp,
      sessionId,
      childContextId,
      `(() => {
        history.pushState({ probe: true }, '', '${BASE_PATH}/classic/');
        return window.location.href;
      })()`,
    );
    await sleep(500);
    const pushStateMessages = await messages();
    const pushNav = lastOf(pushStateMessages, "frame:navigate");
    const pushReady = lastOf(pushStateMessages, "frame:ready");
    results.pushState = {
      href: pushStateHref,
      messages: pushStateMessages,
    };
    check(
      "pushState 이동을 frame:navigate로 송신",
      Boolean(pushNav && pushNav.url && pushNav.url.includes(`${BASE_PATH}/classic/`)),
      pushNav ?? null,
    );
    check(
      "라우트 변경 시 frame:ready도 송신",
      Boolean(pushReady && pushReady.href && pushReady.href.includes(`${BASE_PATH}/classic/`)),
      pushReady ?? null,
    );

    await clearMessages();
    const backHref = await evaluateInFrame(
      cdp,
      sessionId,
      childContextId,
      "(() => { history.back(); return true; })()",
    );
    await sleep(600);
    const backMessages = await messages();
    const backNav = lastOf(backMessages, "frame:navigate");
    results.popState = { backHref, messages: backMessages };
    check(
      "popstate 이동을 frame:navigate로 송신",
      Boolean(backNav && backNav.url && backNav.url.endsWith(`${BASE_PATH}/`)),
      backNav ?? null,
    );

    await clearMessages();
    await evaluateInFrame(
      cdp,
      sessionId,
      childContextId,
      `(() => { window.location.href = '${BASE_PATH}/classic/'; return true; })()`,
    );
    await sleep(2500);
    const reloadMessages = await messages();
    const reloadReady = lastOf(reloadMessages, "frame:ready");
    results.reloadNavigation = reloadMessages;
    check(
      "문서 이동 후 frame:ready 재수신",
      Boolean(reloadReady && reloadReady.href && reloadReady.href.includes(`${BASE_PATH}/classic/`)),
      reloadReady ?? null,
    );

    const topLevelMessages = await (async () => {
      const top = await cdp.send("Target.createTarget", { url: "about:blank" });
      const topSession = await cdp.send("Target.attachToTarget", {
        targetId: top.targetId,
        flatten: true,
      });
      await cdp.send("Page.enable", {}, topSession.sessionId);
      await cdp.send("Runtime.enable", {}, topSession.sessionId);
      await cdp.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source:
            "window.__syncMessages = [];window.addEventListener('message',function(e){if(e.data&&e.data.source==='gojigi-viewport-frame')window.__syncMessages.push(e.data);});",
        },
        topSession.sessionId,
      );
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: `${SITE_ORIGIN}${BASE_PATH}/` }, topSession.sessionId);
      await loaded;
      await sleep(1500);
      const seen = await evaluate(cdp, topSession.sessionId, "window.__syncMessages.slice()");
      const state = await evaluate(
        cdp,
        topSession.sessionId,
        `({ href: window.location.href, embedded: window.self !== window.top })`,
      );
      await cdp.send("Target.closeTarget", { targetId: top.targetId });
      return { seen, state };
    })();
    results.topLevel = topLevelMessages;
    check(
      "iframe 밖에서는 리스너 비활성화",
      topLevelMessages.state.embedded === false && topLevelMessages.seen.length === 0,
      { state: topLevelMessages.state, messageCount: topLevelMessages.seen.length },
    );

    results.screenshots = [await screenshot(cdp, sessionId, "viewport-sync-harness.png")];
    results.pageErrors = results.console.filter((entry) => entry.type === "error");
  } finally {
    chrome.kill();
    siteServer.close();
    harnessServer.close();
  }

  const failed = results.checks.filter((entry) => !entry.pass);
  results.passed = results.checks.length - failed.length;
  results.total = results.checks.length;
  await writeFile(
    path.join(OUT_EVIDENCE, "verification.json"),
    JSON.stringify(results, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(results, null, 2));
  if (failed.length > 0) {
    console.error(`FAILED ${failed.length}/${results.checks.length}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

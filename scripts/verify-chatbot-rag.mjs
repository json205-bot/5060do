import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// End-to-end check of the chatbot knowledge path. The question is chosen so no
// keyword rule or program-title match intercepts it, which forces the widget to
// use the RAG search. --mode=rpc builds with NEXT_PUBLIC_RAG_SOURCE=supabase and
// expects a real match_documents request; --mode=bundle expects no RPC call.
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = path.resolve("out");
const HOST = "127.0.0.1";
const PORT = Number(process.env.CHATBOT_RAG_PORT ?? 3213);
const DEBUG_PORT = Number(process.env.CHATBOT_RAG_DEBUG_PORT ?? 9363);
const PROFILE_DIR = path.join(tmpdir(), `5060do-chatbot-rag-${Date.now()}`);
const QUESTION = "센터는 언제 문을 열었나요?";
const EXPECTED = "연혁";

const argValue = (name) => {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const MODE = argValue("--mode") ?? "bundle";
const BUILD = process.argv.includes("--build");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const OUT_DIR = path.resolve(
  argValue("--out") ?? path.join("docs", "evidence", `chatbot-rag-${stamp}`),
);

if (MODE !== "bundle" && MODE !== "rpc") {
  console.error(`unknown --mode=${MODE} (bundle|rpc)`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

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
      for (const handler of this.listeners.get(message.method) ?? []) {
        handler(message.params);
      }
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

  once(method, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timeout`)),
        timeoutMs,
      );
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
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error(`endpoint not ready: ${url}`);
}

async function buildSite() {
  const env = { ...process.env, VERCEL: "1", NEXT_PUBLIC_BASE_PATH: "" };
  delete env.NEXT_PUBLIC_RAG_SOURCE;
  if (MODE === "rpc") env.NEXT_PUBLIC_RAG_SOURCE = "supabase";

  console.log(`[build] mode=${MODE} ragSource=${env.NEXT_PUBLIC_RAG_SOURCE ?? "(unset)"}`);
  const build = spawnSync(
    process.execPath,
    [path.join("node_modules", "next", "dist", "bin", "next"), "build"],
    { stdio: "inherit", env },
  );
  if (build.status !== 0) {
    throw new Error(`next build failed with exit ${build.status}`);
  }
  const post = spawnSync(
    process.execPath,
    [path.join("scripts", "postbuild-static-rsc.mjs")],
    { stdio: "inherit", env },
  );
  if (post.status !== 0) {
    throw new Error(`postbuild failed with exit ${post.status}`);
  }
}

async function serve() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      let filePath = path.join(ROOT, pathname);
      if (!filePath.startsWith(ROOT)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      let info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        info = await stat(filePath).catch(() => null);
      }
      if (!info?.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      const data = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type":
          MIME[path.extname(filePath).toLowerCase()] ??
          "application/octet-stream",
        "Content-Length": data.length,
      });
      response.end(data);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
  return server;
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

const LAST_BOT = `(() => {
  const nodes = Array.from(
    document.querySelectorAll('[data-testid="chatbot-message"][data-role="bot"]'),
  );
  const last = nodes[nodes.length - 1];
  if (!last) return null;
  return {
    count: nodes.length,
    text: (last.querySelector('p')?.textContent || '').replace(/\\s+/g, ' ').trim(),
    ragSource: last.getAttribute('data-rag-source'),
  };
})()`;

async function main() {
  if (BUILD) await buildSite();
  if (!(await stat(path.join(ROOT, "index.html")).catch(() => null))) {
    throw new Error("out/index.html missing. Run with --build or build first.");
  }
  await mkdir(OUT_DIR, { recursive: true });

  const server = await serve();
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

  const rpcRequests = [];
  const rpcResponses = [];
  const consoleErrors = [];
  let reply = null;

  try {
    const version = await waitForEndpoint(
      `http://127.0.0.1:${DEBUG_PORT}/json/version`,
    );
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", reject);
    });
    const cdp = new Cdp(socket);

    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });

    cdp.on("Network.requestWillBeSent", (params) => {
      if (params.request?.url?.includes("/rest/v1/rpc/match_documents")) {
        rpcRequests.push(params.request.url);
      }
    });
    cdp.on("Network.responseReceived", (params) => {
      if (params.response?.url?.includes("/rest/v1/rpc/match_documents")) {
        rpcResponses.push({
          url: params.response.url,
          status: params.response.status,
        });
      }
    });
    cdp.on("Runtime.exceptionThrown", (params) => {
      consoleErrors.push({
        type: "exception",
        text: params.exceptionDetails?.text ?? "unknown",
      });
    });
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        consoleErrors.push({
          type: "error",
          text: params.args
            .map((arg) => arg.value ?? arg.description ?? arg.type)
            .join(" "),
        });
      }
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 900, deviceScaleFactor: 1, mobile: true },
      sessionId,
    );

    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `http://${HOST}:${PORT}/` }, sessionId);
    await loaded;
    await sleep(1000);

    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const trigger = document.querySelector('[data-testid="chatbot-trigger"]');
        if (!trigger) throw new Error('chatbot trigger missing');
        trigger.click();
        return true;
      })()`,
    );
    await sleep(500);

    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.querySelector('[data-testid="chatbot-input"]');
        const send = document.querySelector('[data-testid="chatbot-send"]');
        if (!input || !send) throw new Error('chatbot input missing');
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        ).set;
        setter.call(input, ${JSON.stringify(QUESTION)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        send.click();
        return true;
      })()`,
    );

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      reply = await evaluate(cdp, sessionId, LAST_BOT);
      if (reply && reply.count >= 2 && reply.text.includes(EXPECTED)) break;
      await sleep(250);
    }

    const checks = [
      {
        name: "RAG 답변이 연혁 문서를 반환",
        pass: Boolean(reply?.text?.includes(EXPECTED)),
        detail: reply?.text?.slice(0, 160),
      },
      {
        name: `ragSource=${MODE}`,
        pass: reply?.ragSource === MODE,
        detail: reply?.ragSource,
      },
      {
        name:
          MODE === "rpc"
            ? "match_documents RPC 호출 200"
            : "번들 모드에서 RPC 호출 없음",
        pass:
          MODE === "rpc"
            ? rpcResponses.some((item) => item.status === 200)
            : rpcRequests.length === 0,
        detail:
          MODE === "rpc"
            ? rpcResponses.map((item) => item.status)
            : rpcRequests.length,
      },
      {
        name: "콘솔 예외 없음",
        pass: consoleErrors.length === 0,
        detail: consoleErrors,
      },
    ];

    const report = {
      mode: MODE,
      question: QUESTION,
      expected: EXPECTED,
      reply,
      rpcRequests,
      rpcResponses,
      consoleErrors,
      checks,
      pass: checks.every((check) => check.pass),
      checkedAt: new Date().toISOString(),
    };

    await writeFile(
      path.join(OUT_DIR, `chatbot-rag-${MODE}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    for (const check of checks) {
      console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
    }
    console.log(
      `${report.pass ? "PASS" : "FAIL"} chatbot-rag mode=${MODE} source=${reply?.ragSource ?? "n/a"}`,
    );
    console.log(`evidence=${OUT_DIR}`);

    if (!report.pass) process.exitCode = 1;
  } finally {
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

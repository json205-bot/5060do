import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// Serves the static export with the /5060do prefix that the NAS deployment uses,
// then drives headless Chrome over CDP to prove every viewport frame renders and
// that the URL, scale, rotation and anchor controls work.
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT_DIR = process.cwd();
const OUT_DIR = path.resolve(ROOT_DIR, "out");
const BASE_PATH = "/5060do";
const PORT = Number(process.env.PORT ?? 3102);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${ORIGIN}${BASE_PATH}/tools/viewport-tester/`;
const OUT_EVIDENCE = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "viewport-tester-20261110"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9361);
const PROFILE_DIR = path.join(tmpdir(), `5060do-vpt-${Date.now()}`);

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

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", ORIGIN);
      let pathname = decodeURIComponent(url.pathname);
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
      let relative = pathname.slice(BASE_PATH.length);
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
    server.listen(PORT, "127.0.0.1", () => resolve(server));
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

const setInputValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const METRICS_EXPRESSION = `(() => {
  const frames = Array.from(document.querySelectorAll('[data-testid^="device-frame-"]'));
  const read = (id) => document.querySelector('[data-testid="' + id + '"]');
  const iframes = Array.from(document.querySelectorAll('article iframe')).map((el) => {
    let doc = null;
    try { doc = el.contentDocument; } catch { doc = null; }
    return {
      title: el.getAttribute('title'),
      src: el.getAttribute('src'),
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      loaded: Boolean(doc && doc.body && doc.body.childElementCount > 0),
      documentTitle: doc ? doc.title : null,
    };
  });
  return {
    title: document.querySelector('h1')?.textContent?.trim() ?? null,
    frameCount: frames.length,
    frames: frames.map((frame) => ({
      id: (frame.getAttribute('data-testid') || '').replace('device-frame-', ''),
      width: Number(frame.dataset.width),
      height: Number(frame.dataset.height),
      orientation: frame.dataset.orientation,
      renderedWidth: Math.round(frame.getBoundingClientRect().width),
      renderedHeight: Math.round(frame.getBoundingClientRect().height),
      transform: getComputedStyle(frame).transform,
    })),
    iframeCount: iframes.length,
    iframes,
    scaleValue: read('scale-value')?.textContent?.trim() ?? null,
    sliderMin: read('scale-slider')?.getAttribute('min') ?? null,
    sliderMax: read('scale-slider')?.getAttribute('max') ?? null,
    sliderValue: read('scale-slider')?.value ?? null,
    appliedUrl: read('applied-url')?.textContent?.trim() ?? null,
    quickNav: Array.from(document.querySelectorAll('[data-testid^="quick-nav-"]')).map((a) => ({
      testId: a.getAttribute('data-testid'),
      href: a.getAttribute('href'),
    })),
    sections: ['mobile', 'tablet', 'fold'].map((key) => {
      const section = document.getElementById(key);
      return {
        key,
        exists: Boolean(section),
        heading: section?.querySelector('h2')?.textContent?.trim() ?? null,
        frameCount: section ? section.querySelectorAll('[data-testid^="device-frame-"]').length : 0,
      };
    }),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
  };
})()`;

async function main() {
  if (!existsSync(path.join(OUT_DIR, "tools", "viewport-tester", "index.html"))) {
    throw new Error(
      "out/tools/viewport-tester/index.html is missing. Run `npm run build` first.",
    );
  }
  await mkdir(OUT_EVIDENCE, { recursive: true });

  const server = await startStaticServer();
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
    pageUrl: PAGE_URL,
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

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    cdp.on("Runtime.consoleAPICalled", (params) => {
      results.console.push({
        type: params.type,
        text: params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
      });
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: PAGE_URL }, sessionId);
    await loaded;
    await sleep(2500);

    const initial = await evaluate(cdp, sessionId, METRICS_EXPRESSION);
    results.initial = initial;
    results.screenshots = [];
    results.screenshots.push(await screenshot(cdp, sessionId, "viewport-tester-top.png"));

    check("페이지 제목", initial.title === "멀티 뷰포트 테스터", initial.title);
    check("디바이스 프레임 8개", initial.frameCount === 8, initial.frameCount);
    check("iframe 8개", initial.iframeCount === 8, initial.iframeCount);
    check(
      "8개 iframe 모두 동일 출처 로드",
      initial.iframes.every((frame) => frame.loaded && frame.src === "/5060do/"),
      initial.iframes.map((frame) => ({ src: frame.src, loaded: frame.loaded })),
    );

    const expected = [
      ["phone-portrait", 390, 844, "portrait"],
      ["phone-landscape", 844, 390, "landscape"],
      ["tablet-portrait", 820, 1180, "portrait"],
      ["tablet-landscape", 1180, 820, "landscape"],
      ["fold-cover-portrait", 416, 968, "portrait"],
      ["fold-cover-landscape", 968, 416, "landscape"],
      ["fold-main-portrait", 892, 1076, "portrait"],
      ["fold-main-landscape", 1076, 892, "landscape"],
    ];
    for (const [id, width, height, orientation] of expected) {
      const frame = initial.frames.find((entry) => entry.id === id);
      check(
        `프레임 사양 ${id}`,
        Boolean(
          frame &&
            frame.width === width &&
            frame.height === height &&
            frame.orientation === orientation,
        ),
        frame,
      );
    }
    check(
      "섹션별 프레임 수 2·2·4",
      initial.sections.map((section) => section.frameCount).join(",") === "2,2,4",
      initial.sections,
    );
    check(
      "빠른 네비게이션 3개",
      initial.quickNav.length === 3 &&
        initial.quickNav.every((entry) => entry.href === `#${entry.testId.replace("quick-nav-", "")}`),
      initial.quickNav,
    );
    check("슬라이더 범위 40~100", initial.sliderMin === "40" && initial.sliderMax === "100", {
      min: initial.sliderMin,
      max: initial.sliderMax,
    });
    check("기본 배율 60%", initial.scaleValue === "60%", initial.scaleValue);
    check("가로 오버플로 없음", initial.horizontalOverflow === false, initial.horizontalOverflow);

    await evaluate(cdp, sessionId, setInputValue('[data-testid="scale-slider"]', "40"));
    await sleep(400);
    const scaledDown = await evaluate(cdp, sessionId, METRICS_EXPRESSION);
    results.scaledDown = {
      scaleValue: scaledDown.scaleValue,
      firstFrame: scaledDown.frames[0],
    };
    check(
      "배율 40% 적용",
      scaledDown.scaleValue === "40%" &&
        scaledDown.frames[0].transform.startsWith("matrix(0.4"),
      results.scaledDown,
    );

    await evaluate(cdp, sessionId, setInputValue('[data-testid="scale-slider"]', "100"));
    await sleep(400);
    const scaledUp = await evaluate(cdp, sessionId, METRICS_EXPRESSION);
    results.scaledUp = { scaleValue: scaledUp.scaleValue, firstFrame: scaledUp.frames[0] };
    check(
      "배율 100% 적용",
      scaledUp.scaleValue === "100%" &&
        scaledUp.frames[0].transform.startsWith("matrix(1, 0, 0, 1"),
      results.scaledUp,
    );

    await evaluate(cdp, sessionId, setInputValue('[data-testid="scale-slider"]', "60"));
    await sleep(300);

    const urlSet = await evaluate(
      cdp,
      sessionId,
      setInputValue('[data-testid="target-url-input"]', "/5060do/classic/"),
    );
    await evaluate(cdp, sessionId, `document.querySelector('[data-testid="apply-url"]').click()`);
    await sleep(2500);
    const afterApply = await evaluate(cdp, sessionId, METRICS_EXPRESSION);
    results.afterApply = {
      inputSet: urlSet,
      appliedUrl: afterApply.appliedUrl,
      iframes: afterApply.iframes.map((frame) => ({
        src: frame.src,
        loaded: frame.loaded,
        title: frame.documentTitle,
      })),
    };
    check(
      "URL 적용 후 8개 iframe 갱신",
      afterApply.iframes.length === 8 &&
        afterApply.iframes.every(
          (frame) => frame.src === "/5060do/classic/" && frame.loaded,
        ),
      results.afterApply,
    );

    await evaluate(cdp, sessionId, `document.querySelector('[data-testid="refresh-all"]').click()`);
    await sleep(1800);
    const afterRefresh = await evaluate(cdp, sessionId, METRICS_EXPRESSION);
    results.afterRefresh = {
      iframes: afterRefresh.iframes.map((frame) => ({ src: frame.src, loaded: frame.loaded })),
    };
    check(
      "전체 새로고침 후 8개 재로드",
      afterRefresh.iframes.length === 8 && afterRefresh.iframes.every((frame) => frame.loaded),
      results.afterRefresh,
    );

    await evaluate(cdp, sessionId, `document.querySelector('[data-testid="device-rotate-phone-portrait"]').click()`);
    await sleep(500);
    const rotated = await evaluate(cdp, sessionId, METRICS_EXPRESSION);
    const rotatedFrame = rotated.frames.find((frame) => frame.id === "phone-portrait");
    results.rotated = rotatedFrame;
    check(
      "개별 회전 토글 844×390",
      Boolean(
        rotatedFrame &&
          rotatedFrame.width === 844 &&
          rotatedFrame.height === 390 &&
          rotatedFrame.orientation === "landscape",
      ),
      rotatedFrame,
    );

    await evaluate(cdp, sessionId, `document.querySelector('[data-testid="quick-nav-fold"]').click()`);
    await sleep(1200);
    const anchorState = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const section = document.getElementById('fold');
        const header = document.querySelector('header');
        return {
          hash: window.location.hash,
          scrollY: Math.round(window.scrollY),
          foldTop: section ? Math.round(section.getBoundingClientRect().top) : null,
          headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : null,
        };
      })()`,
    );
    results.anchor = anchorState;
    check(
      "빠른 네비게이션 폴드 점프",
      anchorState.hash === "#fold" &&
        anchorState.foldTop !== null &&
        anchorState.headerBottom !== null &&
        anchorState.foldTop >= anchorState.headerBottom - 8 &&
        anchorState.foldTop <= anchorState.headerBottom + 96,
      anchorState,
    );
    results.screenshots.push(await screenshot(cdp, sessionId, "viewport-tester-fold.png"));

    await evaluate(cdp, sessionId, `document.getElementById('tablet').scrollIntoView({ block: 'start', behavior: 'instant' })`);
    await sleep(600);
    results.screenshots.push(await screenshot(cdp, sessionId, "viewport-tester-tablet.png"));

    await evaluate(cdp, sessionId, setInputValue('[data-testid="target-url-input"]', "https://example.com/"));
    await evaluate(cdp, sessionId, `document.querySelector('[data-testid="apply-url"]').click()`);
    await sleep(600);
    const crossOrigin = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const note = document.querySelector('[data-testid="origin-note"]');
        return {
          note: note ? note.textContent.replace(/\\s+/g, ' ').trim() : null,
          appliedUrl: document.querySelector('[data-testid="applied-url"]')?.textContent?.trim() ?? null,
        };
      })()`,
    );
    results.crossOrigin = crossOrigin;
    check(
      "교차 출처 안내 표시",
      Boolean(crossOrigin.note && crossOrigin.note.includes("교차 출처")) &&
        Boolean(crossOrigin.appliedUrl && crossOrigin.appliedUrl.includes("https://example.com/")),
      crossOrigin,
    );

    results.pageErrors = results.console.filter((entry) => entry.type === "error");
  } finally {
    chrome.kill();
    server.close();
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
    console.error(`FAIL ${failed.length}/${results.checks.length}`);
    process.exit(1);
  }
  console.log(`PASS ${results.passed}/${results.total}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

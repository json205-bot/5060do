import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Verifies a real Vercel deployment (root basePath) end to end. With no URL
// argument it rebuilds the Vercel-style static export and verifies a local
// preview, which covers the same routes and browser behaviour before the
// project is imported into Vercel.
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// Accept the live URL from `--url <value>`, `--url=<value>`, a bare URL
// argument, `VERCEL_LIVE_URL`, or Vercel's own `VERCEL_URL` (host only).
const readUrlArgument = (argv) => {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--url") return argv[index + 1] ?? "";
    if (argument.startsWith("--url=")) return argument.slice("--url=".length);
  }
  return "";
};
const normalizeTarget = (value) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
};
const TARGET_URL = normalizeTarget(
  readUrlArgument(process.argv) ||
    process.argv.find((argument) => /^https?:\/\//.test(argument)) ||
    process.env.VERCEL_LIVE_URL ||
    process.env.VERCEL_URL,
);
const REMOTE = TARGET_URL.length > 0;
const SKIP_BUILD = process.argv.includes("--no-build") || process.env.SKIP_BUILD === "1";
const PORT = Number(process.env.LIVE_VERIFY_PORT ?? 3112);
const DEBUG_PORT = Number(process.env.LIVE_VERIFY_DEBUG_PORT ?? 9337);
const PROFILE_DIR = path.join(tmpdir(), `5060do-vercel-live-${Date.now()}`);
const ROOT = path.resolve("out");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", `vercel-live-${stamp}`),
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

async function serveStatic() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
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
          MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
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
    server.listen(PORT, "127.0.0.1", resolve);
  });
  return server;
}

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

  once(method, timeoutMs = 25000) {
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

async function waitForEndpoint(url, timeoutMs = 25000) {
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

async function waitForCondition(cdp, sessionId, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return true;
    await sleep(250);
  }
  return false;
}

const screenshot = async (cdp, sessionId, fileName) => {
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId,
  );
  await writeFile(path.join(OUT_DIR, fileName), Buffer.from(data, "base64"));
};

// External links such as https://blog.naver.com/5060do are legitimate; only an
// internal path that starts with "/5060do" proves the NAS basePath leaked into
// the Vercel build.
function countOccurrences(text) {
  const matches = text.match(/(?<![A-Za-z0-9._-])\/5060do(?=[/"'#?])/g);
  return matches ? matches.length : 0;
}

async function fetchPage(url) {
  const response = await fetch(url, { redirect: "follow" });
  const html = await response.text();
  return { status: response.status, bytes: Buffer.byteLength(html), html };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const results = {
    mode: REMOTE ? "remote" : "local-preview",
    baseUrl: "",
    checkedAt: new Date().toISOString(),
    buildExit: null,
    checks: [],
    consoleErrors: [],
    screenshots: [],
  };
  const check = (name, pass, detail) => {
    results.checks.push({ name, pass: Boolean(pass), detail });
  };

  let server = null;
  let baseUrl = "";

  try {
    if (REMOTE) {
      baseUrl = TARGET_URL.endsWith("/") ? TARGET_URL : `${TARGET_URL}/`;
    } else {
      if (!SKIP_BUILD) {
        const buildEnv = { ...process.env, VERCEL: "1", NEXT_PUBLIC_BASE_PATH: "" };
        results.buildExit = await run(
          process.execPath,
          [path.join("node_modules", "next", "dist", "bin", "next"), "build"],
          buildEnv,
        );
        if (results.buildExit === 0) {
          await run(
            process.execPath,
            [path.join("scripts", "postbuild-static-rsc.mjs")],
            buildEnv,
          );
        }
      }
      const indexInfo = await stat(path.join(ROOT, "index.html")).catch(() => null);
      if (!indexInfo?.isFile()) throw new Error("out/index.html is missing; run a build first");
      server = await serveStatic();
      baseUrl = `http://127.0.0.1:${PORT}/`;
    }
    results.baseUrl = baseUrl;

    // 1. Required routes answer with a real HTML page.
    const root = await fetchPage(baseUrl);
    const classic = await fetchPage(new URL("classic/", baseUrl).toString());
    check("/ HTTP 200", root.status === 200, { status: root.status, bytes: root.bytes });
    check("/ HTML 본문 수신", root.bytes > 2000, { bytes: root.bytes });
    check("/classic/ HTTP 200", classic.status === 200, {
      status: classic.status,
      bytes: classic.bytes,
    });
    check("/classic/ HTML 본문 수신", classic.bytes > 2000, { bytes: classic.bytes });

    // 2. The Vercel build must not leak the NAS sub-path.
    const rootLeak = countOccurrences(root.html);
    const classicLeak = countOccurrences(classic.html);
    check("/ HTML에 /5060do 경로 누출 0건", rootLeak === 0, { occurrences: rootLeak });
    check("/classic/ HTML에 /5060do 경로 누출 0건", classicLeak === 0, {
      occurrences: classicLeak,
    });

    // 3. Browser: Supabase-bound programs, rendered cards, zero console errors.
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

    try {
      const version = await waitForEndpoint(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const socket = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve);
        socket.addEventListener("error", reject);
      });
      const cdp = new Cdp(socket);
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });

      cdp.on("Runtime.consoleAPICalled", (params) => {
        if (params.type !== "error") return;
        results.consoleErrors.push({
          page: results.currentPage ?? "unknown",
          text: params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
        });
      });
      cdp.on("Runtime.exceptionThrown", (params) => {
        results.consoleErrors.push({
          page: results.currentPage ?? "unknown",
          text: params.exceptionDetails?.text ?? "uncaught exception",
        });
      });
      cdp.on("Log.entryAdded", (params) => {
        if (params.entry?.level !== "error") return;
        results.consoleErrors.push({
          page: results.currentPage ?? "unknown",
          text: params.entry.text,
        });
      });

      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Log.enable", {}, sessionId);
      await cdp.send("Network.enable", {}, sessionId);

      const load = async (url) => {
        const loaded = cdp.once("Page.loadEventFired");
        await cdp.send("Page.navigate", { url }, sessionId);
        await loaded;
        await sleep(800);
      };

      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );

      results.currentPage = "/";
      await load(baseUrl);
      const bound = await waitForCondition(
        cdp,
        sessionId,
        `(() => {
          const source = document.querySelector('[data-programs-source]')?.dataset.programsSource;
          const cards = document.querySelectorAll('[data-testid="program-card"]').length;
          return cards > 0 && source === 'supabase';
        })()`,
      );
      const rootState = await evaluate(
        cdp,
        sessionId,
        `(() => {
          const holder = document.querySelector('[data-programs-source]');
          return {
            source: holder?.dataset.programsSource ?? null,
            cards: document.querySelectorAll('[data-testid="program-card"]').length,
            title: document.title,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        })()`,
      );
      check("브라우저 수파베이스 강좌 데이터 바인딩", bound && rootState.cards > 0, rootState);
      check(
        "수파베이스 실시간 소스 사용",
        rootState.source === "supabase",
        { source: rootState.source },
      );
      check("가로 스크롤 없음(1280px)", rootState.overflow === false, {
        overflow: rootState.overflow,
      });
      await screenshot(cdp, sessionId, "vercel-live-root-1280.png");
      results.screenshots.push("vercel-live-root-1280.png");

      // 3-1. The jobs tab is a section on "/" and must bind live Supabase rows,
      // filter by region/board type, and open a detail modal.
      const jobsBound = await waitForCondition(
        cdp,
        sessionId,
        `(() => {
          const source = document.querySelector('[data-jobs-source]')?.dataset.jobsSource;
          const cards = document.querySelectorAll('[data-testid="job-card"]').length;
          return cards > 0 && source === 'supabase';
        })()`,
      );
      const jobsState = await evaluate(
        cdp,
        sessionId,
        `(() => {
          const holder = document.querySelector('[data-jobs-source]');
          const first = document.querySelector('[data-testid="job-card"]');
          return {
            source: holder?.dataset.jobsSource ?? null,
            cards: document.querySelectorAll('[data-testid="job-card"]').length,
            firstRegion: first?.dataset.region ?? null,
            tabLink: document.querySelector('a[href="#jobs"]')?.getAttribute('href') ?? null,
            section: Boolean(document.getElementById('jobs')),
          };
        })()`,
      );
      check(
        "브라우저 수파베이스 채용정보 데이터 바인딩",
        jobsBound && jobsState.cards > 0,
        jobsState,
      );
      check("채용정보 실시간 소스 사용", jobsState.source === "supabase", {
        source: jobsState.source,
      });
      check(
        "채용정보 탭 링크·섹션 렌더링",
        jobsState.section && jobsState.tabLink === "#jobs",
        jobsState,
      );

      await evaluate(
        cdp,
        sessionId,
        `document.querySelector('[data-testid="job-region-chip-부산"]')?.click()`,
      );
      const regionFiltered = await waitForCondition(
        cdp,
        sessionId,
        `(() => {
          const cards = [...document.querySelectorAll('[data-testid="job-card"]')];
          return cards.length > 0 && cards.every((card) => card.dataset.region === '부산');
        })()`,
      );
      check("채용정보 부산 지역 필터", regionFiltered, {
        cards: await evaluate(
          cdp,
          sessionId,
          `document.querySelectorAll('[data-testid="job-card"]').length`,
        ),
      });

      await evaluate(
        cdp,
        sessionId,
        `document.querySelector('[data-testid="job-board-chip-취업지원"]')?.click()`,
      );
      const boardFiltered = await waitForCondition(
        cdp,
        sessionId,
        `(() => {
          const cards = [...document.querySelectorAll('[data-testid="job-card"]')];
          return cards.length > 0 && cards.every((card) => card.dataset.boardType === '취업지원');
        })()`,
      );
      check("채용정보 직종 필터", boardFiltered, {
        cards: await evaluate(
          cdp,
          sessionId,
          `document.querySelectorAll('[data-testid="job-card"]').length`,
        ),
      });

      await evaluate(
        cdp,
        sessionId,
        `document.querySelector('[data-testid="job-card"]')?.click()`,
      );
      const modalOpened = await waitForCondition(
        cdp,
        sessionId,
        `Boolean(document.querySelector('[data-testid="job-detail-modal"]'))`,
      );
      const modalState = await evaluate(
        cdp,
        sessionId,
        `(() => ({
          title: document.querySelector('#job-dialog-title')?.textContent?.trim() ?? "",
          sourceUrl: document.querySelector('[data-testid="job-source-link"]')?.getAttribute('href') ?? "",
        }))()`,
      );
      check(
        "채용정보 상세 모달·원문 링크",
        modalOpened && modalState.title.length > 0 && modalState.sourceUrl.startsWith("https://"),
        modalState,
      );
      await evaluate(
        cdp,
        sessionId,
        `document.querySelector('[data-testid="job-detail-close"]')?.click()`,
      );
      const modalClosed = await waitForCondition(
        cdp,
        sessionId,
        `!document.querySelector('[data-testid="job-detail-modal"]')`,
      );
      check("채용정보 상세 모달 닫기", modalClosed, {});

      await evaluate(
        cdp,
        sessionId,
        `document.querySelector('[data-testid="job-region-chip-전체"]')?.click();
         document.querySelector('[data-testid="job-board-chip-전체"]')?.click();
         document.getElementById('jobs')?.scrollIntoView({ behavior: 'instant', block: 'start' });`,
      );
      await waitForCondition(
        cdp,
        sessionId,
        `document.querySelectorAll('[data-testid="job-card"]').length > 0`,
      );
      await sleep(400);
      await screenshot(cdp, sessionId, "vercel-live-jobs-1280.png");
      results.screenshots.push("vercel-live-jobs-1280.png");

      results.currentPage = "/classic/";
      await load(new URL("classic/", baseUrl).toString());
      const classicState = await evaluate(
        cdp,
        sessionId,
        `(() => ({
          header: Boolean(document.querySelector('[data-testid="classic-header"]')),
          gnbItems: document.querySelectorAll('[data-testid^="classic-gnb-item-"]').length,
          heroTitle: document.querySelector('[data-testid="classic-hero-title"]')?.textContent?.trim() ?? "",
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }))()`,
      );
      check("클래식 화면 헤더 렌더링", classicState.header, classicState);
      check("클래식 GNB 6개 메뉴", classicState.gnbItems === 6, {
        gnbItems: classicState.gnbItems,
      });
      check("클래식 히어로 제목 표시", classicState.heroTitle.length > 0, {
        heroTitle: classicState.heroTitle,
      });
      check("가로 스크롤 없음(클래식 1280px)", classicState.overflow === false, {
        overflow: classicState.overflow,
      });
      await screenshot(cdp, sessionId, "vercel-live-classic-1280.png");
      results.screenshots.push("vercel-live-classic-1280.png");

      check("브라우저 콘솔 오류 0건", results.consoleErrors.length === 0, {
        count: results.consoleErrors.length,
      });
    } finally {
      chrome.kill();
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.checks.filter((item) => !item.pass);
  results.summary = {
    total: results.checks.length,
    passed: results.checks.length - failed.length,
    failed: failed.length,
    verdict: failed.length === 0 ? "PASS" : "FAIL",
  };
  results.finishedAt = new Date().toISOString();

  await writeFile(
    path.join(OUT_DIR, "vercel-live-verification.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8",
  );

  for (const item of results.checks) {
    console.log(`${item.pass ? "PASS" : "FAIL"}  ${item.name}`);
  }
  console.log(`\n${results.summary.verdict} (${results.summary.passed}/${results.summary.total})`);
  console.log(`evidence=${OUT_DIR}`);

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


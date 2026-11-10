import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Verifies the live NAS deployment under /5060do without rebuilding it, so the
// check can run from any checkout state. The default target is the production
// www host; override it with `--url`, `NAS_LIVE_URL`, or `NAS_URL`.
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEFAULT_TARGET = "http://100.83.116.15:8780/5060do/";

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
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
};
const TARGET_URL = normalizeTarget(
  readUrlArgument(process.argv) ||
    process.argv.find((argument) => /^https?:\/\//.test(argument)) ||
    process.env.NAS_LIVE_URL ||
    process.env.NAS_URL ||
    DEFAULT_TARGET,
);
const BASE_PATH = new URL(TARGET_URL).pathname.replace(/\/+$/, "");
const DEBUG_PORT = Number(process.env.NAS_VERIFY_DEBUG_PORT ?? 9338);
const PROFILE_DIR = path.join(tmpdir(), `5060do-nas-live-${Date.now()}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", `nas-live-${stamp}`),
);

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

const setViewport = async (cdp, sessionId, { width, height, mobile }) => {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile },
    sessionId,
  );
  await cdp.send(
    "Emulation.setTouchEmulationEnabled",
    { enabled: mobile, maxTouchPoints: 1 },
    sessionId,
  );
};

// Real touch events instead of element.click(): the mobile checks must fail if
// a tap target is covered or off-screen at 390px.
const touchTap = async (cdp, sessionId, selector) => {
  const scrolled = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.scrollIntoView({ behavior: "instant", block: "center" });
      return true;
    })()`,
  );
  if (!scrolled) return null;
  await sleep(300);
  const point = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        height: Math.round(rect.height),
      };
    })()`,
  );
  if (!point) return null;
  await cdp.send(
    "Input.dispatchTouchEvent",
    { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] },
    sessionId,
  );
  await sleep(60);
  await cdp.send(
    "Input.dispatchTouchEvent",
    { type: "touchEnd", touchPoints: [] },
    sessionId,
  );
  await sleep(500);
  return point;
};

async function fetchPage(url) {
  const response = await fetch(url, { redirect: "follow" });
  const html = await response.text();
  return { status: response.status, bytes: Buffer.byteLength(html), html };
}

// Assets must live under the NAS sub-path; a root `/_next/` reference means the
// build lost its basePath and would 404 behind the reverse proxy.
const countRootAssets = (html) =>
  (html.match(/(?<![A-Za-z0-9._-])\/_next\//g) ?? []).length;
const countPrefixedAssets = (html) =>
  (html.match(new RegExp(`${BASE_PATH.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}/_next/`, "g")) ?? [])
    .length;
const collectAssetUrls = (html, baseUrl) => {
  const pattern = new RegExp(`["'](${BASE_PATH.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}/_next/[^"']+)["']`, "g");
  const urls = new Set();
  for (const match of html.matchAll(pattern)) {
    // The RSC flight payload escapes quotes as `\"`, which leaves a trailing
    // backslash on every asset path it repeats.
    const assetPath = match[1].replace(/\\+$/, "");
    urls.add(new URL(assetPath, baseUrl).toString());
  }
  return [...urls];
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const baseUrl = TARGET_URL.endsWith("/") ? TARGET_URL : `${TARGET_URL}/`;
  const results = {
    mode: "remote-nas",
    baseUrl,
    basePath: BASE_PATH,
    checkedAt: new Date().toISOString(),
    checks: [],
    consoleErrors: [],
    screenshots: [],
    assetFailures: [],
  };
  const check = (name, pass, detail) => {
    results.checks.push({ name, pass: Boolean(pass), detail });
  };

  // 1. Both routes answer with real HTML.
  const root = await fetchPage(baseUrl);
  const classic = await fetchPage(new URL("classic/", baseUrl).toString());
  check(`${BASE_PATH}/ HTTP 200`, root.status === 200, {
    status: root.status,
    bytes: root.bytes,
  });
  check(`${BASE_PATH}/ HTML 본문 수신`, root.bytes > 2000, { bytes: root.bytes });
  check(`${BASE_PATH}/classic/ HTTP 200`, classic.status === 200, {
    status: classic.status,
    bytes: classic.bytes,
  });
  check(`${BASE_PATH}/classic/ HTML 본문 수신`, classic.bytes > 2000, {
    bytes: classic.bytes,
  });

  // 2. Sub-path asset integrity.
  const rootPrefixed = countPrefixedAssets(root.html);
  const classicPrefixed = countPrefixedAssets(classic.html);
  const rootLeak = countRootAssets(root.html);
  const classicLeak = countRootAssets(classic.html);
  check(`${BASE_PATH}/ HTML 내 ${BASE_PATH}/_next/ 자산 참조`, rootPrefixed > 0, {
    references: rootPrefixed,
  });
  check(`${BASE_PATH}/ HTML 루트 /_next/ 누출 0건`, rootLeak === 0, {
    occurrences: rootLeak,
  });
  check(
    `${BASE_PATH}/classic/ HTML 내 ${BASE_PATH}/_next/ 자산 참조`,
    classicPrefixed > 0,
    { references: classicPrefixed },
  );
  check(`${BASE_PATH}/classic/ HTML 루트 /_next/ 누출 0건`, classicLeak === 0, {
    occurrences: classicLeak,
  });

  // 3. Every referenced asset must resolve on the live host.
  const assetUrls = [...new Set([...collectAssetUrls(root.html, baseUrl), ...collectAssetUrls(classic.html, baseUrl)])];
  for (const assetUrl of assetUrls) {
    try {
      const response = await fetch(assetUrl);
      if (!response.ok) {
        results.assetFailures.push({ url: assetUrl, status: response.status });
      }
    } catch (error) {
      results.assetFailures.push({ url: assetUrl, error: String(error) });
    }
  }
  check("참조 자산 전부 HTTP 200", results.assetFailures.length === 0, {
    checked: assetUrls.length,
    failed: results.assetFailures.length,
    failures: results.assetFailures,
  });

  // 4. Browser: Supabase-bound jobs, rendered cards, zero console errors.
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
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

    const load = async (url) => {
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url }, sessionId);
      await loaded;
      await sleep(800);
    };

    results.currentPage = "/";
    await load(baseUrl);
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
        return {
          source: holder?.dataset.jobsSource ?? null,
          cards: document.querySelectorAll('[data-testid="job-card"]').length,
          section: Boolean(document.getElementById('jobs')),
          classicLink: document.querySelector('a[href="${BASE_PATH}/classic/"]')?.getAttribute('href') ?? null,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`,
    );
    check("채용정보 수파베이스 실데이터 바인딩", jobsBound && jobsState.cards > 0, jobsState);
    check("채용정보 실시간 소스 사용", jobsState.source === "supabase", {
      source: jobsState.source,
    });
    check("채용정보 섹션·클래식 링크 렌더링", jobsState.section && jobsState.classicLink === `${BASE_PATH}/classic/`, jobsState);
    check("가로 스크롤 없음(1280px)", jobsState.overflow === false, {
      overflow: jobsState.overflow,
    });
    await screenshot(cdp, sessionId, "nas-live-root-1280.png");
    results.screenshots.push("nas-live-root-1280.png");

    await evaluate(
      cdp,
      sessionId,
      `document.getElementById('jobs')?.scrollIntoView({ behavior: 'instant', block: 'start' })`,
    );
    await sleep(400);
    await screenshot(cdp, sessionId, "nas-live-jobs-1280.png");
    results.screenshots.push("nas-live-jobs-1280.png");

    results.currentPage = "/classic/";
    await load(new URL("classic/", baseUrl).toString());
    const classicState = await evaluate(
      cdp,
      sessionId,
      `(() => ({
        header: Boolean(document.querySelector('[data-testid="classic-header"]')),
        gnbItems: document.querySelectorAll('[data-testid^="classic-gnb-item-"]').length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }))()`,
    );
    check("클래식 화면 헤더 렌더링", classicState.header, classicState);
    check("클래식 GNB 6개 메뉴", classicState.gnbItems === 6, {
      gnbItems: classicState.gnbItems,
    });
    check("가로 스크롤 없음(클래식 1280px)", classicState.overflow === false, {
      overflow: classicState.overflow,
    });
    await screenshot(cdp, sessionId, "nas-live-classic-1280.png");
    results.screenshots.push("nas-live-classic-1280.png");

    // 5. Mobile viewport (390px): stacked job cards, touch chips, drawer menu.
    await setViewport(cdp, sessionId, { width: 390, height: 844, mobile: true });
    results.currentPage = "/ (mobile 390)";
    await load(baseUrl);
    const mobileBound = await waitForCondition(
      cdp,
      sessionId,
      `document.querySelectorAll('[data-testid="job-card"]').length >= 12`,
    );
    const mobileState = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const cards = Array.from(document.querySelectorAll('[data-testid="job-card"]'));
        const list = document.querySelector('[data-testid="job-list"]');
        const listRect = list ? list.getBoundingClientRect() : null;
        const stacked =
          cards.length > 0 &&
          Boolean(listRect) &&
          cards.every((card) => {
            const rect = card.getBoundingClientRect();
            return rect.width > 0 && rect.left >= listRect.left - 1 && rect.right <= listRect.right + 1;
          });
        const chips = Array.from(
          document.querySelectorAll('[data-testid^="job-board-chip-"], [data-testid^="job-region-chip-"]'),
        );
        return {
          cards: cards.length,
          stacked,
          chips: chips.length,
          minChipHeight: chips.length
            ? Math.min(...chips.map((chip) => Math.round(chip.getBoundingClientRect().height)))
            : 0,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          viewportWidth: window.innerWidth,
        };
      })()`,
    );
    check(
      "모바일(390px) 가로 스크롤 없음",
      mobileState.overflow === false && mobileState.viewportWidth === 390,
      mobileState,
    );
    check(
      "모바일(390px) 채용정보 카드 12건 적층",
      mobileBound && mobileState.cards === 12 && mobileState.stacked,
      mobileState,
    );
    const chipPoint = await touchTap(
      cdp,
      sessionId,
      '[data-testid="job-board-chip-취업지원"]',
    );
    const chipState = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const chip = document.querySelector('[data-testid="job-board-chip-취업지원"]');
        const result = document.querySelector('[data-testid="job-result-count"]');
        return {
          pressed: chip?.getAttribute('aria-pressed') === 'true',
          label: (result?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        };
      })()`,
    );
    check(
      "모바일(390px) 직종·지역 칩 터치·스크롤 동작",
      Boolean(chipPoint) &&
        chipState.pressed &&
        chipState.label.includes("취업지원") &&
        chipPoint.height >= 44,
      { ...chipState, tap: chipPoint },
    );
    await screenshot(cdp, sessionId, "nas-live-root-390.png");
    results.screenshots.push("nas-live-root-390.png");

    const menuPoint = await touchTap(
      cdp,
      sessionId,
      '[data-testid="bottom-tab-menu"]',
    );
    const menuOpened = await waitForCondition(
      cdp,
      sessionId,
      `(() => {
        const drawer = document.querySelector('[data-testid="menu-drawer"]');
        if (!drawer) return false;
        const rect = drawer.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight;
      })()`,
      8000,
    );
    await screenshot(cdp, sessionId, "nas-live-menu-390.png");
    results.screenshots.push("nas-live-menu-390.png");
    if (menuOpened) {
      await touchTap(cdp, sessionId, '[data-testid="menu-drawer-close"]');
    }
    const menuClosed = await waitForCondition(
      cdp,
      sessionId,
      `!document.querySelector('[data-testid="menu-drawer"]')`,
      8000,
    );
    check(
      "모바일(390px) GNB 햄버거 메뉴 열기·닫기",
      Boolean(menuPoint) && menuOpened && menuClosed,
      { opened: menuOpened, closed: menuClosed },
    );

    // 6. Tablet viewport (768px): two-column card grid and desktop header.
    await setViewport(cdp, sessionId, { width: 768, height: 1024, mobile: false });
    results.currentPage = "/ (tablet 768)";
    await load(baseUrl);
    await waitForCondition(
      cdp,
      sessionId,
      `document.querySelectorAll('[data-testid="program-card"]').length > 0`,
    );
    const tabletState = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const grid = document.querySelector('[data-testid="program-grid"]');
        const columns = grid
          ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
          : 0;
        const header = document.querySelector('header nav[aria-label="주요 메뉴"]');
        const headerRect = header ? header.getBoundingClientRect() : null;
        const bottomNav = document.querySelector('[data-testid="bottom-nav"]');
        return {
          columns,
          headerVisible: Boolean(headerRect && headerRect.width > 0 && headerRect.height > 0),
          headerItems: header ? header.querySelectorAll('a').length : 0,
          bottomNavDisplay: bottomNav ? getComputedStyle(bottomNav).display : null,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          viewportWidth: window.innerWidth,
        };
      })()`,
    );
    check(
      "태블릿(768px) 가로 스크롤 없음",
      tabletState.overflow === false && tabletState.viewportWidth === 768,
      tabletState,
    );
    check("태블릿(768px) 프로그램 카드 2열 그리드", tabletState.columns === 2, {
      columns: tabletState.columns,
    });
    check(
      "태블릿(768px) 헤더 메뉴 3항목 정합",
      tabletState.headerVisible && tabletState.headerItems === 3,
      tabletState,
    );
    check(
      "태블릿(768px) 하단 모바일 메뉴 숨김",
      tabletState.bottomNavDisplay === "none",
      { display: tabletState.bottomNavDisplay },
    );
    await screenshot(cdp, sessionId, "nas-live-root-768.png");
    results.screenshots.push("nas-live-root-768.png");

    check("브라우저 콘솔 오류 0건", results.consoleErrors.length === 0, {
      count: results.consoleErrors.length,
    });
  } finally {
    chrome.kill();
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
    path.join(OUT_DIR, "nas-live-verification.json"),
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

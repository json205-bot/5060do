import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.env.BASE_URL ?? "http://100.83.116.15:8780/5060do/";
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "styleguide-20261107"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9341);
const PROFILE_DIR = path.join(tmpdir(), `5060do-style-${Date.now()}`);

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

  once(method, timeoutMs = 20000) {
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

const screenshot = async (cdp, sessionId, fileName) => {
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId,
  );
  const filePath = path.join(OUT_DIR, fileName);
  await writeFile(filePath, Buffer.from(data, "base64"));
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
};

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (el) => el ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) } : null;
  const css = (el, prop) => el ? getComputedStyle(el)[prop] : null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (value) => {
    if (!value) return null;
    // Normalize any computed color (rgb, oklch, color-mix) through a canvas.
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = 'rgba(0, 0, 0, 0)';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const backdrop = (el) => {
    let node = el;
    while (node) {
      const color = rgb(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0.5) return color;
      node = node.parentElement;
    }
    return rgb(getComputedStyle(document.body).backgroundColor);
  };
  const contrast = (fg, bg) => {
    const a = luminance(fg);
    const b = luminance(bg);
    return round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
  };
  const textContrast = (el) => {
    if (!el) return null;
    const fg = rgb(getComputedStyle(el).color);
    const bg = backdrop(el);
    return fg && bg ? contrast(fg, bg) : null;
  };
  const root = document.documentElement;
  const header = document.querySelector('header');
  const nav = document.querySelector('[data-testid="bottom-nav"]');
  const grid = document.querySelector('[data-testid="program-grid"]');
  const card = document.querySelector('[data-testid="program-card"]');
  const cardTitle = card ? card.querySelector('h3') : null;
  const cardSummary = document.querySelector('[data-testid="program-card"] p');
  const cardCta = card ? card.querySelector(':scope > span:last-child') : null;
  const progress = card ? card.querySelector('[role="progressbar"]') : null;
  const chip = document.querySelector('[data-testid="status-chip-전체"]');
  const chips = Array.from(document.querySelectorAll('[data-testid^="status-chip-"]'));
  const hero = document.querySelector('section h1');
  const heroButton = document.querySelector('main a[href="#programs"]');
  const tabs = nav ? Array.from(nav.querySelectorAll('[data-testid^="bottom-tab-"]')) : [];
  const tabMetrics = tabs.map((tab) => ({
    key: (tab.getAttribute('data-testid') || '').replace('bottom-tab-', ''),
    box: box(tab),
    labelFontSize: tab.querySelector('[data-tab-label]')
      ? round(parseFloat(css(tab.querySelector('[data-tab-label]'), 'fontSize')))
      : null,
    labelWeight: tab.querySelector('[data-tab-label]')
      ? css(tab.querySelector('[data-tab-label]'), 'fontWeight')
      : null,
  }));
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rootFontSize: round(parseFloat(css(root, 'fontSize'))),
    bodyFontSize: round(parseFloat(css(document.body, 'fontSize'))),
    bodyColor: css(document.body, 'color'),
    bodyBackground: css(document.body, 'backgroundColor'),
    bodyContrast: textContrast(document.body),
    headerHeight: header ? box(header).h : null,
    gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
    cardCount: document.querySelectorAll('[data-testid="program-card"]').length,
    card: card
      ? {
          box: box(card),
          radius: round(parseFloat(css(card, 'borderTopLeftRadius'))),
          padding: round(parseFloat(css(card, 'paddingTop'))),
          titleFontSize: round(parseFloat(css(cardTitle, 'fontSize'))),
          summaryFontSize: cardSummary ? round(parseFloat(css(cardSummary, 'fontSize'))) : null,
          summaryContrast: textContrast(cardSummary),
          ctaHeight: cardCta ? box(cardCta).h : null,
          progressHeight: progress ? round(parseFloat(css(progress, 'height'))) : null,
          progressColor: progress ? css(progress.firstElementChild, 'backgroundColor') : null,
        }
      : null,
    chipHeight: chip ? box(chip).h : null,
    chips: chips.map((el) => ({
      key: (el.getAttribute('data-testid') || '').replace('status-chip-', ''),
      height: box(el).h,
      fontSize: round(parseFloat(css(el, 'fontSize'))),
      contrast: textContrast(el),
    })),
    hero: hero ? { fontSize: round(parseFloat(css(hero, 'fontSize'))), contrast: textContrast(hero) } : null,
    heroCtaHeight: heroButton ? box(heroButton).h : null,
    bottomNav: nav
      ? {
          display: getComputedStyle(nav).display,
          height: box(nav).h,
          tabCount: tabs.length,
          minTabWidth: tabMetrics.length ? Math.min(...tabMetrics.map((tab) => tab.box.w)) : null,
          minTabHeight: tabMetrics.length ? Math.min(...tabMetrics.map((tab) => tab.box.h)) : null,
          minLabelFontSize: tabMetrics.length
            ? Math.min(...tabMetrics.filter((tab) => tab.labelFontSize !== null).map((tab) => tab.labelFontSize))
            : null,
          labelsBold: tabMetrics.every((tab) => Number(tab.labelWeight) >= 700),
          tabs: tabMetrics,
        }
      : null,
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    documentScrollWidth: root.scrollWidth,
    documentClientWidth: root.clientWidth,
    tableVisible: document.querySelector('[data-testid="program-table"]')
      ? getComputedStyle(document.querySelector('[data-testid="program-table"]')).display !== 'none'
      : false,
    mobileListVisible: document.querySelector('[data-testid="program-list-mobile"]')
      ? getComputedStyle(document.querySelector('[data-testid="program-list-mobile"]')).display !== 'none'
      : false,
    mobileRowHeight: document.querySelector('[data-testid="program-row-mobile"]')
      ? box(document.querySelector('[data-testid="program-row-mobile"]')).h
      : null,
  };
})()`;

const FORM_MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (el) => el ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) } : null;
  const css = (el, prop) => el ? getComputedStyle(el)[prop] : null;
  const name = document.querySelector('[data-testid="apply-name"]');
  const phone = document.querySelector('[data-testid="apply-phone"]');
  const pay = document.querySelector('[data-testid="pay-button"]');
  const label = document.querySelector('label[for="applicant-name"]');
  return {
    formVisible: Boolean(document.querySelector('[data-testid="apply-form"]')),
    name: name ? { box: box(name), fontSize: round(parseFloat(css(name, 'fontSize'))) } : null,
    phone: phone ? { box: box(phone), fontSize: round(parseFloat(css(phone, 'fontSize'))) } : null,
    payButton: pay ? { box: box(pay), fontSize: round(parseFloat(css(pay, 'fontSize'))) } : null,
    labelFontSize: label ? round(parseFloat(css(label, 'fontSize'))) : null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const MODAL_MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (el) => el ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) } : null;
  const modal = document.querySelector('[data-testid="detail-modal"]');
  if (!modal) return { visible: false };
  const apply = Array.from(modal.querySelectorAll('button')).find((el) =>
    ['수강신청', '대기신청', '모집 마감', '접수예정'].includes(el.textContent.trim()),
  );
  return {
    visible: true,
    width: box(modal).w,
    applyHeight: apply ? box(apply).h : null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const click = (testId) => `(() => {
  const el = document.querySelector('[data-testid="${testId}"]');
  if (!el) return false;
  el.click();
  return true;
})()`;

const openFirstCard = `(() => {
  const card = document.querySelector('[data-testid="program-card"]');
  if (!card) return false;
  card.click();
  return true;
})()`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
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
    baseUrl: BASE_URL,
    checkedAt: new Date().toISOString(),
    checks: [],
    viewports: [],
    screenshots: [],
    console: [],
  };
  const check = (name, pass, detail) => {
    results.checks.push({ name, pass: Boolean(pass), detail });
  };

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

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        results.console.push({
          type: params.type,
          text: params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
        });
      }
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    const viewports = [
      { name: "mobile-390", width: 390, height: 900, mobile: true, expectedColumns: 1 },
      { name: "fold8-412", width: 412, height: 915, mobile: true, expectedColumns: 1 },
      { name: "tablet-768", width: 768, height: 1024, mobile: false, expectedColumns: 2 },
      { name: "fold8-820", width: 820, height: 1180, mobile: false, expectedColumns: 2 },
      { name: "desktop-1280", width: 1280, height: 900, mobile: false, expectedColumns: 3 },
    ];

    for (const viewport of viewports) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile },
        sessionId,
      );
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
      await loaded;
      await sleep(1400);

      const metrics = await evaluate(cdp, sessionId, MEASURE);
      const topShot = await screenshot(cdp, sessionId, `${viewport.name}-top.png`);

      await evaluate(cdp, sessionId, `document.querySelector('#programs').scrollIntoView({ block: 'start' })`);
      await sleep(500);
      const programsShot = await screenshot(cdp, sessionId, `${viewport.name}-programs.png`);

      results.screenshots.push(topShot, programsShot);
      results.viewports.push({ ...viewport, metrics, screenshots: [topShot, programsShot] });

      const label = `${viewport.width}px`;
      check(`${label} 카드 열 수 ${viewport.expectedColumns}`, metrics.gridColumns === viewport.expectedColumns, metrics.gridColumns);
      check(`${label} 가로 스크롤 없음`, !metrics.horizontalOverflow, {
        scrollWidth: metrics.documentScrollWidth,
        clientWidth: metrics.documentClientWidth,
      });
      check(`${label} 카드 CTA 높이 52~60px`, metrics.card?.ctaHeight >= 52 && metrics.card?.ctaHeight <= 60, metrics.card?.ctaHeight);
      check(`${label} 카드 곡률 24px`, metrics.card?.radius === 24, metrics.card?.radius);
      check(`${label} 카드 패딩 24px`, metrics.card?.padding === 24, metrics.card?.padding);
      check(`${label} 카드 본문 18px`, metrics.card?.titleFontSize === 18 || metrics.card?.titleFontSize === 20, metrics.card?.titleFontSize);
      check(`${label} 본문 명도비 7:1 이상`, metrics.bodyContrast >= 7, metrics.bodyContrast);
      check(`${label} 카드 설명 명도비 7:1 이상`, metrics.card?.summaryContrast >= 7, metrics.card?.summaryContrast);
      check(`${label} 상태 칩 높이 52~56px`, metrics.chipHeight >= 52 && metrics.chipHeight <= 56, metrics.chipHeight);
      check(`${label} 상태 칩 명도비 4.5:1 이상`, (metrics.chips ?? []).every((chip) => chip.contrast >= 4.5), metrics.chips);

      check(`${label} 헤더 72px`, Math.round(metrics.headerHeight) === 72, metrics.headerHeight);
      check(`${label} 히어로 CTA 56px`, metrics.heroCtaHeight === 56, metrics.heroCtaHeight);

      if (viewport.width < 768) {
        check(`${label} 하단 탭바 64px`, Math.round(metrics.bottomNav?.height) === 64, metrics.bottomNav?.height);
        check(`${label} 탭 5개`, metrics.bottomNav?.tabCount === 5, metrics.bottomNav?.tabCount);
        check(
          `${label} 탭 터치 48x48 이상`,
          metrics.bottomNav?.minTabWidth >= 48 && metrics.bottomNav?.minTabHeight >= 48,
          { width: metrics.bottomNav?.minTabWidth, height: metrics.bottomNav?.minTabHeight },
        );
        check(`${label} 탭 라벨 13px bold`, metrics.bottomNav?.minLabelFontSize === 13 && metrics.bottomNav?.labelsBold, {
          fontSize: metrics.bottomNav?.minLabelFontSize,
          bold: metrics.bottomNav?.labelsBold,
        });
        check(`${label} 하단 탭바 표시`, metrics.bottomNav?.display !== "none", metrics.bottomNav?.display);
      } else {
        check(`${label} 하단 탭바 숨김`, metrics.bottomNav?.display === "none", metrics.bottomNav?.display);
      }

      if (viewport.width === 1280) {
        check("데스크톱 카드형 47개", metrics.cardCount === 47, metrics.cardCount);
      }
    }

    const mobile = viewports[0];
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: mobile.width, height: mobile.height, deviceScaleFactor: 1, mobile: true },
      sessionId,
    );
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
    await loaded;
    await sleep(1400);

    await evaluate(cdp, sessionId, click("view-toggle-list"));
    await sleep(600);
    const listState = await evaluate(cdp, sessionId, MEASURE);
    results.mobileList = listState;
    check("390px 목록형 표 숨김", listState.tableVisible === false, listState.tableVisible);
    check("390px 목록형 행 카드 표시", listState.mobileListVisible === true, listState.mobileListVisible);
    check("390px 목록형 가로 스크롤 없음", !listState.horizontalOverflow, listState.horizontalOverflow);
    results.screenshots.push(await screenshot(cdp, sessionId, "mobile-390-list.png"));

    await evaluate(cdp, sessionId, click("view-toggle-card"));
    await sleep(400);
    await evaluate(cdp, sessionId, openFirstCard);
    await sleep(500);
    const modalState = await evaluate(cdp, sessionId, MODAL_MEASURE);
    results.mobileModal = modalState;
    check("390px 상세 모달 표시", modalState.visible === true, modalState.visible);
    check("390px 모달 신청 버튼 56px", modalState.applyHeight === 56, modalState.applyHeight);
    check("390px 모달 가로 스크롤 없음", !modalState.horizontalOverflow, modalState.horizontalOverflow);
    results.screenshots.push(await screenshot(cdp, sessionId, "mobile-390-modal.png"));

    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const modal = document.querySelector('[data-testid="detail-modal"]');
        const apply = Array.from(modal.querySelectorAll('button')).find((el) =>
          ['수강신청', '대기신청'].includes(el.textContent.trim()),
        );
        if (!apply) return false;
        apply.click();
        return true;
      })()`,
    );
    await sleep(600);
    const formState = await evaluate(cdp, sessionId, FORM_MEASURE);
    results.mobileForm = formState;
    check("390px 신청 폼 표시", formState.formVisible === true, formState.formVisible);
    check("390px 성명 입력 52px", formState.name?.box.h === 52, formState.name?.box.h);
    check("390px 연락처 입력 52px", formState.phone?.box.h === 52, formState.phone?.box.h);
    check("390px 입력 글자 18px (자동 줌 차단)", formState.name?.fontSize === 18 && formState.phone?.fontSize === 18, {
      name: formState.name?.fontSize,
      phone: formState.phone?.fontSize,
    });
    check("390px 결제 버튼 56px", formState.payButton?.box.h === 56, formState.payButton?.box.h);
    check("390px 폼 라벨 18px", formState.labelFontSize === 18, formState.labelFontSize);
    check("390px 폼 가로 스크롤 없음", !formState.horizontalOverflow, formState.horizontalOverflow);
    results.screenshots.push(await screenshot(cdp, sessionId, "mobile-390-form.png"));

    check("콘솔 에러 0건", results.console.length === 0, results.console);
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

  await writeFile(
    path.join(OUT_DIR, "verification.json"),
    JSON.stringify(results, null, 2),
    "utf8",
  );

  for (const item of results.checks) {
    console.log(`${item.pass ? "PASS" : "FAIL"}  ${item.name}`);
  }
  console.log(`\n${results.summary.verdict} (${results.summary.passed}/${results.summary.total})`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.BASE_URL ?? "http://100.83.116.15:8780/5060do/";
const OUT_DIR = path.resolve("docs", "evidence", "dual-version-20261107");
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9444);
const PROFILE_DIR = path.join(tmpdir(), `5060do-dual-${Date.now()}`);

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
  return path.relative(process.cwd(), filePath);
};

const fullPageScreenshot = async (cdp, sessionId, fileName) => {
  const { cssContentSize } = await cdp.send("Page.getLayoutMetrics", {}, sessionId);
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: cssContentSize.width,
        height: Math.min(cssContentSize.height, 7000),
        scale: 1,
      },
    },
    sessionId,
  );
  const filePath = path.join(OUT_DIR, fileName);
  await writeFile(filePath, Buffer.from(data, "base64"));
  return { path: path.relative(process.cwd(), filePath), height: cssContentSize.height };
};

const setViewport = (cdp, sessionId, width, height, mobile) =>
  cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile },
    sessionId,
  );

const navigate = async (cdp, sessionId, url) => {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  await sleep(900);
};

const PAGE_METRICS = `(() => {
  const root = document.documentElement;
  const pick = (selector) => document.querySelector(selector);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const nav = pick('[data-testid="bottom-nav"]');
  const tabs = nav ? nav.querySelectorAll('[data-testid^="bottom-tab-"]') : [];
  const gnb = pick('[data-testid="classic-gnb"]');
  const burger = pick('[data-testid="classic-menu-button"]');
  return {
    href: location.href,
    pathname: location.pathname,
    title: document.title,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    hasSwitcher: Boolean(pick('[data-testid="version-switcher"]')),
    switcherToClassic: pick('[data-testid="switch-classic"]')?.getAttribute('href') ?? null,
    switcherToModern: pick('[data-testid="switch-modern"]')?.getAttribute('href') ?? null,
    hasClassicHeader: Boolean(pick('[data-testid="classic-header"]')),
    gnbDisplay: gnb ? getComputedStyle(gnb).display : null,
    gnbVisible: Boolean(gnb && box(gnb).height > 0),
    burgerVisible: Boolean(burger && box(burger).height > 0),
    bottomNavDisplay: nav ? getComputedStyle(nav).display : null,
    bottomNavVisible: Boolean(nav && box(nav).height > 0),
    bottomTabCount: tabs.length,
    heroTitle: pick('[data-testid="classic-hero-title"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    h1: document.querySelector('h1')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
  };
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
    base: BASE,
    checkedAt: new Date().toISOString(),
    networkFailures: [],
    consoleErrors: [],
    checks: {},
    currentPhase: "boot",
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
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);

    cdp.on("Network.responseReceived", (params) => {
      if (params.response.status >= 400) {
        results.networkFailures.push({
          phase: results.currentPhase,
          status: params.response.status,
          url: params.response.url,
          type: params.type,
          fromDiskCache: params.response.fromDiskCache,
          remoteIPAddress: params.response.remoteIPAddress,
          headers: params.response.headers,
        });
      }
    });
    cdp.on("Network.loadingFailed", (params) => {
      if (params.errorText && params.errorText !== "net::ERR_ABORTED") {
        results.networkFailures.push({ error: params.errorText, type: params.type });
      }
    });
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        results.consoleErrors.push(
          params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
        );
      }
    });

    results.currentPhase = "desktop-modern";
    results.checks.desktop = {};
    await setViewport(cdp, sessionId, 1280, 900, false);
    await navigate(cdp, sessionId, BASE);
    results.checks.desktop.modern = await evaluate(cdp, sessionId, PAGE_METRICS);
    results.checks.desktop.modernScreenshot = await screenshot(
      cdp,
      sessionId,
      "desktop-1280-modern.png",
    );

    const megaMenuProbe = `(async () => {
      const items = Array.from(document.querySelectorAll('[data-testid^="classic-gnb-item-"]'));
      const groups = [];
      let totalLinks = 0;
      for (let index = 0; index < items.length; index += 1) {
        items[index].focus();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const panel = document.querySelector('[data-testid="classic-mega-menu"]');
        const links = panel ? Array.from(panel.querySelectorAll('a')) : [];
        const heading = panel?.querySelector('h2')?.textContent?.trim() ?? null;
        groups.push({ index, label: items[index].textContent.trim(), heading, links: links.length });
        totalLinks += links.length;
      }
      const panel = document.querySelector('[data-testid="classic-mega-menu"]');
      return { groupCount: items.length, groups, totalLinks, panelOpen: Boolean(panel) };
    })()`;

    const clickAndWaitFor = async (testId, checkExpression, timeoutMs = 15000) => {
      let clicked = true;
      try {
        clicked = await evaluate(
          cdp,
          sessionId,
          `(() => {
            const el = document.querySelector('[data-testid="${testId}"]');
            if (!el) return false;
            el.click();
            return true;
          })()`,
        );
      } catch {
        clicked = true;
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          if (await evaluate(cdp, sessionId, checkExpression)) {
            return { clicked, reached: true };
          }
        } catch {
          await sleep(250);
          continue;
        }
        await sleep(250);
      }
      return { clicked, reached: false };
    };

    results.checks.desktop.switchClick = {
      ...(await clickAndWaitFor(
        "switch-classic",
        `Boolean(document.querySelector('[data-testid="classic-header"]'))`,
      )),
      ...(await evaluate(
        cdp,
        sessionId,
        `({ pathname: location.pathname, href: location.href })`,
      )),
    };
    await sleep(900);
    results.checks.desktop.classic = await evaluate(cdp, sessionId, PAGE_METRICS);
    await evaluate(cdp, sessionId, "window.scrollTo(0, 0)");
    await sleep(300);
    results.checks.desktop.classicScreenshot = await screenshot(
      cdp,
      sessionId,
      "desktop-1280-classic.png",
    );
    results.checks.desktop.classicFullScreenshot = await fullPageScreenshot(
      cdp,
      sessionId,
      "desktop-1280-classic-full.png",
    );
    results.checks.desktop.megaMenu = await evaluate(cdp, sessionId, megaMenuProbe);

    await evaluate(
      cdp,
      sessionId,
      `document.querySelector('[data-testid="classic-gnb-item-6"]').focus()`,
    );
    await sleep(400);
    results.checks.desktop.megaMenuScreenshot = await screenshot(
      cdp,
      sessionId,
      "desktop-1280-classic-megamenu.png",
    );

    results.currentPhase = "tablet-classic";
    results.checks.tablet = {};
    await setViewport(cdp, sessionId, 768, 1024, true);
    await navigate(cdp, sessionId, `${BASE}classic/`);
    results.checks.tablet.classic = await evaluate(cdp, sessionId, PAGE_METRICS);
    results.checks.tablet.classicScreenshot = await screenshot(
      cdp,
      sessionId,
      "tablet-768-classic.png",
    );

    results.currentPhase = "mobile-classic";
    results.checks.mobile = {};
    await setViewport(cdp, sessionId, 390, 844, true);
    await navigate(cdp, sessionId, `${BASE}classic/`);
    results.checks.mobile.classic = await evaluate(cdp, sessionId, PAGE_METRICS);
    results.checks.mobile.classicScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-classic.png",
    );
    results.checks.mobile.classicFullScreenshot = await fullPageScreenshot(
      cdp,
      sessionId,
      "mobile-390-classic-full.png",
    );

    const openDrawerProbe = `(async () => {
      const button = document.querySelector('[data-testid="classic-menu-button"]');
      if (!button) return { opened: false };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 450));
      const drawer = document.querySelector('[data-testid="classic-drawer"]');
      if (!drawer) return { opened: false };
      const accordions = drawer.querySelectorAll('[data-testid^="classic-accordion-"]');
      const firstPanel = drawer.querySelector('[data-testid="classic-accordion-panel-0"]');
      return {
        opened: true,
        transform: getComputedStyle(drawer).transform,
        width: Math.round(drawer.getBoundingClientRect().width),
        right: Math.round(window.innerWidth - drawer.getBoundingClientRect().right),
        accordionCount: Array.from(accordions).filter((el) => el.tagName === 'BUTTON').length,
        firstExpanded: drawer.querySelector('[data-testid="classic-accordion-0"]')?.getAttribute('aria-expanded') ?? null,
        firstPanelLinks: firstPanel ? firstPanel.querySelectorAll('a').length : 0,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    })()`;

    results.checks.mobile.drawer = await evaluate(
      cdp,
      sessionId,
      openDrawerProbe,
    );
    results.checks.mobile.drawerScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-classic-drawer.png",
    );

    const accordionProbe = `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const drawer = document.querySelector('[data-testid="classic-drawer"]');
      const buttons = Array.from(drawer.querySelectorAll('[data-testid^="classic-accordion-"]')).filter((el) => el.tagName === 'BUTTON');
      if (buttons[0]?.getAttribute('aria-expanded') === 'true') {
        buttons[0].click();
        await wait(180);
      }
      const states = [];
      let totalLinks = 0;
      for (let index = 0; index < buttons.length; index += 1) {
        if (buttons[index].getAttribute('aria-expanded') === 'true') {
          buttons[index].click();
          await wait(150);
        }
        buttons[index].click();
        await wait(180);
        const expanded = buttons[index].getAttribute('aria-expanded');
        const panel = drawer.querySelector('[data-testid="classic-accordion-panel-' + index + '"]');
        const links = panel ? panel.querySelectorAll('a').length : 0;
        states.push({ index, label: buttons[index].textContent.trim(), expanded, links });
        totalLinks += links;
      }
      buttons[0].click();
      await wait(180);
      const collapsed = buttons[0].getAttribute('aria-expanded');
      return { count: buttons.length, states, totalLinks, collapsedFirst: collapsed };
    })()`;

    results.checks.mobile.accordion = await evaluate(
      cdp,
      sessionId,
      accordionProbe,
    );
    results.checks.mobile.accordionScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-classic-accordion.png",
    );

    await evaluate(
      cdp,
      sessionId,
      `document.querySelector('[data-testid="classic-drawer-close"]')?.click()`,
    );
    await sleep(450);
    results.checks.mobile.drawerClosed = await evaluate(
      cdp,
      sessionId,
      `!document.querySelector('[data-testid="classic-drawer"]')`,
    );

    results.checks.mobile.switchClick = {
      ...(await clickAndWaitFor(
        "switch-modern",
        `Boolean(document.querySelector('[data-testid="bottom-nav"]'))`,
      )),
      ...(await evaluate(
        cdp,
        sessionId,
        `({ pathname: location.pathname, href: location.href })`,
      )),
    };
    await sleep(900);
    results.checks.mobile.modern = await evaluate(cdp, sessionId, PAGE_METRICS);
    results.checks.mobile.modernScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-modern.png",
    );

    await writeFile(
      path.join(OUT_DIR, "verification.json"),
      JSON.stringify(results, null, 2),
      "utf8",
    );
    console.log(JSON.stringify(results, null, 2));
  } finally {
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100/";
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9333);
const PROFILE_DIR = path.join(tmpdir(), `5060do-cdp-${Date.now()}`);

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

  once(method, timeoutMs = 15000) {
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

const METRICS_EXPRESSION = `(() => {
  const grid = document.querySelector('[data-testid="program-grid"]');
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  const root = document.documentElement;
  const targets = Array.from(document.querySelectorAll('header nav a, [data-testid="program-card"], main button'));
  const smallTargets = targets
    .map((el) => ({ label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), height: Math.round(el.getBoundingClientRect().height) }))
    .filter((entry) => entry.height > 0 && entry.height < 48);
  const textNodes = Array.from(document.querySelectorAll('body *')).filter((el) => {
    const direct = Array.from(el.childNodes).some((node) => node.nodeType === 3 && node.textContent.trim().length > 1);
    const rect = el.getBoundingClientRect();
    return direct && rect.width > 0 && rect.height > 0;
  });
  const fontSizes = textNodes.map((el) => parseFloat(getComputedStyle(el).fontSize));
  const nav = document.querySelector('[data-testid="bottom-nav"]');
  const navRect = nav ? nav.getBoundingClientRect() : null;
  const tabs = nav
    ? Array.from(nav.querySelectorAll('[data-testid^="bottom-tab-"]'))
    : [];
  const tabMetrics = tabs.map((tab) => {
    const rect = tab.getBoundingClientRect();
    const label = tab.querySelector('[data-tab-label]');
    return {
      key: (tab.getAttribute('data-testid') || '').replace('bottom-tab-', ''),
      text: (tab.textContent || '').trim(),
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      labelFontSize: label ? parseFloat(getComputedStyle(label).fontSize) : null,
      active: tab.getAttribute('aria-current') === 'page',
    };
  });
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    gridColumns: columns,
    cardCount: document.querySelectorAll('[data-testid="program-card"]').length,
    bodyFontSize: parseFloat(getComputedStyle(document.body).fontSize),
    bodyColor: getComputedStyle(document.body).color,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    documentScrollWidth: root.scrollWidth,
    documentClientWidth: root.clientWidth,
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    smallTargets,
    minTextFontSize: fontSizes.length ? Math.min(...fontSizes) : null,
    bottomNav: nav
      ? {
          display: getComputedStyle(nav).display,
          visible: Boolean(navRect && navRect.height > 0),
          height: navRect ? Math.round(navRect.height) : 0,
          bottomGap: navRect ? Math.round(window.innerHeight - navRect.bottom) : null,
          tabCount: tabMetrics.length,
          tabs: tabMetrics,
          minTabHeight: tabMetrics.length ? Math.min(...tabMetrics.map((t) => t.height)) : null,
          minLabelFontSize: tabMetrics.length
            ? Math.min(...tabMetrics.map((t) => t.labelFontSize ?? 999))
            : null,
        }
      : null,
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

  const results = { baseUrl: BASE_URL, checkedAt: new Date().toISOString(), viewports: [], flow: {}, console: [] };

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

    let dialogMessage = null;
    cdp.on("Page.javascriptDialogOpening", async (params) => {
      dialogMessage = params.message;
      await cdp.send("Page.handleJavaScriptDialog", { accept: true }, sessionId);
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    const viewports = [
      { name: "mobile-390", width: 390, height: 900, expectedColumns: 1 },
      { name: "tablet-768", width: 768, height: 1024, expectedColumns: 2 },
      { name: "desktop-1280", width: 1280, height: 900, expectedColumns: 3 },
    ];

    for (const viewport of viewports) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 768 },
        sessionId,
      );
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
      await loaded;
      await sleep(1200);

      const metrics = await evaluate(cdp, sessionId, METRICS_EXPRESSION);
      const shot = await screenshot(cdp, sessionId, `${viewport.name}.png`);
      results.viewports.push({
        ...viewport,
        metrics,
        columnsMatch: metrics.gridColumns === viewport.expectedColumns,
        screenshot: shot,
      });
    }

    const readNavState = `(() => {
      const nav = document.querySelector('[data-testid="bottom-nav"]');
      const tabs = nav ? Array.from(nav.querySelectorAll('[data-testid^="bottom-tab-"]')) : [];
      return {
        scrollY: Math.round(window.scrollY),
        viewportHeight: window.innerHeight,
        activeTabs: tabs
          .filter((tab) => tab.getAttribute('aria-current') === 'page')
          .map((tab) => tab.getAttribute('data-testid')),
        drawerOpen: Boolean(document.querySelector('[data-testid="menu-drawer"]')),
        sectionTops: Object.fromEntries(
          ['programs', 'jobs', 'notice'].map((id) => {
            const el = document.getElementById(id);
            return [id, el ? Math.round(el.getBoundingClientRect().top) : null];
          }),
        ),
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    })()`;

    const clickTestId = (testId) =>
      evaluate(
        cdp,
        sessionId,
        `(() => {
          const el = document.querySelector('[data-testid="${testId}"]');
          if (!el) return false;
          el.click();
          return true;
        })()`,
      );

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 900, deviceScaleFactor: 1, mobile: true },
      sessionId,
    );
    const mobileLoaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
    await mobileLoaded;
    await sleep(1000);

    results.bottomNavFlow = { initial: await evaluate(cdp, sessionId, readNavState) };
    results.bottomNavFlow.initialScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-bottom-nav.png",
    );

    results.bottomNavFlow.tabs = {};
    for (const key of ["programs", "jobs", "notice"]) {
      const clicked = await clickTestId(`bottom-tab-${key}`);
      await sleep(1400);
      const state = await evaluate(cdp, sessionId, readNavState);
      const top = state.sectionTops[key];
      results.bottomNavFlow.tabs[key] = {
        clicked,
        ...state,
        sectionTop: top,
        sectionReached:
          top !== null && top >= -8 && top < Math.round(state.viewportHeight * 0.8),
        activeMatches: state.activeTabs.includes(`bottom-tab-${key}`),
      };
    }

    const backHome = await clickTestId("bottom-tab-home");
    await sleep(1400);
    results.bottomNavFlow.home = {
      clicked: backHome,
      ...(await evaluate(cdp, sessionId, readNavState)),
    };

    await clickTestId("bottom-tab-menu");
    await sleep(600);
    results.bottomNavFlow.drawer = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const drawer = document.querySelector('[data-testid="menu-drawer"]');
        if (!drawer) return { open: false };
        return {
          open: true,
          title: drawer.querySelector('h2')?.textContent?.trim() ?? '',
          titleId: drawer.getAttribute('aria-labelledby'),
          modal: drawer.getAttribute('aria-modal'),
          shortcuts: drawer.querySelectorAll('[data-testid^="menu-shortcut-"]').length,
          externalLinks: Array.from(drawer.querySelectorAll('a[target="_blank"]')).map((a) => a.textContent.trim()),
          phoneHref: drawer.querySelector('[data-testid="menu-phone-link"]')?.getAttribute('href') ?? null,
          height: Math.round(drawer.getBoundingClientRect().height),
          bodyOverflow: getComputedStyle(document.body).overflow,
        };
      })()`,
    );
    results.bottomNavFlow.drawerScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-drawer.png",
    );

    await clickTestId("menu-shortcut-jobs");
    await sleep(1400);
    results.bottomNavFlow.drawerShortcut = await evaluate(cdp, sessionId, readNavState);

    await clickTestId("bottom-tab-menu");
    await sleep(500);
    await clickTestId("menu-drawer-close");
    await sleep(500);
    results.bottomNavFlow.drawerCloseButton = await evaluate(cdp, sessionId, readNavState);

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await sleep(300);
    results.bottomNavFlow.desktop = await evaluate(cdp, sessionId, METRICS_EXPRESSION);

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    const reloaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
    await reloaded;
    await sleep(800);

    results.flow.cardsScreenshot = await (async () => {
      await evaluate(
        cdp,
        sessionId,
        `document.querySelector('#programs').scrollIntoView({ block: 'start' })`,
      );
      await sleep(500);
      const shot = await screenshot(cdp, sessionId, "desktop-1280-cards.png");
      await evaluate(cdp, sessionId, `window.scrollTo(0, 0)`);
      await sleep(300);
      return shot;
    })();

    results.flow.cardOpened = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const card = document.querySelectorAll('[data-testid="program-card"]')[0];
        card.click();
        return Boolean(card);
      })()`,
    );
    await sleep(400);
    results.flow.modalVisible = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const modal = document.querySelector('[data-testid="detail-modal"]');
        return modal ? { visible: true, title: modal.querySelector('h2')?.textContent?.trim() ?? '' } : { visible: false };
      })()`,
    );
    results.flow.modalScreenshot = await screenshot(cdp, sessionId, "desktop-1280-modal.png");

    results.flow.applyStarted = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const modal = document.querySelector('[data-testid="detail-modal"]');
        const button = Array.from(modal.querySelectorAll('button')).find((el) => el.textContent.trim() === '수강신청');
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );
    await sleep(400);

    results.flow.formVisible = await evaluate(
      cdp,
      sessionId,
      `Boolean(document.querySelector('[data-testid="apply-form"]'))`,
    );

    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const setValue = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setValue(document.querySelector('[data-testid="apply-name"]'), '김영희');
        setValue(document.querySelector('[data-testid="apply-phone"]'), '01012345678');
        return true;
      })()`,
    );
    await sleep(300);
    results.flow.formScreenshot = await screenshot(cdp, sessionId, "desktop-1280-form.png");

    await evaluate(
      cdp,
      sessionId,
      `(() => {
        document.querySelector('[data-testid="pay-button"]').click();
        return true;
      })()`,
    );
    await sleep(800);

    results.flow.dialogMessage = dialogMessage;
    results.flow.doneVisible = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const panel = document.querySelector('[data-testid="done-panel"]');
        return panel ? panel.textContent.replace(/\\s+/g, ' ').trim() : null;
      })()`,
    );
    results.flow.doneScreenshot = await screenshot(cdp, sessionId, "desktop-1280-done.png");

    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const modal = document.querySelector('[data-testid="detail-modal"]');
        const close = Array.from(modal.querySelectorAll('button')).find((el) => el.textContent.trim() === '확인');
        close.click();
        return true;
      })()`,
    );
    await sleep(300);
    results.flow.modalClosed = await evaluate(
      cdp,
      sessionId,
      `!document.querySelector('[data-testid="detail-modal"]')`,
    );

    await evaluate(
      cdp,
      sessionId,
      `document.querySelector('[data-testid="program-card"][data-status="마감"]').click()`,
    );
    await sleep(400);
    results.flow.closedProgram = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const modal = document.querySelector('[data-testid="detail-modal"]');
        const applyButton = Array.from(modal.querySelectorAll('button')).find((el) => el.textContent.trim() === '모집 마감');
        return {
          disabled: applyButton ? applyButton.disabled : null,
          label: applyButton ? applyButton.textContent.trim() : null,
        };
      })()`,
    );
    await evaluate(
      cdp,
      sessionId,
      `document.querySelector('[data-testid="detail-modal"] button[aria-label="상세 창 닫기"]').click()`,
    );
    await sleep(300);

    results.flow.mobileModal = await (async () => {      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 390, height: 900, deviceScaleFactor: 1, mobile: true },
        sessionId,
      );
      await sleep(300);
      await evaluate(
        cdp,
        sessionId,
        `document.querySelectorAll('[data-testid="program-card"]')[0].click()`,
      );
      await sleep(400);
      const info = await evaluate(
        cdp,
        sessionId,
        `(() => {
          const root = document.documentElement;
          const modal = document.querySelector('[data-testid="detail-modal"]');
          return {
            visible: Boolean(modal),
            horizontalOverflow: root.scrollWidth > root.clientWidth,
            modalWidth: modal ? Math.round(modal.getBoundingClientRect().width) : 0,
          };
        })()`,
      );
      const shot = await screenshot(cdp, sessionId, "mobile-390-modal.png");
      return { ...info, screenshot: shot };
    })();

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

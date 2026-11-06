import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL =
  process.env.BASE_URL ?? "http://127.0.0.1:3100/5060do/";
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "chatbot-20261107"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9344);
const PROFILE_DIR = path.join(tmpdir(), `5060do-chatbot-${Date.now()}`);

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

const TRIGGER_EXPRESSION = `(() => {
  const trigger = document.querySelector('[data-testid="chatbot-trigger"]');
  const nav = document.querySelector('[data-testid="bottom-nav"]');
  if (!trigger) return { found: false };
  const rect = trigger.getBoundingClientRect();
  const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
  return {
    found: true,
    visible: rect.width > 0 && rect.height > 0,
    label: (trigger.textContent || '').trim(),
    ariaExpanded: trigger.getAttribute('aria-expanded'),
    rect: {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    bottomNav: navRect
      ? { top: Math.round(navRect.top), height: Math.round(navRect.height) }
      : null,
    gapAboveNav: navRect ? Math.round(navRect.top - rect.bottom) : null,
    overlapsNav: navRect ? rect.bottom > navRect.top : false,
    rightGap: Math.round(window.innerWidth - rect.right),
    bottomGap: Math.round(window.innerHeight - rect.bottom),
  };
})()`;

const PANEL_EXPRESSION = `(() => {
  const panel = document.querySelector('[data-testid="chatbot-panel"]');
  if (!panel) return { open: false };
  const rect = panel.getBoundingClientRect();
  const botBubble = panel.querySelector('[data-testid="chatbot-message"][data-role="bot"] p');
  const style = botBubble ? getComputedStyle(botBubble) : null;
  const input = panel.querySelector('[data-testid="chatbot-input"]');
  const chips = Array.from(panel.querySelectorAll('[data-testid^="chatbot-chip-"]'));
  const root = document.documentElement;
  return {
    open: true,
    role: panel.getAttribute('role'),
    modal: panel.getAttribute('aria-modal'),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    heightRatio: Number((rect.height / window.innerHeight).toFixed(3)),
    rightGap: Math.round(window.innerWidth - rect.right),
    bottomGap: Math.round(window.innerHeight - rect.bottom),
    horizontallyContained: rect.left >= -1 && rect.right <= window.innerWidth + 1,
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    bodyOverflow: getComputedStyle(document.body).overflow,
    messageCount: panel.querySelectorAll('[data-testid="chatbot-message"]').length,
    botFontSize: style ? parseFloat(style.fontSize) : null,
    botLineHeightRatio: style
      ? Number((parseFloat(style.lineHeight) / parseFloat(style.fontSize)).toFixed(2))
      : null,
    botColor: style ? style.color : null,
    chips: chips.map((chip) => ({
      id: chip.getAttribute('data-testid'),
      label: (chip.textContent || '').trim(),
      height: Math.round(chip.getBoundingClientRect().height),
    })),
    inputFontSize: input ? parseFloat(getComputedStyle(input).fontSize) : null,
    inputHeight: input ? Math.round(input.getBoundingClientRect().height) : null,
  };
})()`;

const LAST_BOT_MESSAGE = `(() => {
  const nodes = Array.from(
    document.querySelectorAll('[data-testid="chatbot-message"][data-role="bot"]'),
  );
  const last = nodes[nodes.length - 1];
  if (!last) return null;
  const link = last.querySelector('a');
  return {
    text: (last.querySelector('p')?.textContent || '').replace(/\\s+/g, ' ').trim(),
    linkLabel: link ? (link.textContent || '').trim() : null,
    linkHref: link ? link.getAttribute('href') : null,
    linkTestId: link ? link.getAttribute('data-testid') : null,
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
    baseUrl: BASE_URL,
    checkedAt: new Date().toISOString(),
    viewports: [],
    interactions: {},
    console: [],
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

    cdp.on("Runtime.consoleAPICalled", (params) => {
      results.console.push({
        type: params.type,
        text: params.args
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(" "),
      });
    });
    cdp.on("Runtime.exceptionThrown", (params) => {
      results.console.push({
        type: "exception",
        text: params.exceptionDetails?.text ?? "unknown",
      });
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

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

    const waitForEndpointState = async (executor, expected, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        last = await executor();
        if (last === expected) return true;
        await sleep(100);
      }
      return false;
    };

    for (const viewport of [
      { name: "mobile-390", width: 390, height: 900, mobile: true },
      { name: "fold8-412", width: 412, height: 914, mobile: true },
      { name: "desktop-1280", width: 1280, height: 900, mobile: false },
    ]) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.mobile,
        },
        sessionId,
      );
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
      await loaded;
      await sleep(900);

      const trigger = await evaluate(cdp, sessionId, TRIGGER_EXPRESSION);
      await screenshot(cdp, sessionId, `${viewport.name}-trigger.png`);

      await clickTestId("chatbot-trigger");
      await sleep(450);
      const panel = await evaluate(cdp, sessionId, PANEL_EXPRESSION);

      results.viewports.push({
        ...viewport,
        trigger,
        panel,
        triggerScreenshot: path.join(
          "docs",
          "evidence",
          "chatbot-20261107",
          `${viewport.name}-trigger.png`,
        ),
      });

      await clickTestId("chatbot-close");
      await sleep(300);
    }

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 900, deviceScaleFactor: 1, mobile: true },
      sessionId,
    );
    const mobileLoaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
    await mobileLoaded;
    await sleep(900);

    await clickTestId("chatbot-trigger");
    await sleep(400);
    results.interactions.openedScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-open.png",
    );

    results.interactions.chipClicked = await clickTestId("chatbot-chip-free");
    results.interactions.typingShown = await waitForEndpointState(
      () =>
        evaluate(
          cdp,
          sessionId,
          `Boolean(document.querySelector('[data-testid="chatbot-typing"]'))`,
        ),
      true,
      800,
    );
    await sleep(1100);
    results.interactions.freeReply = await evaluate(
      cdp,
      sessionId,
      LAST_BOT_MESSAGE,
    );
    results.interactions.typingCleared = await evaluate(
      cdp,
      sessionId,
      `!document.querySelector('[data-testid="chatbot-typing"]')`,
    );
    results.interactions.freeScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-free-answer.png",
    );

    await clickTestId("chatbot-chip-phone");
    await sleep(1100);
    results.interactions.phoneReply = await evaluate(
      cdp,
      sessionId,
      LAST_BOT_MESSAGE,
    );
    results.interactions.phoneScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-phone-answer.png",
    );

    await clickTestId("chatbot-chip-location");
    await sleep(1100);
    results.interactions.locationReply = await evaluate(
      cdp,
      sessionId,
      LAST_BOT_MESSAGE,
    );
    results.interactions.locationScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-location-answer.png",
    );

    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.querySelector('[data-testid="chatbot-input"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '바리스타');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    await sleep(200);
    await clickTestId("chatbot-send");
    await sleep(1100);
    results.interactions.freeTextReply = await evaluate(
      cdp,
      sessionId,
      LAST_BOT_MESSAGE,
    );

    await clickTestId("chatbot-close");
    await sleep(400);
    results.interactions.closed = await evaluate(
      cdp,
      sessionId,
      `(() => ({
        panelGone: !document.querySelector('[data-testid="chatbot-panel"]'),
        bodyOverflow: getComputedStyle(document.body).overflow,
        ariaExpanded: document.querySelector('[data-testid="chatbot-trigger"]')?.getAttribute('aria-expanded'),
      }))()`,
    );
    results.interactions.closedScreenshot = await screenshot(
      cdp,
      sessionId,
      "mobile-390-closed.png",
    );

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    const desktopLoaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
    await desktopLoaded;
    await sleep(700);
    await clickTestId("chatbot-trigger");
    await sleep(400);
    results.interactions.desktopPanel = await evaluate(
      cdp,
      sessionId,
      PANEL_EXPRESSION,
    );
    results.interactions.desktopScreenshot = await screenshot(
      cdp,
      sessionId,
      "desktop-1280-open.png",
    );

    await clickTestId("chatbot-chip-apply");
    await sleep(1100);
    results.interactions.desktopApplyReply = await evaluate(
      cdp,
      sessionId,
      LAST_BOT_MESSAGE,
    );
    results.interactions.desktopApplyScreenshot = await screenshot(
      cdp,
      sessionId,
      "desktop-1280-apply-answer.png",
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

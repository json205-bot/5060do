import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL =
  process.env.BASE_URL ?? "http://100.83.116.15:8780/5060do/";
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "logos-20261107"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9347);
const PROFILE_DIR = path.join(tmpdir(), `5060do-logos-${Date.now()}`);

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
  await writeFile(path.join(OUT_DIR, fileName), Buffer.from(data, "base64"));
  return path.join("docs", "evidence", "logos-20261107", fileName);
};

const LOGO_EXPRESSION = `(() => {
  const imgs = Array.from(document.querySelectorAll('img'));
  const logos = imgs
    .filter((img) => (img.currentSrc || img.src).includes('/assets/logo'))
    .map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        src: img.getAttribute('src'),
        currentSrc: img.currentSrc,
        alt: img.alt,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        visible: rect.width > 0 && rect.height > 0,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      };
    });
  const header = document.querySelector('header');
  const headerRect = header?.getBoundingClientRect();
  return {
    totalImages: imgs.length,
    brokenImages: imgs
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.currentSrc || img.src),
    logos,
    headerHeight: headerRect ? Math.round(headerRect.height) : null,
  };
})()`;

const assetStatus = async (url) => {
  const response = await fetch(url, { method: "GET" });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: buffer.length,
  };
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const assets = await Promise.all(
    ["logo_pc.png", "logo_mobile.png", "logo_footer.png"].map((name) =>
      assetStatus(new URL(`assets/${name}`, BASE_URL).toString()),
    ),
  );

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
    assets,
    pages: [],
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

    cdp.on("Runtime.exceptionThrown", (params) => {
      results.console.push({
        type: "exception",
        text: params.exceptionDetails?.text ?? "unknown",
      });
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    const pages = [
      { key: "modern", url: BASE_URL },
      { key: "classic", url: new URL("classic/", BASE_URL).toString() },
    ];
    const viewports = [
      { name: "mobile-390", width: 390, height: 900, mobile: true },
      { name: "desktop-1280", width: 1280, height: 900, mobile: false },
    ];

    for (const page of pages) {
      for (const viewport of viewports) {
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
        await cdp.send("Page.navigate", { url: page.url }, sessionId);
        await loaded;
        await sleep(700);

        const top = await evaluate(cdp, sessionId, LOGO_EXPRESSION);
        const prefix = `${page.key}-${viewport.name}`;
        const topScreenshot = await screenshot(
          cdp,
          sessionId,
          `${prefix}-header.png`,
        );

        await evaluate(
          cdp,
          sessionId,
          `window.scrollTo(0, document.body.scrollHeight)`,
        );
        await sleep(500);
        const bottom = await evaluate(cdp, sessionId, LOGO_EXPRESSION);
        const bottomScreenshot = await screenshot(
          cdp,
          sessionId,
          `${prefix}-footer.png`,
        );

        results.pages.push({
          ...page,
          ...viewport,
          top,
          bottom,
          topScreenshot,
          bottomScreenshot,
        });
      }
    }

    await writeFile(
      path.join(OUT_DIR, "verification.json"),
      JSON.stringify(results, null, 2),
      "utf8",
    );

    const failures = [];
    for (const asset of results.assets) {
      if (asset.status !== 200 || asset.bytes === 0) {
        failures.push(`asset ${asset.url} status=${asset.status}`);
      }
    }
    const aspectRatio = (logo) => logo.rect.w / logo.rect.h;
    for (const entry of results.pages) {
      if (entry.top.brokenImages.length > 0) {
        failures.push(`${entry.key}/${entry.name} broken top images`);
      }
      if (entry.bottom.brokenImages.length > 0) {
        failures.push(`${entry.key}/${entry.name} broken bottom images`);
      }
      const headerLogos = entry.top.logos.filter((logo) =>
        /logo_(pc|mobile)\.png$/.test(logo.currentSrc),
      );
      const visible = headerLogos.filter((logo) => logo.visible);
      const expected = entry.mobile ? "logo_mobile.png" : "logo_pc.png";
      if (visible.length !== 1) {
        failures.push(
          `${entry.key}/${entry.name} visible header logos=${visible.length}`,
        );
      } else {
        if (!visible[0].currentSrc.endsWith(expected)) {
          failures.push(
            `${entry.key}/${entry.name} expected ${expected} got ${visible[0].currentSrc}`,
          );
        }
        if (!visible[0].complete || visible[0].naturalWidth === 0) {
          failures.push(`${entry.key}/${entry.name} header logo not loaded`);
        }
        if (Math.abs(aspectRatio(visible[0]) / (394 / 73) - 1) > 0.03) {
          failures.push(
            `${entry.key}/${entry.name} header logo aspect=${aspectRatio(visible[0]).toFixed(2)}`,
          );
        }
      }
      const footerLogo = entry.bottom.logos.find((logo) =>
        logo.currentSrc.endsWith("logo_footer.png"),
      );
      if (!footerLogo || !footerLogo.visible) {
        failures.push(`${entry.key}/${entry.name} footer logo missing`);
      } else {
        if (!footerLogo.complete || footerLogo.naturalWidth === 0) {
          failures.push(`${entry.key}/${entry.name} footer logo not loaded`);
        }
        if (Math.abs(aspectRatio(footerLogo) / (194 / 36) - 1) > 0.03) {
          failures.push(
            `${entry.key}/${entry.name} footer logo aspect=${aspectRatio(footerLogo).toFixed(2)}`,
          );
        }
      }
    }

    console.log(JSON.stringify({ ...results, failures }, null, 2));
    if (failures.length > 0) {
      console.error(`FAIL: ${failures.join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

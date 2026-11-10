import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.env.BASE_URL ?? "http://100.83.116.15:8780/5060do/";
const CLASSIC_URL = new URL("classic/", BASE_URL).toString();
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "styleguide-20261107"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9341);
const PROFILE_DIR = path.join(tmpdir(), `5060do-style-${Date.now()}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCondition = async (cdp, sessionId, expression, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return true;
    await sleep(250);
  }
  return false;
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
  const close = modal.querySelector('[data-testid="detail-modal-close"]');
  const apply = modal.querySelector('[data-testid="detail-modal-apply"]');
  const closeRect = close ? close.getBoundingClientRect() : null;
  const modalRect = modal.getBoundingClientRect();
  return {
    visible: true,
    width: box(modal).w,
    modalTop: round(modalRect.top),
    modalBottom: round(modalRect.bottom),
    modalInViewport: modalRect.top >= -1 && modalRect.bottom <= window.innerHeight + 1,
    close: close ? box(close) : null,
    closeInViewport: closeRect
      ? closeRect.top >= -1 && closeRect.bottom <= window.innerHeight + 1
      : false,
    applyHeight: apply ? box(apply).h : null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const JOB_MODAL_MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (el) => el ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) } : null;
  const modal = document.querySelector('[data-testid="job-detail-modal"]');
  if (!modal) return { visible: false };
  const close = modal.querySelector('[data-testid="job-detail-close"]');
  const source = modal.querySelector('[data-testid="job-source-link"]');
  const closeRect = close ? close.getBoundingClientRect() : null;
  const modalRect = modal.getBoundingClientRect();
  return {
    visible: true,
    width: box(modal).w,
    modalTop: round(modalRect.top),
    modalBottom: round(modalRect.bottom),
    modalInViewport: modalRect.top >= -1 && modalRect.bottom <= window.innerHeight + 1,
    close: close ? box(close) : null,
    closeInViewport: closeRect
      ? closeRect.top >= -1 && closeRect.bottom <= window.innerHeight + 1
      : false,
    sourceHeight: source ? box(source).h : null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

// Audits the rendered page (or one opened layer) instead of named selectors:
// every visible text node must stay at or above the 14px caption floor and
// every visible touch target must keep a 48x48px box
// (docs/STYLE_GUIDE.md §1, §3, §4).
const auditExpression = (scope) => `(() => {
  const scope = ${scope} ?? document.body;
  const round = (value) => Math.round(value * 10) / 10;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (value) => {
    if (!value) return null;
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
  const composite = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
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
  const isVisible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const ignored = (el) =>
    el.closest('[aria-hidden="true"], script, style, noscript, .sr-only') !== null;
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    testid: el.getAttribute('data-testid') || null,
    className: String(el.className || '').slice(0, 120),
  });

  const fontViolations = [];
  const contrastViolations = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || ignored(el) || !isVisible(el)) continue;
    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    if (fontSize < 14) {
      fontViolations.push({ ...describe(el), text: text.slice(0, 40), fontSize: round(fontSize) });
    }
    const fg = rgb(getComputedStyle(el).color);
    const bg = backdrop(el);
    if (fg && bg) {
      const value = contrast(composite(fg, bg), bg);
      if (value < 4.5) {
        contrastViolations.push({ ...describe(el), text: text.slice(0, 40), contrast: value });
      }
    }
  }

  const smallTargets = [];
  const interactive = scope.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="link"]',
  );
  for (const el of interactive) {
    if (ignored(el) || !isVisible(el) || el.disabled) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 48 || rect.height < 48) {
      smallTargets.push({
        ...describe(el),
        text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
        width: round(rect.width),
        height: round(rect.height),
      });
    }
  }

  return {
    fontViolations: fontViolations.slice(0, 15),
    fontViolationCount: fontViolations.length,
    contrastViolations: contrastViolations.slice(0, 15),
    contrastViolationCount: contrastViolations.length,
    smallTargets: smallTargets.slice(0, 15),
    smallTargetCount: smallTargets.length,
    bodyContrast: (() => {
      const fg = rgb(getComputedStyle(document.body).color);
      const bg = backdrop(document.body);
      return fg && bg ? contrast(composite(fg, bg), bg) : null;
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const AUDIT = auditExpression("document.body");

const layerAudit = (selector) =>
  auditExpression(`document.querySelector('${selector}')`);

const CHATBOT_MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (el) => el ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) } : null;
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), ...box(el) };
  };
  const inViewport = (value) =>
    Boolean(value) && value.top >= -1 && value.bottom <= window.innerHeight + 1;
  const panel = document.querySelector('[data-testid="chatbot-panel"]');
  if (!panel) return { visible: false };
  const close = panel.querySelector('[data-testid="chatbot-close"]');
  const header = close ? close.parentElement : null;
  const chips = Array.from(panel.querySelectorAll('[data-testid^="chatbot-chip-"]')).map(box);
  const input = panel.querySelector('[data-testid="chatbot-input"]');
  const message = panel.querySelector('[data-testid="chatbot-message"] p');
  const send = panel.querySelector('[data-testid="chatbot-send"]');
  const panelRect = rect(panel);
  const closeRect = rect(close);
  return {
    visible: true,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panel: panelRect,
    close: closeRect,
    closeInViewport: inViewport(closeRect),
    panelInViewport: inViewport(panelRect),
    headerPosition: header ? getComputedStyle(header).position : null,
    headerRect: rect(header),
    chips,
    minChipWidth: chips.length ? Math.min(...chips.map((chip) => chip.w)) : null,
    minChipHeight: chips.length ? Math.min(...chips.map((chip) => chip.h)) : null,
    input: input ? { ...rect(input), fontSize: round(parseFloat(getComputedStyle(input).fontSize)) } : null,
    send: rect(send),
    messageFontSize: message ? round(parseFloat(getComputedStyle(message).fontSize)) : null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const DRAWER_MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (el) => el ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) } : null;
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), ...box(el) };
  };
  const inViewport = (value) =>
    Boolean(value) && value.top >= -1 && value.bottom <= window.innerHeight + 1;
  const drawer = document.querySelector('[data-testid="menu-drawer"]');
  if (!drawer) return { visible: false };
  const close = drawer.querySelector('[data-testid="menu-drawer-close"]');
  const shortcuts = Array.from(drawer.querySelectorAll('[data-testid^="menu-shortcut-"]')).map(box);
  const links = Array.from(drawer.querySelectorAll('a[href]')).map(box);
  const targets = [...shortcuts, ...links].filter(Boolean);
  const drawerRect = rect(drawer);
  const closeRect = rect(close);
  return {
    visible: true,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    drawer: drawerRect,
    close: closeRect,
    closeInViewport: inViewport(closeRect),
    drawerInViewport: inViewport(drawerRect),
    shortcutCount: shortcuts.length,
    minTargetWidth: targets.length ? Math.min(...targets.map((target) => target.w)) : null,
    minTargetHeight: targets.length ? Math.min(...targets.map((target) => target.h)) : null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

// Restored classic footer (TASK 5060DO-20261110-1255): the address, fax,
// copyright and family-site select must be visible and reachable at every
// viewport, not just on desktop.
const FOOTER_MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (el) => el ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) } : null;
  const footer = document.querySelector('[data-testid="classic-footer"]');
  if (!footer) return { visible: false };
  const text = (footer.textContent || '').replace(/\\s+/g, ' ');
  const select = footer.querySelector('[data-testid="classic-family-site"]');
  const logo = document.querySelector('[data-testid="classic-header"] a[aria-label="원본 메뉴형 홈으로 이동"]');
  return {
    visible: true,
    hasAddress: text.includes('부산광역시 남구 이기대공원로 18'),
    hasFax: text.includes('051-628-5064'),
    hasCopyright: text.includes('All rights reserved'),
    hasBusinessNumber: text.includes('619-82-71998'),
    logo: box(logo),
    tel: box(footer.querySelector('[data-testid="classic-footer-tel"]')),
    email: box(footer.querySelector('a[href^="mailto:"]')),
    location: box(footer.querySelector('[data-testid="classic-footer-location"]')),
    policies: Array.from(footer.querySelectorAll('ul a[href]')).map(box),
    select: select
      ? { ...box(select), optionCount: select.options.length }
      : null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const CLASSIC_DRAWER_GROUPS = `(() => {
  const drawer = document.querySelector('[data-testid="classic-drawer"]');
  if (!drawer) return { visible: false, count: 0, labels: [] };
  const items = Array.from(drawer.querySelectorAll('button[data-testid^="classic-accordion-"]'));
  return {
    visible: true,
    count: items.length,
    labels: items.map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()),
  };
})()`;

const CLASSIC_MEGA = `(() => {
  const mega = document.querySelector('[data-testid="classic-mega-menu"]');
  if (!mega) return { visible: false };
  const style = getComputedStyle(mega);
  const rect = mega.getBoundingClientRect();
  const groupButtons = Array.from(mega.querySelectorAll('ul button'));
  const links = Array.from(mega.querySelectorAll('a[href]'));
  return {
    visible: style.display !== 'none' && rect.height > 1,
    groupCount: groupButtons.length,
    linkCount: links.length,
    minLinkHeight: links.length ? Math.min(...links.map((el) => el.getBoundingClientRect().height)) : null,
  };
})()`;

const CLASSIC_GNB_LABELS = `(() => {
  const items = Array.from(document.querySelectorAll('[data-testid^="classic-gnb-item-"]'));
  return items.map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim());
})()`;

const CLASSIC_MENU_LABELS = ["센터소개", "생애설계", "교육/강좌", "일자리/사회공헌", "커뮤니티", "시설/대관"];

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
    classicUrl: CLASSIC_URL,
    checkedAt: new Date().toISOString(),
    checks: [],
    viewports: [],
    classic: [],
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
      { name: "tablet-768", width: 768, height: 1024, mobile: false, expectedColumns: 2 },
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
      const audit = await evaluate(cdp, sessionId, AUDIT);
      const topShot = await screenshot(cdp, sessionId, `${viewport.name}-top.png`);

      await evaluate(cdp, sessionId, `document.querySelector('#programs').scrollIntoView({ block: 'start' })`);
      await sleep(500);
      const programsShot = await screenshot(cdp, sessionId, `${viewport.name}-programs.png`);

      results.screenshots.push(topShot, programsShot);
      results.viewports.push({ ...viewport, metrics, audit, screenshots: [topShot, programsShot] });

      const label = `${viewport.width}px`;
      check(`${label} 카드 수 ${viewport.expectedColumns}열`, metrics.gridColumns === viewport.expectedColumns, metrics.gridColumns);
      check(`${label} 가로 스크롤 없음`, !metrics.horizontalOverflow, {
        scrollWidth: metrics.documentScrollWidth,
        clientWidth: metrics.documentClientWidth,
      });
      check(`${label} 카드 CTA 높이 52~60px`, metrics.card?.ctaHeight >= 52 && metrics.card?.ctaHeight <= 60, metrics.card?.ctaHeight);
      check(`${label} 카드 모서리 24px`, metrics.card?.radius === 24, metrics.card?.radius);
      check(`${label} 카드 패딩 24px`, metrics.card?.padding === 24, metrics.card?.padding);
      check(`${label} 카드 제목 18px 이상`, metrics.card?.titleFontSize >= 18, metrics.card?.titleFontSize);
      check(`${label} 본문 대비 7:1 이상`, metrics.bodyContrast >= 7 && audit.bodyContrast >= 7, {
        body: metrics.bodyContrast,
        audit: audit.bodyContrast,
      });
      check(`${label} 카드 요약 대비 7:1 이상`, metrics.card?.summaryContrast >= 7, metrics.card?.summaryContrast);
      check(`${label} 상태 칩 높이 52~56px`, metrics.chipHeight >= 52 && metrics.chipHeight <= 56, metrics.chipHeight);
      check(`${label} 상태 칩 대비 4.5:1 이상`, (metrics.chips ?? []).every((chip) => chip.contrast >= 4.5), metrics.chips);

      check(`${label} 헤더 72px`, Math.round(metrics.headerHeight) === 72, metrics.headerHeight);
      check(`${label} 대표 CTA 56px`, metrics.heroCtaHeight === 56, metrics.heroCtaHeight);

      check(`${label} 모든 글자 14px 이상`, audit.fontViolationCount === 0, {
        count: audit.fontViolationCount,
        violations: audit.fontViolations,
      });
      check(`${label} 모든 터치 타깃 48x48px 이상`, audit.smallTargetCount === 0, {
        count: audit.smallTargetCount,
        violations: audit.smallTargets,
      });
      check(`${label} 모든 글자 대비 4.5:1 이상`, audit.contrastViolationCount === 0, {
        count: audit.contrastViolationCount,
        violations: audit.contrastViolations,
      });

      if (viewport.width < 768) {
        check(`${label} 하단 메뉴 64px`, Math.round(metrics.bottomNav?.height) === 64, metrics.bottomNav?.height);
        check(`${label} 탭 5개`, metrics.bottomNav?.tabCount === 5, metrics.bottomNav?.tabCount);
        check(
          `${label} 탭 터치 48x48 이상`,
          metrics.bottomNav?.minTabWidth >= 48 && metrics.bottomNav?.minTabHeight >= 48,
          { width: metrics.bottomNav?.minTabWidth, height: metrics.bottomNav?.minTabHeight },
        );
        check(`${label} 탭 라벨 14px 이상 bold`, metrics.bottomNav?.minLabelFontSize >= 14 && metrics.bottomNav?.labelsBold, {
          fontSize: metrics.bottomNav?.minLabelFontSize,
          bold: metrics.bottomNav?.labelsBold,
        });
        check(`${label} 하단 메뉴 표시`, metrics.bottomNav?.display !== "none", metrics.bottomNav?.display);
      } else {
        check(`${label} 하단 메뉴 숨김`, metrics.bottomNav?.display === "none", metrics.bottomNav?.display);
      }

      if (viewport.width === 1280) {
        check("데스크톱 카드 30개(페이지 크기)", metrics.cardCount === 30, metrics.cardCount);
      }

      const classicLoaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: CLASSIC_URL }, sessionId);
      await classicLoaded;
      await sleep(1400);
      const classicAudit = await evaluate(cdp, sessionId, AUDIT);
      const classicShot = await screenshot(cdp, sessionId, `${viewport.name}-classic.png`);
      results.screenshots.push(classicShot);
      results.classic.push({ ...viewport, audit: classicAudit, screenshot: classicShot });

      check(`${label} 클래식 가로 스크롤 없음`, !classicAudit.horizontalOverflow, classicAudit.horizontalOverflow);
      check(`${label} 클래식 모든 글자 14px 이상`, classicAudit.fontViolationCount === 0, {
        count: classicAudit.fontViolationCount,
        violations: classicAudit.fontViolations,
      });
      check(`${label} 클래식 모든 터치 타깃 48x48px 이상`, classicAudit.smallTargetCount === 0, {
        count: classicAudit.smallTargetCount,
        violations: classicAudit.smallTargets,
      });
      check(`${label} 클래식 모든 글자 대비 4.5:1 이상`, classicAudit.contrastViolationCount === 0, {
        count: classicAudit.contrastViolationCount,
        violations: classicAudit.contrastViolations,
      });
      check(`${label} 클래식 본문 대비 7:1 이상`, classicAudit.bodyContrast >= 7, classicAudit.bodyContrast);

      const footer = await evaluate(cdp, sessionId, FOOTER_MEASURE);
      results.classic[results.classic.length - 1].footer = footer;
      check(`${label} 클래식 푸터 주소·팩스 표시`, footer.visible && footer.hasAddress && footer.hasFax, {
        address: footer.hasAddress,
        fax: footer.hasFax,
      });
      check(
        `${label} 클래식 푸터 저작권·사업자번호 표시`,
        footer.hasCopyright && footer.hasBusinessNumber,
        { copyright: footer.hasCopyright, businessNumber: footer.hasBusinessNumber },
      );
      check(
        `${label} 클래식 푸터 연락처 링크 48x48px 이상`,
        [footer.tel, footer.email, footer.location].every(
          (target) => target && target.w >= 48 && target.h >= 48,
        ),
        { tel: footer.tel, email: footer.email, location: footer.location },
      );
      check(
        `${label} 클래식 패밀리 사이트 셀렉트 48px · 옵션 4개`,
        Boolean(footer.select) &&
          footer.select.h >= 48 &&
          footer.select.w >= 48 &&
          footer.select.optionCount === 4,
        footer.select,
      );
      check(
        `${label} 클래식 푸터 정책 링크 48x48px 이상`,
        footer.policies.length === 2 &&
          footer.policies.every((target) => target.w >= 48 && target.h >= 48),
        footer.policies,
      );
      check(
        `${label} 클래식 헤더 로고 링크 48x48px 이상`,
        Boolean(footer.logo) && footer.logo.w >= 48 && footer.logo.h >= 48,
        footer.logo,
      );

      const classicChatbot = await evaluate(
        cdp,
        sessionId,
        `(() => {
          const trigger = document.querySelector('[data-testid="chatbot-trigger"]');
          if (!trigger) return { visible: false };
          const style = getComputedStyle(trigger);
          const rect = trigger.getBoundingClientRect();
          const round = (value) => Math.round(value * 10) / 10;
          return {
            visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
            width: round(rect.width),
            height: round(rect.height),
            inViewport:
              rect.top >= -1 &&
              rect.bottom <= window.innerHeight + 1 &&
              rect.left >= -1 &&
              rect.right <= window.innerWidth + 1,
            right: round(rect.right),
            bottom: round(rect.bottom),
          };
        })()`,
      );
      results.classic[results.classic.length - 1].chatbotTrigger = classicChatbot;
      check(
        `${label} 클래식 챗봇 버튼 표시·48x48px 이상`,
        classicChatbot.visible && classicChatbot.width >= 48 && classicChatbot.height >= 48,
        classicChatbot,
      );

      if (viewport.width === 390) {
        await evaluate(cdp, sessionId, click("chatbot-trigger"));
        await sleep(700);
        const classicChatbotPanel = await evaluate(cdp, sessionId, CHATBOT_MEASURE);
        const classicChatbotAudit = await evaluate(
          cdp,
          sessionId,
          layerAudit('[data-testid="chatbot-panel"]'),
        );
        results.classicChatbot = { ...classicChatbotPanel, audit: classicChatbotAudit };
        check(
          "390px 클래식 챗봇 패널 표시·뷰포트 안",
          classicChatbotPanel.visible === true && classicChatbotPanel.panelInViewport === true,
          classicChatbotPanel.panel,
        );
        check(
          "390px 클래식 챗봇 닫기 48px 이상 + 화면 안",
          classicChatbotPanel.close?.w >= 48 &&
            classicChatbotPanel.close?.h >= 48 &&
            classicChatbotPanel.closeInViewport,
          classicChatbotPanel.close,
        );
        check(
          "390px 클래식 챗봇 모든 글자 14px 이상",
          classicChatbotAudit.fontViolationCount === 0,
          { count: classicChatbotAudit.fontViolationCount, violations: classicChatbotAudit.fontViolations },
        );
        check(
          "390px 클래식 챗봇 모든 터치 타깃 48x48px 이상",
          classicChatbotAudit.smallTargetCount === 0,
          { count: classicChatbotAudit.smallTargetCount, violations: classicChatbotAudit.smallTargets },
        );
        check(
          "390px 클래식 챗봇 가로 스크롤 없음",
          !classicChatbotPanel.horizontalOverflow && !classicChatbotAudit.horizontalOverflow,
          {
            measure: classicChatbotPanel.horizontalOverflow,
            audit: classicChatbotAudit.horizontalOverflow,
          },
        );
        results.screenshots.push(
          await screenshot(cdp, sessionId, "mobile-390-classic-chatbot-open.png"),
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
          sessionId,
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
          sessionId,
        );
        await sleep(300);
        const classicChatClosed = !(await evaluate(
          cdp,
          sessionId,
          `Boolean(document.querySelector('[data-testid="chatbot-panel"]'))`,
        ));
        check("390px 클래식 챗봇 Esc 닫기", classicChatClosed === true, classicChatClosed);

        await evaluate(cdp, sessionId, click("classic-menu-button"));
        await sleep(600);
        const classicDrawer = await evaluate(cdp, sessionId, CLASSIC_DRAWER_GROUPS);
        results.classicDrawer = classicDrawer;
        check(
          "390px 클래식 드로어 대메뉴 6개",
          classicDrawer.visible === true && classicDrawer.count === 6,
          { visible: classicDrawer.visible, count: classicDrawer.count },
        );
        check(
          "390px 클래식 드로어 대메뉴 이름 일치",
          classicDrawer.labels.length === CLASSIC_MENU_LABELS.length &&
            CLASSIC_MENU_LABELS.every((label, index) => classicDrawer.labels[index] === label),
          classicDrawer.labels,
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
          sessionId,
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
          sessionId,
        );
        await sleep(400);
      }

      if (viewport.width === 1280) {
        const gnb = await evaluate(
          cdp,
          sessionId,
          `document.querySelectorAll('[data-testid^="classic-gnb-item-"]').length`,
        );
        check("클래식 GNB 6개 메뉴", gnb === 6, gnb);

        const gnbLabels = await evaluate(cdp, sessionId, CLASSIC_GNB_LABELS);
        check(
          "클래식 GNB 메뉴 이름 일치",
          gnbLabels.length === CLASSIC_MENU_LABELS.length &&
            CLASSIC_MENU_LABELS.every((label, index) => gnbLabels[index] === label),
          gnbLabels,
        );

        const gnbPoint = await evaluate(
          cdp,
          sessionId,
          `(() => {
            const el = document.querySelector('[data-testid="classic-gnb-item-0"]');
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            };
          })()`,
        );
        const megaOpened = Boolean(gnbPoint);
        if (gnbPoint) {
          await cdp.send(
            "Input.dispatchMouseEvent",
            { type: "mouseMoved", x: gnbPoint.x, y: gnbPoint.y },
            sessionId,
          );
        }
        await sleep(600);
        const mega = await evaluate(cdp, sessionId, CLASSIC_MEGA);
        results.classic[results.classic.length - 1].mega = mega;
        check(
          "클래식 GNB 하위 메뉴 열림",
          megaOpened === true && mega.visible === true && mega.linkCount > 0,
          { opened: megaOpened, ...mega },
        );
        check("클래식 GNB 하위 메뉴 대분류 6개", mega.groupCount === 6, mega.groupCount);
        check(
          "클래식 GNB 하위 링크 48px 이상",
          mega.minLinkHeight >= 48,
          mega.minLinkHeight,
        );
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
    check("390px 목록형 표 표시", listState.tableVisible === false, listState.tableVisible);
    check("390px 목록형 목 카드 표시", listState.mobileListVisible === true, listState.mobileListVisible);
    check("390px 목록형 가로 스크롤 없음", !listState.horizontalOverflow, listState.horizontalOverflow);
    results.screenshots.push(await screenshot(cdp, sessionId, "mobile-390-list.png"));

    await evaluate(cdp, sessionId, click("view-toggle-card"));
    await sleep(400);
    await evaluate(cdp, sessionId, openFirstCard);
    await sleep(500);
    const modalState = await evaluate(cdp, sessionId, MODAL_MEASURE);
    results.mobileModal = modalState;
    check("390px 상세 모달 표시", modalState.visible === true, modalState.visible);
    check("390px 신청 버튼 56px", modalState.applyHeight === 56, modalState.applyHeight);
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
    check("390px 이름 입력 52px", formState.name?.box.h === 52, formState.name?.box.h);
    check("390px 연락처 입력 52px", formState.phone?.box.h === 52, formState.phone?.box.h);
    check("390px 입력 글자 18px (자동 줌 차단)", formState.name?.fontSize === 18 && formState.phone?.fontSize === 18, {
      name: formState.name?.fontSize,
      phone: formState.phone?.fontSize,
    });
    check("390px 결제 버튼 56px", formState.payButton?.box.h === 56, formState.payButton?.box.h);
    check("390px 라벨 18px", formState.labelFontSize === 18, formState.labelFontSize);
    check("390px 폼 가로 스크롤 없음", !formState.horizontalOverflow, formState.horizontalOverflow);
    results.screenshots.push(await screenshot(cdp, sessionId, "mobile-390-form.png"));

    // Opened-layer audits: reopen each dialog from a clean state, then repeat the
    // font/touch/contrast audit inside that layer (TASK 5060DO-20261108-2110).
    const freshLoaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
    await freshLoaded;
    await sleep(1400);

    await evaluate(cdp, sessionId, click("chatbot-trigger"));
    await sleep(700);
    const chatbot = await evaluate(cdp, sessionId, CHATBOT_MEASURE);
    const chatbotAudit = await evaluate(
      cdp,
      sessionId,
      layerAudit('[data-testid="chatbot-panel"]'),
    );
    results.chatbotLayer = { ...chatbot, audit: chatbotAudit };
    check("390px 챗봇 패널 표시", chatbot.visible === true, chatbot.visible);
    check("390px 챗봇 패널 뷰포트 안", chatbot.panelInViewport === true, chatbot.panel);
    check(
      "390px 챗봇 헤더 sticky 고정",
      chatbot.headerPosition === "sticky",
      chatbot.headerPosition,
    );
    check(
      "390px 챗봇 닫기 48px 이상 + 화면 안",
      chatbot.close?.w >= 48 && chatbot.close?.h >= 48 && chatbot.closeInViewport,
      chatbot.close,
    );
    check(
      "390px 챗봇 퀵 질문 48x48px 이상",
      chatbot.minChipWidth >= 48 && chatbot.minChipHeight >= 48,
      { width: chatbot.minChipWidth, height: chatbot.minChipHeight },
    );
    check(
      "390px 챗봇 입력창 52px · 글자 14px 이상",
      chatbot.input?.h >= 48 && chatbot.input?.fontSize >= 14,
      chatbot.input,
    );
    check(
      "390px 챗봇 보내기 48x48px 이상",
      chatbot.send?.w >= 48 && chatbot.send?.h >= 48,
      chatbot.send,
    );
    check(
      "390px 챗봇 메시지 글자 14px 이상",
      chatbot.messageFontSize >= 14,
      chatbot.messageFontSize,
    );
    check(
      "390px 챗봇 모든 글자 14px 이상",
      chatbotAudit.fontViolationCount === 0,
      { count: chatbotAudit.fontViolationCount, violations: chatbotAudit.fontViolations },
    );
    check(
      "390px 챗봇 모든 터치 타깃 48x48px 이상",
      chatbotAudit.smallTargetCount === 0,
      { count: chatbotAudit.smallTargetCount, violations: chatbotAudit.smallTargets },
    );
    check(
      "390px 챗봇 모든 글자 대비 4.5:1 이상",
      chatbotAudit.contrastViolationCount === 0,
      { count: chatbotAudit.contrastViolationCount, violations: chatbotAudit.contrastViolations },
    );
    check(
      "390px 챗봇 가로 스크롤 없음",
      !chatbot.horizontalOverflow,
      chatbot.horizontalOverflow,
    );
    results.screenshots.push(
      await screenshot(cdp, sessionId, "mobile-390-chatbot-open.png"),
    );

    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
      sessionId,
    );
    await sleep(300);
    const chatbotEscClosed = !(await evaluate(
      cdp,
      sessionId,
      `Boolean(document.querySelector('[data-testid="chatbot-panel"]'))`,
    ));
    check("390px 챗봇 Esc 닫기", chatbotEscClosed === true, chatbotEscClosed);

    await evaluate(cdp, sessionId, click("chatbot-trigger"));
    await sleep(400);
    const overlayClicked = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const panel = document.querySelector('[data-testid="chatbot-panel"]');
        if (!panel) return false;
        panel.parentElement.click();
        return true;
      })()`,
    );
    await sleep(300);
    const chatbotOverlayClosed =
      overlayClicked &&
      !(await evaluate(
        cdp,
        sessionId,
        `Boolean(document.querySelector('[data-testid="chatbot-panel"]'))`,
      ));
    check("390px 챗봇 오버레이 클릭 닫기", chatbotOverlayClosed === true, chatbotOverlayClosed);

    await evaluate(cdp, sessionId, click("bottom-tab-menu"));
    await sleep(600);
    const drawer = await evaluate(cdp, sessionId, DRAWER_MEASURE);
    const drawerAudit = await evaluate(
      cdp,
      sessionId,
      layerAudit('[data-testid="menu-drawer"]'),
    );
    results.drawerLayer = { ...drawer, audit: drawerAudit };
    check("390px 전체 메뉴 드로어 표시", drawer.visible === true, drawer.visible);
    check("390px 드로어 뷰포트 안", drawer.drawerInViewport === true, drawer.drawer);
    check(
      "390px 드로어 닫기 48px 이상 + 화면 안",
      drawer.close?.w >= 48 && drawer.close?.h >= 48 && drawer.closeInViewport,
      drawer.close,
    );
    check(
      "390px 드로어 바로가기 3개",
      drawer.shortcutCount === 3,
      drawer.shortcutCount,
    );
    check(
      "390px 드로어 링크 48x48px 이상",
      drawer.minTargetWidth >= 48 && drawer.minTargetHeight >= 48,
      { width: drawer.minTargetWidth, height: drawer.minTargetHeight },
    );
    check(
      "390px 드로어 모든 글자 14px 이상",
      drawerAudit.fontViolationCount === 0,
      { count: drawerAudit.fontViolationCount, violations: drawerAudit.fontViolations },
    );
    check(
      "390px 드로어 모든 터치 타깃 48x48px 이상",
      drawerAudit.smallTargetCount === 0,
      { count: drawerAudit.smallTargetCount, violations: drawerAudit.smallTargets },
    );
    check(
      "390px 드로어 모든 글자 대비 4.5:1 이상",
      drawerAudit.contrastViolationCount === 0,
      { count: drawerAudit.contrastViolationCount, violations: drawerAudit.contrastViolations },
    );
    check(
      "390px 드로어 가로 스크롤 없음",
      !drawer.horizontalOverflow,
      drawer.horizontalOverflow,
    );
    results.screenshots.push(
      await screenshot(cdp, sessionId, "mobile-390-drawer-open.png"),
    );
    await evaluate(cdp, sessionId, click("menu-drawer-close"));
    await sleep(400);

    await evaluate(cdp, sessionId, openFirstCard);
    await sleep(600);
    const modalLayer = await evaluate(cdp, sessionId, MODAL_MEASURE);
    const modalAudit = await evaluate(
      cdp,
      sessionId,
      layerAudit('[data-testid="detail-modal"]'),
    );
    results.modalLayer = { ...modalLayer, audit: modalAudit };
    check("390px 열린 상세 모달 표시", modalLayer.visible === true, modalLayer.visible);
    check(
      "390px 열린 상세 모달 뷰포트 안",
      modalLayer.modalInViewport === true,
      { top: modalLayer.modalTop, bottom: modalLayer.modalBottom },
    );
    check(
      "390px 상세 모달 닫기 48px 이상 + 화면 안",
      modalLayer.close?.w >= 48 && modalLayer.close?.h >= 48 && modalLayer.closeInViewport,
      modalLayer.close,
    );
    check(
      "390px 열린 상세 모달 신청 버튼 56px",
      modalLayer.applyHeight === 56,
      modalLayer.applyHeight,
    );
    check(
      "390px 열린 상세 모달 모든 글자 14px 이상",
      modalAudit.fontViolationCount === 0,
      { count: modalAudit.fontViolationCount, violations: modalAudit.fontViolations },
    );
    check(
      "390px 열린 상세 모달 모든 터치 타깃 48x48px 이상",
      modalAudit.smallTargetCount === 0,
      { count: modalAudit.smallTargetCount, violations: modalAudit.smallTargets },
    );
    check(
      "390px 열린 상세 모달 모든 글자 대비 4.5:1 이상",
      modalAudit.contrastViolationCount === 0,
      { count: modalAudit.contrastViolationCount, violations: modalAudit.contrastViolations },
    );
    check(
      "390px 열린 상세 모달 가로 스크롤 없음",
      !modalLayer.horizontalOverflow,
      modalLayer.horizontalOverflow,
    );
    results.screenshots.push(
      await screenshot(cdp, sessionId, "mobile-390-modal-open.png"),
    );

    // Job detail modal (TASK 5060DO-20261108-2200): audit the opened layer at
    // every viewport so tablet and desktop keep the 48px close target, the 56px
    // source CTA, the 14px text floor and zero horizontal scroll.
    await evaluate(cdp, sessionId, click("detail-modal-close"));
    await sleep(400);

    const openFirstJob = `(() => {
      const card = document.querySelector('[data-testid="job-card"]');
      if (!card) return false;
      card.click();
      return true;
    })()`;
    const jobModalOpenExpr = `Boolean(document.querySelector('[data-testid="job-detail-modal"]'))`;

    results.jobModals = [];
    for (const viewport of viewports) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile },
        sessionId,
      );
      const jobPageLoaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
      await jobPageLoaded;
      await sleep(1400);
      await evaluate(
        cdp,
        sessionId,
        `document.querySelector('#jobs').scrollIntoView({ block: 'start', behavior: 'instant' })`,
      );
      const jobsReady = await waitForCondition(
        cdp,
        sessionId,
        `document.querySelectorAll('[data-testid="job-card"]').length > 0`,
        20000,
      );
      const jobLabel = `${viewport.width}px`;
      check(`${jobLabel} 채용정보 카드 로드`, jobsReady === true, jobsReady);

      const jobOpened = await evaluate(cdp, sessionId, openFirstJob);
      await sleep(600);
      const jobModal = await evaluate(cdp, sessionId, JOB_MODAL_MEASURE);
      const jobAudit = await evaluate(
        cdp,
        sessionId,
        layerAudit('[data-testid="job-detail-modal"]'),
      );
      const jobScreenshot = await screenshot(
        cdp,
        sessionId,
        `${viewport.name}-job-modal-open.png`,
      );
      results.jobModals.push({
        ...viewport,
        ready: jobsReady,
        modal: jobModal,
        audit: jobAudit,
        screenshot: jobScreenshot,
      });
      results.screenshots.push(jobScreenshot);
      if (viewport.width === 390) {
        results.jobsReady = jobsReady;
        results.jobModalLayer = { ...jobModal, audit: jobAudit };
      }

      check(
        `${jobLabel} 채용 상세 모달 표시`,
        jobOpened === true && jobModal.visible === true,
        jobModal.visible,
      );
      check(
        `${jobLabel} 채용 상세 모달 뷰포트 안`,
        jobModal.modalInViewport === true,
        { top: jobModal.modalTop, bottom: jobModal.modalBottom },
      );
      check(
        `${jobLabel} 채용 상세 닫기 48px 이상 + 화면 안`,
        jobModal.close?.w >= 48 && jobModal.close?.h >= 48 && jobModal.closeInViewport,
        jobModal.close,
      );
      check(
        `${jobLabel} 채용 원문 링크 56px CTA`,
        jobModal.sourceHeight === 56,
        jobModal.sourceHeight,
      );
      check(
        `${jobLabel} 채용 상세 모든 글자 14px 이상`,
        jobAudit.fontViolationCount === 0,
        { count: jobAudit.fontViolationCount, violations: jobAudit.fontViolations },
      );
      check(
        `${jobLabel} 채용 상세 모든 터치 타깃 48x48px 이상`,
        jobAudit.smallTargetCount === 0,
        { count: jobAudit.smallTargetCount, violations: jobAudit.smallTargets },
      );
      check(
        `${jobLabel} 채용 상세 모든 글자 대비 4.5:1 이상`,
        jobAudit.contrastViolationCount === 0,
        { count: jobAudit.contrastViolationCount, violations: jobAudit.contrastViolations },
      );
      check(
        `${jobLabel} 채용 상세 가로 스크롤 없음`,
        !jobModal.horizontalOverflow && !jobAudit.horizontalOverflow,
        { measure: jobModal.horizontalOverflow, audit: jobAudit.horizontalOverflow },
      );

      await cdp.send(
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
        sessionId,
      );
      await cdp.send(
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
        sessionId,
      );
      await sleep(300);
      const jobEscClosed = !(await evaluate(cdp, sessionId, jobModalOpenExpr));
      check(`${jobLabel} 채용 상세 Esc 닫기`, jobEscClosed === true, jobEscClosed);

      await evaluate(cdp, sessionId, openFirstJob);
      await sleep(400);
      const jobOverlayClicked = await evaluate(
        cdp,
        sessionId,
        `(() => {
          const modal = document.querySelector('[data-testid="job-detail-modal"]');
          if (!modal) return false;
          modal.parentElement.click();
          return true;
        })()`,
      );
      await sleep(300);
      const jobOverlayClosed =
        jobOverlayClicked && !(await evaluate(cdp, sessionId, jobModalOpenExpr));
      check(
        `${jobLabel} 채용 상세 오버레이 클릭 닫기`,
        jobOverlayClosed === true,
        jobOverlayClosed,
      );

      await evaluate(cdp, sessionId, openFirstJob);
      await sleep(400);
      await evaluate(cdp, sessionId, click("job-detail-close"));
      await sleep(300);
      const jobButtonClosed = !(await evaluate(cdp, sessionId, jobModalOpenExpr));
      check(
        `${jobLabel} 채용 상세 닫기 버튼 클릭`,
        jobButtonClosed === true,
        jobButtonClosed,
      );
    }

    check("콘솔 오류 0건", results.console.length === 0, results.console);
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

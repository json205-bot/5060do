import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100/";
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "programs-20261107"),
);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9334);
const PROFILE_DIR = path.join(tmpdir(), `5060do-programs-${Date.now()}`);

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

const CHIP_STATE = `(() => {
  const chips = Array.from(document.querySelectorAll('[data-testid^="status-chip-"]'));
  return chips.map((chip) => {
    const text = (chip.textContent || '').replace(/\\s+/g, ' ').trim();
    const match = text.match(/\\[(\\d+)\\]/);
    return {
      key: (chip.getAttribute('data-testid') || '').replace('status-chip-', ''),
      label: text.replace(/\\[\\d+\\]/, '').trim(),
      count: match ? Number(match[1]) : null,
      active: chip.getAttribute('aria-pressed') === 'true',
    };
  });
})()`;

const CARD_STATE = `(() => {
  const cards = Array.from(document.querySelectorAll('[data-testid="program-card"]'));
  return {
    count: cards.length,
    statuses: cards.map((card) => card.dataset.status || ''),
    withProgress: cards.filter((card) => card.querySelector('[role="progressbar"]')).length,
    texts: cards.map((card) => (card.textContent || '').replace(/\\s+/g, ' ').trim()),
    progress: cards.map((card) => {
      const bar = card.querySelector('[role="progressbar"]');
      const now = bar ? Number(bar.getAttribute('aria-valuenow')) : 0;
      const max = bar ? Number(bar.getAttribute('aria-valuemax')) : 0;
      return { now, max, ratio: max > 0 ? Math.max(0, max - now) / max : 1 };
    }),
    gridColumns: (() => {
      const grid = document.querySelector('[data-testid="program-grid"]');
      return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const payloadRequests = new Map();

const TABLE_STATE = `(() => {
  const table = document.querySelector('[data-testid="program-table"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="program-row"]'));
  const headers = table
    ? Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim())
    : [];
  return {
    tableVisible: table ? getComputedStyle(table).display !== 'none' : false,
    headers,
    rowCount: rows.length,
    statuses: rows.map((row) => row.dataset.status || ''),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const MOBILE_STATE = `(() => {
  const list = document.querySelector('[data-testid="program-list-mobile"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="program-row-mobile"]'));
  const table = document.querySelector('[data-testid="program-table"]');
  return {
    listVisible: list ? getComputedStyle(list).display !== 'none' : false,
    rowCount: rows.length,
    statuses: rows.map((row) => row.dataset.status || ''),
    tableVisible: table ? getComputedStyle(table).display !== 'none' : false,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const MODAL_STATE = `(() => {
  const modal = document.querySelector('[data-testid="detail-modal"]');
  if (!modal) return { visible: false };
  const title = modal.querySelector('#program-dialog-title')?.textContent?.trim() ?? '';
  const buttons = Array.from(modal.querySelectorAll('button'));
  const apply = buttons.find((el) =>
    ['수강신청', '대기신청', '접수예정', '모집 마감'].includes(el.textContent.trim()),
  );
  return {
    visible: true,
    title,
    applyLabel: apply ? apply.textContent.trim() : null,
    applyDisabled: apply ? apply.disabled : null,
    formVisible: Boolean(modal.querySelector('[data-testid="apply-form"]')),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

const click = (testId) =>
  `(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return false;
    el.click();
    return true;
  })()`;

const clickFirstCardOfStatus = (status) =>
  `(() => {
    const card = document.querySelector('[data-testid="program-card"][data-status="${status}"]');
    if (!card) return false;
    card.click();
    return true;
  })()`;

const closeModal = `(() => {
  const modal = document.querySelector('[data-testid="detail-modal"]');
  if (!modal) return false;
  const close = Array.from(modal.querySelectorAll('button')).find(
    (el) => el.getAttribute('aria-label') === '상세 창 닫기',
  );
  if (!close) return false;
  close.click();
  return true;
})()`;

const STATUS_ORDER = ["접수중", "접수예정", "대기접수", "마감"];
const rank = (status) => STATUS_ORDER.indexOf(status);

const PAGE_SIZE = Number(process.env.PAGE_SIZE ?? 30);
const CARD_COUNT = `document.querySelectorAll('[data-testid="program-card"]').length`;
const LOAD_MORE_EXISTS =
  `Boolean(document.querySelector('[data-testid="load-more-programs"]'))`;

const expandAllPrograms = async (cdp, sessionId, maxClicks = 40) => {
  let clicks = 0;
  for (let index = 0; index < maxClicks; index += 1) {
    const before = await evaluate(cdp, sessionId, CARD_COUNT);
    const clicked = await evaluate(cdp, sessionId, click("load-more-programs"));
    if (!clicked) return clicks;
    clicks += 1;

    const deadline = Date.now() + 20000;
    let grew = false;
    while (Date.now() < deadline) {
      await sleep(150);
      const after = await evaluate(cdp, sessionId, CARD_COUNT);
      if (after > before) {
        grew = true;
        break;
      }
      if (!(await evaluate(cdp, sessionId, LOAD_MORE_EXISTS))) return clicks;
    }
    if (!grew) return clicks;
  }
  return clicks;
};

const waitForCondition = async (cdp, sessionId, expression, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return true;
    await sleep(200);
  }
  return false;
};

const waitForFirstPage = (cdp, sessionId, total) =>
  waitForCondition(
    cdp,
    sessionId,
    `${CARD_COUNT} === ${Math.min(PAGE_SIZE, total)}`,
  );

const readProgramsSource = (cdp, sessionId) =>
  evaluate(
    cdp,
    sessionId,
    `document.querySelector('#programs')?.dataset.programsSource ?? ''`,
  );

const waitForProgramsSource = async (cdp, sessionId, expected, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  let current = "";
  while (Date.now() < deadline) {
    current = await readProgramsSource(cdp, sessionId);
    if (current === expected) return current;
    await sleep(250);
  }
  return current;
};

function isSortedByStatus(statuses) {
  return statuses.every(
    (status, index) => index === 0 || rank(statuses[index - 1]) <= rank(status),
  );
}

function countStatuses(statuses) {
  return statuses.reduce((acc, status) => {
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
}

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
    console: [],
    screenshots: [],
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

    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });

    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        results.console.push({
          type: params.type,
          text: params.args
            .map((arg) => arg.value ?? arg.description ?? arg.type)
            .join(" "),
        });
      }
    });

    cdp.on("Network.requestWillBeSent", (params) => {
      const url = params.request?.url ?? "";
      if (!url.includes("/rest/v1/programs")) return;
      payloadRequests.set(params.requestId, {
        requestId: params.requestId,
        url,
        method: params.request?.method ?? "GET",
        status: 0,
        encodedDataLength: 0,
        rawBytes: 0,
      });
    });

    cdp.on("Network.responseReceived", (params) => {
      const entry = payloadRequests.get(params.requestId);
      if (!entry) return;
      entry.status = params.response?.status ?? entry.status;
    });

    cdp.on("Network.loadingFinished", (params) => {
      const entry = payloadRequests.get(params.requestId);
      if (!entry) return;
      entry.encodedDataLength = params.encodedDataLength;
    });

    await cdp.send("Network.enable", {}, sessionId);

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    const loadAt = async (width, height, mobile) => {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height, deviceScaleFactor: 1, mobile },
        sessionId,
      );
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: BASE_URL }, sessionId);
      await loaded;
      await sleep(1500);
    };

    await loadAt(1280, 900, false);
    results.programsSource = await waitForProgramsSource(cdp, sessionId, "supabase");
    const expectedTotal = Number(process.env.EXPECTED_TOTAL ?? 667);
    const firstPageReady = await waitForCondition(
      cdp,
      sessionId,
      `(() => {
        const cards = document.querySelectorAll('[data-testid="program-card"]').length;
        const chip = document.querySelector('[data-testid="status-chip-전체"]');
        const match = (chip?.textContent || '').match(/\\[(\\d+)\\]/);
        return cards === ${PAGE_SIZE} && match !== null && Number(match[1]) === ${expectedTotal};
      })()`,
    );
    check("초기 목록·카운트 도착", firstPageReady, { pageSize: PAGE_SIZE, expectedTotal });

    const payloadEntries = Array.from(payloadRequests.values());
    const listEntries = payloadEntries.filter((entry) => entry.method !== "HEAD");
    const countEntries = payloadEntries.filter((entry) => entry.method === "HEAD");

    for (const entry of listEntries) {
      try {
        const bodyResult = await cdp.send(
          "Network.getResponseBody",
          { requestId: entry.requestId },
          sessionId,
        );
        entry.rawBytes = bodyResult.base64Encoded
          ? Buffer.from(bodyResult.body, "base64").length
          : Buffer.byteLength(bodyResult.body);
      } catch {
        entry.rawBytes = 0;
      }
    }

    const sumBytes = (entries) =>
      entries.reduce((sum, entry) => sum + (entry.encodedDataLength || 0), 0);
    const listTransfer = sumBytes(listEntries);
    const countTransfer = sumBytes(countEntries);
    const payloadTransfer = listTransfer + countTransfer;
    const listRawBytes = listEntries.reduce((sum, entry) => sum + (entry.rawBytes || 0), 0);

    results.payload = {
      entries: payloadEntries,
      listTransfer,
      countTransfer,
      transfer: payloadTransfer,
      listRawBytes,
      baselineRawBytes: Number(process.env.EXPECTED_BASELINE_BYTES ?? 267043),
    };
    const selectiveOnly =
      payloadEntries.length > 0 &&
      payloadEntries.every(
        (entry) =>
          !entry.url.includes("select=*") &&
          !entry.url.includes("select=%2A") &&
          entry.url.includes("select="),
      );
    check("목록 조회 요청 수신", listEntries.length > 0, listEntries.length);
    check("select=* 미사용(선별 조회)", selectiveOnly, payloadEntries.map((entry) => entry.url));
    check(
      "상태별 카운트 쿼리(HEAD) 5건",
      countEntries.length === 5,
      countEntries.map((entry) => ({ url: entry.url, status: entry.status })),
    );
    check(
      "초기 목록(GET) gzip 전송량 30KB 미만",
      listTransfer > 0 && listTransfer < 30000,
      { listTransfer, countTransfer },
    );
    check(
      "초기 REST 총 전송량 30KB 미만",
      payloadTransfer > 0 && payloadTransfer < 30000,
      { payloadTransfer, baselineRawBytes: results.payload.baselineRawBytes },
    );
    check(
      "초기 목록 원본 JSON 15KB 이하",
      listRawBytes > 0 && listRawBytes <= 15000,
      { listRawBytes, rows: PAGE_SIZE },
    );
    check(
      "초기 목록 원본 전송량 90% 이상 절감",
      listRawBytes > 0 &&
        listRawBytes <= results.payload.baselineRawBytes * 0.1,
      {
        listRawBytes,
        baselineRawBytes: results.payload.baselineRawBytes,
        reductionPercent: Number(
          ((1 - listRawBytes / results.payload.baselineRawBytes) * 100).toFixed(1),
        ),
      },
    );

    const initialChips = await evaluate(cdp, sessionId, CHIP_STATE);
    results.chips = initialChips;
    const totalChip = initialChips.find((chip) => chip.key === "전체");
    check("칩 5종 렌더", initialChips.length === 5, initialChips);
    check(
      "칩 카운트 합계 = 전체",
      initialChips
        .filter((chip) => chip.key !== "전체")
        .reduce((sum, chip) => sum + (chip.count ?? 0), 0) ===
        (totalChip?.count ?? -1),
      initialChips,
    );
    const expectedStatusCounts = JSON.parse(
      process.env.EXPECTED_STATUS_COUNTS ??
        '{"접수중":7,"접수예정":1,"대기접수":7,"마감":652}',
    );
    const chipMismatch = Object.entries(expectedStatusCounts)
      .map(([key, expected]) => ({
        key,
        expected,
        actual: initialChips.find((chip) => chip.key === key)?.count ?? null,
      }))
      .filter((entry) => entry.actual !== entry.expected);
    check("상태별 칩 카운트 정확", chipMismatch.length === 0, chipMismatch);

    const pageOne = await evaluate(cdp, sessionId, CARD_STATE);
    check(
      "실시간 수파베이스 데이터 수신",
      results.programsSource === "supabase",
      results.programsSource,
    );
    check(
      "전체 강좌 수 일치",
      (totalChip?.count ?? -1) === Number(process.env.EXPECTED_TOTAL ?? 667),
      { chip: totalChip?.count, expected: Number(process.env.EXPECTED_TOTAL ?? 667) },
    );
    check(
      "첫 화면 노출 카드 = 페이지 크기",
      pageOne.count === Math.min(PAGE_SIZE, totalChip?.count ?? 0),
      { cards: pageOne.count, pageSize: PAGE_SIZE, total: totalChip?.count },
    );
    check(
      "실시간 신청현황 진행바 노출",
      pageOne.count > 0 && pageOne.withProgress === pageOne.count,
      { cards: pageOne.count, withProgress: pageOne.withProgress },
    );
    check(
      "잔여석 표기 노출",
      pageOne.texts.some((text) => /잔여 \d+석/.test(text)),
      pageOne.texts.slice(0, 3),
    );
    check(
      "더보기 버튼 노출",
      (await evaluate(
        cdp,
        sessionId,
        `Boolean(document.querySelector('[data-testid="load-more-programs"]'))`,
      )) === true,
      "load-more-programs",
    );
    const firstPageStatuses = [...pageOne.statuses];
    const firstPageTexts = [...pageOne.texts];
    const firstPageCounts = countStatuses(firstPageStatuses);
    check(
      "첫 화면 30건에 활성 강좌 전건 노출",
      firstPageCounts["접수중"] === 7 &&
        firstPageCounts["접수예정"] === 1 &&
        firstPageCounts["대기접수"] === 7,
      firstPageCounts,
    );
    const firstPageOpenRatios = pageOne.progress
      .filter((_, index) => pageOne.statuses[index] === "접수중")
      .map((item) => item.ratio);
    const firstPageOpenSorted = firstPageOpenRatios.every(
      (ratio, index) => index === 0 || firstPageOpenRatios[index - 1] <= ratio,
    );
    results.firstPageOpenRatios = firstPageOpenRatios;
    check(
      "첫 화면 접수중 잔여석 임박순",
      firstPageOpenRatios.length === 7 && firstPageOpenSorted,
      { count: firstPageOpenRatios.length, ratios: firstPageOpenRatios },
    );
    await evaluate(cdp, sessionId, click("load-more-programs"));
    const secondPageReady = await waitForCondition(
      cdp,
      sessionId,
      `${CARD_COUNT} === ${Math.min(PAGE_SIZE * 2, expectedTotal)}`,
    );
    check("더보기 후 다음 페이지 도착", secondPageReady, secondPageReady);
    const pageTwo = await evaluate(cdp, sessionId, CARD_STATE);
    check(
      "더보기 클릭 시 +페이지 크기",
      pageTwo.count === Math.min(PAGE_SIZE * 2, totalChip?.count ?? 0),
      { cards: pageTwo.count, expected: Math.min(PAGE_SIZE * 2, totalChip?.count ?? 0) },
    );
    check(
      "더보기 후 기존 카드 순서 유지",
      firstPageTexts.every((text, index) => pageTwo.texts[index] === text),
      { firstPage: firstPageTexts.slice(0, 2), pageTwo: pageTwo.texts.slice(0, 2) },
    );
    results.paging = { pageOne: pageOne.count, pageTwo: pageTwo.count };
    const rangeRequests = Array.from(payloadRequests.values()).filter(
      (entry) =>
        entry.method !== "HEAD" &&
        /offset=\d+&limit=\d+/.test(entry.url),
    );
    check(
      "범위 조회(offset/limit) 요청 확인",
      rangeRequests.some((entry) => /offset=0&limit=30/.test(entry.url)) &&
        rangeRequests.some((entry) => /offset=30&limit=30/.test(entry.url)),
      rangeRequests.map((entry) => entry.url),
    );
    await evaluate(cdp, sessionId, click("view-toggle-list"));
    await sleep(400);
    const pagedTable = await evaluate(cdp, sessionId, TABLE_STATE);
    results.pagedTable = pagedTable;
    check(
      "목록형 전환에도 페이징 데이터 유지",
      pagedTable.tableVisible && pagedTable.rowCount === pageTwo.count,
      { rows: pagedTable.rowCount, cards: pageTwo.count },
    );
    await evaluate(cdp, sessionId, click("view-toggle-card"));
    await sleep(300);
    results.loadMoreShot = await (async () => {
      const info = await evaluate(
        cdp,
        sessionId,
        `(() => {
          const el = document.querySelector('[data-testid="load-more-programs"]');
          if (!el) return { found: false };
          const rect = el.getBoundingClientRect();
          const absoluteTop = rect.top + window.scrollY;
          window.scrollTo({ top: Math.max(0, absoluteTop - window.innerHeight / 2), behavior: 'instant' });
          return { found: true, absoluteTop, scrollY: window.scrollY, viewportHeight: window.innerHeight };
        })()`,
      );
      await sleep(500);
      info.scrollY = await evaluate(cdp, sessionId, `window.scrollY`);
      const shot = await screenshot(cdp, sessionId, "desktop-1280-load-more.png");
      await evaluate(cdp, sessionId, `window.scrollTo(0, 0)`);
      await sleep(200);
      return { ...info, shot };
    })();
    results.screenshots.push(results.loadMoreShot.shot);
    await expandAllPrograms(cdp, sessionId);

    const allCards = await evaluate(cdp, sessionId, CARD_STATE);
    results.initialCards = allCards;
    check(
      "전체 카드 수 = 전체 칩",
      allCards.count === (totalChip?.count ?? -1),
      { cards: allCards.count, chip: totalChip?.count },
    );
    check("스마트 정렬 상태 우선순위", isSortedByStatus(allCards.statuses), allCards.statuses);
    check(
      "전체 카드 신청현황 진행바 노출",
      allCards.count > 0 && allCards.withProgress === allCards.count,
      { cards: allCards.count, withProgress: allCards.withProgress },
    );
    const waitingCardTexts = allCards.texts.filter(
      (_, index) => allCards.statuses[index] === "대기접수",
    );
    check(
      "대기접수 대기 인원 표기",
      waitingCardTexts.length > 0 &&
        waitingCardTexts.every((text) => /대기 \d+명 접수중/.test(text)),
      waitingCardTexts.slice(0, 3),
    );
    const firstGroup = allCards.progress.slice(
      0,
      allCards.statuses.filter((status) => status === "접수중").length,
    );
    const expandedCounts = countStatuses(allCards.statuses);
    check(
      "상태 그룹 순서·건수 일치",
      isSortedByStatus(allCards.statuses) &&
        expandedCounts["접수중"] === 7 &&
        expandedCounts["접수예정"] === 1 &&
        expandedCounts["대기접수"] === 7 &&
        expandedCounts["마감"] === 652,
      expandedCounts,
    );
    check(
      "접수중 그룹 전건 진행바 유지",
      firstGroup.length > 0,
      { 접수중: firstGroup.length },
    );
    check("PC 카드 3열", allCards.gridColumns === 3, allCards.gridColumns);
    check("PC 가로 오버플로 없음", !allCards.horizontalOverflow, allCards.horizontalOverflow);

    results.screenshots.push(
      await (async () => {
        await evaluate(
          cdp,
          sessionId,
          `document.querySelector('#programs').scrollIntoView({ block: 'start' })`,
        );
        await sleep(400);
        const shot = await screenshot(cdp, sessionId, "desktop-1280-chips-cards.png");
        await evaluate(cdp, sessionId, `window.scrollTo(0, 0)`);
        await sleep(200);
        return shot;
      })(),
    );

    results.filters = {};
    for (const status of STATUS_ORDER) {
      const chip = initialChips.find((item) => item.key === status);
      await evaluate(cdp, sessionId, click(`status-chip-${status}`));
      const arrived = await waitForFirstPage(cdp, sessionId, chip?.count ?? 0);
      check(`${status} 첫 페이지 도착`, arrived, { expected: Math.min(PAGE_SIZE, chip?.count ?? 0) });
      await expandAllPrograms(cdp, sessionId);
      const state = await evaluate(cdp, sessionId, CARD_STATE);
      const active = (await evaluate(cdp, sessionId, CHIP_STATE)).find(
        (item) => item.key === status,
      );
      const allMatch = state.statuses.every((item) => item === status);
      results.filters[status] = { chipCount: chip?.count, ...state, active };
      check(
        `${status} 필터 카드 수 일치`,
        state.count === (chip?.count ?? -1) && allMatch,
        { chip: chip?.count, cards: state.count, allMatch },
      );
      check(`${status} 칩 활성 표시`, active?.active === true, active);
    }

    await evaluate(cdp, sessionId, click("status-chip-전체"));
    const totalArrived = await waitForFirstPage(cdp, sessionId, totalChip?.count ?? 0);
    check("전체 첫 페이지 도착", totalArrived, totalArrived);
    await expandAllPrograms(cdp, sessionId);
    await evaluate(cdp, sessionId, click("view-toggle-list"));
    await sleep(500);
    const tableState = await evaluate(cdp, sessionId, TABLE_STATE);
    results.table = tableState;
    check("목록형 표 노출", tableState.tableVisible, tableState.tableVisible);
    check(
      "목록형 8개 컬럼",
      tableState.headers.length === 8,
      tableState.headers,
    );
    check(
      "목록형 행 수 = 전체",
      tableState.rowCount === (totalChip?.count ?? -1),
      { rows: tableState.rowCount, chip: totalChip?.count },
    );
    check("목록형 가로 오버플로 없음", !tableState.horizontalOverflow, tableState.horizontalOverflow);

    results.screenshots.push(
      await (async () => {
        await evaluate(
          cdp,
          sessionId,
          `document.querySelector('#programs').scrollIntoView({ block: 'start' })`,
        );
        await sleep(400);
        const shot = await screenshot(cdp, sessionId, "desktop-1280-list.png");
        await evaluate(cdp, sessionId, `window.scrollTo(0, 0)`);
        await sleep(200);
        return shot;
      })(),
    );

    const firstRowTitle = await evaluate(
      cdp,
      sessionId,
      `document.querySelector('[data-testid="program-row"] button')?.textContent?.trim() ?? ''`,
    );
    await evaluate(
      cdp,
      sessionId,
      `document.querySelector('[data-testid="program-row"] button')?.click()`,
    );
    await sleep(500);
    const rowModal = await evaluate(cdp, sessionId, MODAL_STATE);
    results.rowModal = { firstRowTitle, ...rowModal };
    check(
      "목록형 행 클릭 → 모달 연결",
      rowModal.visible && rowModal.title === firstRowTitle,
      { firstRowTitle, modal: rowModal },
    );
    results.screenshots.push(
      await screenshot(cdp, sessionId, "desktop-1280-list-modal.png"),
    );
    await evaluate(cdp, sessionId, closeModal);
    await sleep(300);

    await evaluate(cdp, sessionId, click("view-toggle-card"));
    await sleep(400);

    await evaluate(cdp, sessionId, clickFirstCardOfStatus("접수중"));
    await sleep(400);
    const openModal = await evaluate(cdp, sessionId, MODAL_STATE);
    check(
      "접수중 모달 신청 가능",
      openModal.visible && openModal.applyLabel === "수강신청" && openModal.applyDisabled === false,
      openModal,
    );
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const modal = document.querySelector('[data-testid="detail-modal"]');
        const apply = Array.from(modal.querySelectorAll('button')).find(
          (el) => el.textContent.trim() === '수강신청',
        );
        apply?.click();
        return Boolean(apply);
      })()`,
    );
    await sleep(400);
    const formState = await evaluate(cdp, sessionId, MODAL_STATE);
    check("신청 폼 전환", formState.formVisible === true, formState);
    await evaluate(cdp, sessionId, closeModal);
    await sleep(300);

    await evaluate(cdp, sessionId, clickFirstCardOfStatus("대기접수"));
    await sleep(400);
    const waitModal = await evaluate(cdp, sessionId, MODAL_STATE);
    check(
      "대기접수 모달 대기신청",
      waitModal.visible && waitModal.applyLabel === "대기신청" && waitModal.applyDisabled === false,
      waitModal,
    );
    await evaluate(cdp, sessionId, closeModal);
    await sleep(300);

    await evaluate(cdp, sessionId, clickFirstCardOfStatus("마감"));
    await sleep(400);
    const closedModal = await evaluate(cdp, sessionId, MODAL_STATE);
    check(
      "마감 모달 신청 비활성",
      closedModal.visible && closedModal.applyLabel === "모집 마감" && closedModal.applyDisabled === true,
      closedModal,
    );
    await evaluate(cdp, sessionId, closeModal);
    await sleep(300);

    await loadAt(390, 900, true);
    results.mobileProgramsSource = await waitForProgramsSource(cdp, sessionId, "supabase");
    const mobileReady = await waitForFirstPage(cdp, sessionId, totalChip?.count ?? 0);
    check("모바일 첫 페이지 도착", mobileReady, mobileReady);
    await expandAllPrograms(cdp, sessionId);
    const mobileCards = await evaluate(cdp, sessionId, CARD_STATE);
    results.mobileCards = mobileCards;
    check("모바일 카드 1열", mobileCards.gridColumns === 1, mobileCards.gridColumns);
    check("모바일 카드 가로 오버플로 없음", !mobileCards.horizontalOverflow, mobileCards.horizontalOverflow);
    results.screenshots.push(
      await (async () => {
        await evaluate(
          cdp,
          sessionId,
          `document.querySelector('#programs').scrollIntoView({ block: 'start' })`,
        );
        await sleep(400);
        const shot = await screenshot(cdp, sessionId, "mobile-390-chips-cards.png");
        await evaluate(cdp, sessionId, `window.scrollTo(0, 0)`);
        await sleep(200);
        return shot;
      })(),
    );

    await evaluate(cdp, sessionId, click("view-toggle-list"));
    await sleep(500);
    const mobileList = await evaluate(cdp, sessionId, MOBILE_STATE);
    results.mobileList = mobileList;
    check("모바일 목록형 행 카드 노출", mobileList.listVisible, mobileList.listVisible);
    check("모바일 목록형 표 숨김", mobileList.tableVisible === false, mobileList.tableVisible);
    check(
      "모바일 목록형 행 수 = 전체",
      mobileList.rowCount === (totalChip?.count ?? -1),
      { rows: mobileList.rowCount, chip: totalChip?.count },
    );
    check("모바일 목록형 가로 오버플로 없음", !mobileList.horizontalOverflow, mobileList.horizontalOverflow);
    results.screenshots.push(
      await (async () => {
        await evaluate(
          cdp,
          sessionId,
          `document.querySelector('#programs').scrollIntoView({ block: 'start' })`,
        );
        await sleep(400);
        const shot = await screenshot(cdp, sessionId, "mobile-390-list.png");
        await evaluate(cdp, sessionId, `window.scrollTo(0, 0)`);
        await sleep(200);
        return shot;
      })(),
    );

    await evaluate(
      cdp,
      sessionId,
      `document.querySelector('[data-testid="program-row-mobile"]')?.click()`,
    );
    await sleep(500);
    const mobileModal = await evaluate(cdp, sessionId, MODAL_STATE);
    results.mobileModal = mobileModal;
    check("모바일 행 클릭 → 모달 연결", mobileModal.visible === true, mobileModal);
    check("모바일 모달 가로 오버플로 없음", !mobileModal.horizontalOverflow, mobileModal.horizontalOverflow);
    results.screenshots.push(
      await screenshot(cdp, sessionId, "mobile-390-list-modal.png"),
    );
    await evaluate(cdp, sessionId, closeModal);
    await sleep(300);

    await loadAt(768, 1024, false);
    await evaluate(cdp, sessionId, click("view-toggle-list"));
    await sleep(500);
    const tabletList = await evaluate(cdp, sessionId, MOBILE_STATE);
    results.tabletList = tabletList;
    check("태블릿 목록형 행 카드 노출", tabletList.listVisible, tabletList.listVisible);
    check("태블릿 목록형 가로 오버플로 없음", !tabletList.horizontalOverflow, tabletList.horizontalOverflow);
    results.screenshots.push(
      await (async () => {
        await evaluate(
          cdp,
          sessionId,
          `document.querySelector('#programs').scrollIntoView({ block: 'start' })`,
        );
        await sleep(400);
        const shot = await screenshot(cdp, sessionId, "tablet-768-list.png");
        await evaluate(cdp, sessionId, `window.scrollTo(0, 0)`);
        await sleep(200);
        return shot;
      })(),
    );

    const consoleBeforeFallback = results.console.length;
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send(
      "Network.setBlockedURLs",
      { urls: ["*supabase.co*"] },
      sessionId,
    );
    await loadAt(1280, 900, false);
    const fallbackDeadline = Date.now() + 15000;
    let fallbackTotal = null;
    while (Date.now() < fallbackDeadline) {
      const chips = await evaluate(cdp, sessionId, CHIP_STATE);
      const total = chips.find((chip) => chip.key === "전체");
      if ((total?.count ?? -1) === Number(process.env.LOCAL_TOTAL ?? 47)) {
        fallbackTotal = total;
        break;
      }
      await sleep(250);
    }
    results.fallbackSource = await readProgramsSource(cdp, sessionId);
    const fallbackChips = await evaluate(cdp, sessionId, CHIP_STATE);
    const fallbackChipTotal = fallbackChips.find((chip) => chip.key === "전체");
    results.fallbackChips = fallbackChips;
    check(
      "수파베이스 차단 시 로컬 폴백",
      results.fallbackSource === "local",
      results.fallbackSource,
    );
    check(
      "폴백 시 로컬 강좌 수",
      (fallbackTotal?.count ?? fallbackChipTotal?.count ?? -1) ===
        Number(process.env.LOCAL_TOTAL ?? 47),
      { chip: fallbackTotal?.count ?? fallbackChipTotal?.count, expected: Number(process.env.LOCAL_TOTAL ?? 47) },
    );
    await cdp.send("Network.setBlockedURLs", { urls: [] }, sessionId);

    // Hold every Supabase request open so only the 5s AbortController timeout
    // can release the UI, then measure how long the local fallback takes.
    const timeoutStartedAt = Date.now();
    await cdp.send(
      "Fetch.enable",
      { patterns: [{ urlPattern: "*supabase.co*" }] },
      sessionId,
    );
    await loadAt(1280, 900, false);
    const timeoutDeadline = Date.now() + 12000;
    let timeoutChipTotal = null;
    while (Date.now() < timeoutDeadline) {
      const chips = await evaluate(cdp, sessionId, CHIP_STATE);
      const total = chips.find((chip) => chip.key === "전체");
      if ((total?.count ?? -1) === Number(process.env.LOCAL_TOTAL ?? 47)) {
        timeoutChipTotal = total;
        break;
      }
      await sleep(250);
    }
    const timeoutElapsedMs = Date.now() - timeoutStartedAt;
    const timeoutSource = await readProgramsSource(cdp, sessionId);
    await cdp.send("Fetch.disable", {}, sessionId);
    results.timeoutGuard = {
      elapsedMs: timeoutElapsedMs,
      source: timeoutSource,
      chipTotal: timeoutChipTotal?.count ?? null,
    };
    check(
      "수파베이스 응답 지연 시 5초 타임아웃 폴백",
      timeoutSource === "local" &&
        (timeoutChipTotal?.count ?? -1) === Number(process.env.LOCAL_TOTAL ?? 47) &&
        timeoutElapsedMs >= 4500 &&
        timeoutElapsedMs <= 11000,
      results.timeoutGuard,
    );

    check(
      "콘솔 오류 0건(실시간 구간)",
      consoleBeforeFallback === 0,
      results.console.slice(0, consoleBeforeFallback),
    );
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

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toSupabaseJobRow } from "../src/lib/jobs.ts";

// Daily incremental crawl for the four 5060do job boards. The bundled dataset
// is the known-id baseline; only postings missing from it are fetched in
// detail and upserted into Supabase. List pages are newest-first, so a page
// with no unknown id ends that board's scan.
const TICKET = "5060DO-20261108-1610";
const BASE_URL = process.env.JOBS_CRAWL_BASE_URL ?? "https://www.5060do.or.kr";
const TABLE = "jobs";
const LOCAL_PATH = path.resolve(
  process.env.JOBS_ALL_PATH ?? path.join("src", "data", "jobs_all.json"),
);
const MAX_PAGES = Number(process.env.JOBS_CRAWL_MAX_PAGES ?? 10);
const MAX_NEW = Number(process.env.JOBS_CRAWL_MAX_NEW ?? 50);
const REQUEST_TIMEOUT_MS = Number(process.env.JOBS_CRAWL_TIMEOUT_MS ?? 20_000);
const MAX_RETRIES = Number(process.env.JOBS_CRAWL_MAX_RETRIES ?? 3);
const CHUNK_SIZE = Number(process.env.JOBS_CRAWL_CHUNK_SIZE ?? 100);

const BOARDS = [
  { theme: 7, slug: "lifeWelfare", boardType: "사회공헌" },
  { theme: 8, slug: "lifeFindJob", boardType: "취업지원" },
  { theme: 9, slug: "lifeVenture", boardType: "창업" },
  { theme: 10, slug: "lifeJobHunt", boardType: "일자리" },
];

const BOARD_ORDER = ["사회공헌", "취업지원", "창업", "일자리"];

const DRY_RUN = process.argv.includes("--dry-run");
const UPDATE_LOCAL = process.argv.includes("--update-local");
const SELF_TEST = process.argv.includes("--self-test");
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const MAX_NEW_EFFECTIVE = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : MAX_NEW;

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const EVIDENCE_DIR = path.resolve("docs", "evidence", `jobs-incremental-${stamp}`);

const ENV_CANDIDATES = [
  path.resolve("env", "supabase_5060do.env"),
  path.resolve("..", "env", "supabase_5060do.env"),
  path.resolve("..", "..", "env", "supabase_5060do.env"),
  "Z:\\common\\env\\supabase_5060do.env",
  "/volume1/workspace/common/env/supabase_5060do.env",
  "/workspace/common/env/supabase_5060do.env",
];

function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

async function loadConfig() {
  const found = ENV_CANDIDATES.find((candidate) => existsSync(candidate));
  const fileValues = found ? parseEnvFile(await readFile(found, "utf8")) : {};
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileValues.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileValues.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(`Supabase URL or service role key missing. Checked env file: ${found ?? "none"}`);
  }
  return { envPath: found ?? "process.env", url: url.replace(/\/+$/, ""), serviceKey };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "5060do-jobs-crawler/1.0 (+https://www.5060do.or.kr)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      const wait = 1000 * 2 ** (attempt - 1);
      console.warn(`retry ${attempt}/${MAX_RETRIES} in ${wait}ms: ${url} (${error.message})`);
      await sleep(wait);
      return fetchText(url, attempt + 1);
    }
    throw new Error(`fetch failed after ${MAX_RETRIES} attempts: ${url} (${error.message})`);
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (raw, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    }
    return ENTITIES[body] ?? raw;
  });
}

function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseListPage(html, theme) {
  const items = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const linkPattern = new RegExp(
    `<a href="[^"]*theme=${theme}[^"]*idx=(\\d+)[^"]*" class="txt">([\\s\\S]*?)<\\/a>`,
    "i",
  );

  for (const row of html.matchAll(rowPattern)) {
    const link = row[1].match(linkPattern);
    if (!link) continue;
    const date = row[1].match(/(\d{4}-\d{2}-\d{2})/);
    items.push({
      id: Number(link[1]),
      title: stripHtml(link[2]).replace(/\s+/g, " ").trim(),
      date: date ? date[1] : "",
    });
  }
  return items;
}

function parseDetailPage(html, theme, fallback) {
  const titleMatch = html.match(/<h2 class="tit">([\s\S]*?)<\/h2>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]).replace(/\s+/g, " ").trim() : fallback.title;

  const info = {};
  for (const block of html.matchAll(/<div class="txt">([\s\S]*?)<\/div>/gi)) {
    const label = block[1].match(/<p class="into_txt">([\s\S]*?)<\/p>/i);
    if (!label) continue;
    const values = [...block[1].matchAll(/<p(?![^>]*class="into_txt")[^>]*>([\s\S]*?)<\/p>/gi)];
    info[stripHtml(label[1]).trim()] = values.length
      ? stripHtml(values[values.length - 1][1]).trim()
      : "";
  }

  let content = "";
  const descStart = html.indexOf('<div class="desc_area">');
  if (descStart >= 0) {
    const btnStart = html.indexOf('<div class="btn_area">', descStart);
    let block = html.slice(descStart, btnStart > descStart ? btnStart : undefined);
    const innerStart = block.indexOf('<div class="inner">');
    if (innerStart >= 0) block = block.slice(innerStart);
    content = stripHtml(block);
  }

  return {
    id: fallback.id,
    boardType: fallback.boardType,
    title: title || fallback.title,
    date: info["작성일"] || fallback.date,
    company: "",
    author: info["작성자"] || "",
    content,
    sourceUrl: `${BASE_URL}/board/read?theme=${theme}&idx=${fallback.id}`,
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function requestSupabase(config, pathAndQuery, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${config.url}/rest/v1/${pathAndQuery}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function upsertChunk(config, rows, attempt = 1) {
  try {
    const response = await requestSupabase(config, `${TABLE}?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (response.ok) return { ok: true, count: rows.length };
    const body = (await response.text()).slice(0, 500);
    throw new Error(`HTTP ${response.status} ${body}`);
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      const wait = 1000 * 2 ** (attempt - 1);
      console.warn(`chunk retry ${attempt}/${MAX_RETRIES} after ${wait}ms: ${error.message}`);
      await sleep(wait);
      return upsertChunk(config, rows, attempt + 1);
    }
    return { ok: false, error: error.message };
  }
}

async function fetchRemoteCount(config) {
  const response = await requestSupabase(config, `${TABLE}?select=id&limit=1`, {
    headers: { Prefer: "count=exact" },
  });
  if (!response.ok) throw new Error(`remote count failed: HTTP ${response.status}`);
  const range = response.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

async function scanBoard(theme, slug, knownIds) {
  const pages = [];
  const unknown = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${BASE_URL}/board/${slug}?type=&text=&page=${page}`;
    const html = await fetchText(url);
    const items = parseListPage(html, theme);
    if (items.length === 0) {
      pages.push({ page, items: 0, unknown: 0, stop: "empty" });
      break;
    }

    const fresh = items.filter((item) => !knownIds.has(String(item.id)));
    pages.push({ page, items: items.length, unknown: fresh.length, stop: "" });

    for (const item of fresh) {
      unknown.push({
        ...item,
        theme,
        boardType: BOARDS.find((board) => board.theme === theme)?.boardType ?? "",
      });
    }

    if (fresh.length === 0) {
      pages[pages.length - 1].stop = "all-known";
      break;
    }
    if (page === MAX_PAGES) {
      pages[pages.length - 1].stop = "max-pages";
    }
    await sleep(200);
  }

  return { pages, unknown };
}

// jobs_recent.json is a 300-row bundle built from jobs_all.json. Rebuilding it
// in the same run keeps the offline fallback from going stale after a crawl.
function rebuildJobsFallback() {
  const script = path.resolve("scripts", "build-jobs-fallback.mjs");
  console.log(`local fallback rebuild: ${script}`);
  const env = { ...process.env, JOBS_ALL_PATH: LOCAL_PATH };
  if (process.env.JOBS_RECENT_PATH) {
    env.JOBS_RECENT_PATH = process.env.JOBS_RECENT_PATH;
  }
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script],
    { stdio: "inherit", env },
  );
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return { ok: false, error: `exit ${result.status ?? "null"}` };
  }
  return { ok: true };
}

function sortRows(rows) {
  return [...rows].sort((left, right) => {
    const leftOrder = BOARD_ORDER.indexOf(left.boardType);
    const rightOrder = BOARD_ORDER.indexOf(right.boardType);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return Number(right.id) - Number(left.id);
  });
}

async function main() {
  const startedAt = new Date();
  const config = await loadConfig();
  const localRows = JSON.parse(await readFile(LOCAL_PATH, "utf8"));
  if (!Array.isArray(localRows)) throw new Error("src/data/jobs_all.json must be an array");

  const knownIds = new Set(localRows.map((row) => String(row.id)));
  console.log(`baseline rows=${localRows.length} env=${config.envPath}`);

  if (SELF_TEST) {
    const sample =
      localRows.find((row) => Number(row.id) === 2728) ??
      localRows.find((row) => Boolean(row.content)) ??
      localRows[0];
    const board = BOARDS.find((entry) => entry.boardType === sample.boardType) ?? BOARDS[3];
    const html = await fetchText(`${BASE_URL}/board/read?theme=${board.theme}&idx=${sample.id}`);
    const job = parseDetailPage(html, board.theme, {
      id: Number(sample.id),
      boardType: sample.boardType,
      title: sample.title,
      date: sample.date,
    });
    const row = toSupabaseJobRow(job);
    const checks = {
      titleMatch: job.title.replace(/\s+/g, " ") === String(sample.title).replace(/\s+/g, " "),
      dateMatch: job.date === sample.date,
      contentPresent: job.content.length > 0,
      regionValid: row.region === "부산" || row.region === "기타",
      sourceUrlMatch: row.source_url === sample.sourceUrl,
    };
    const pass = Object.values(checks).every(Boolean);
    console.log(
      `self-test idx=${sample.id} theme=${board.theme} title="${job.title}" date=${job.date} ` +
        `content=${job.content.length}chars region=${row.region}`,
    );
    console.log(`self-test checks=${JSON.stringify(checks)} pass=${pass}`);
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(
      path.join(EVIDENCE_DIR, "jobs-incremental-selftest.json"),
      `${JSON.stringify({ ticket: TICKET, sampleId: sample.id, checks, pass, job }, null, 2)}\n`,
      "utf8",
    );
    console.log(`evidence=${EVIDENCE_DIR}`);
    if (!pass) process.exitCode = 1;
    return;
  }

  console.log(`mode=${DRY_RUN ? "dry-run" : "upsert"} maxNew=${MAX_NEW_EFFECTIVE}`);

  const scans = [];
  const discovered = [];
  for (const board of BOARDS) {
    const result = await scanBoard(board.theme, board.slug, knownIds);
    scans.push({ ...board, ...result });
    discovered.push(...result.unknown);
    for (const page of result.pages) {
      console.log(
        `${board.slug}(theme=${board.theme}) page=${page.page} items=${page.items} new=${page.unknown}${
          page.stop ? ` [${page.stop}]` : ""
        }`,
      );
    }
  }

  const uniqueNew = [...new Map(discovered.map((item) => [item.id, item])).values()].slice(
    0,
    MAX_NEW_EFFECTIVE,
  );
  const tooMany = discovered.length > MAX_NEW_EFFECTIVE;
  console.log(`discovered=${discovered.length} selected=${uniqueNew.length}${tooMany ? " (limit hit)" : ""}`);

  const failures = [];
  const newRows = [];

  for (const [index, item] of uniqueNew.entries()) {
    try {
      const html = await fetchText(
        `${BASE_URL}/board/read?theme=${item.theme}&idx=${item.id}`,
      );
      const job = parseDetailPage(html, item.theme, item);
      if (!job.title) throw new Error("title missing");
      newRows.push(toSupabaseJobRow(job));
      console.log(
        `[${index + 1}/${uniqueNew.length}] theme=${item.theme} idx=${item.id} "${job.title}" ${job.date}`,
      );
    } catch (error) {
      failures.push({ id: item.id, theme: item.theme, error: error.message });
      console.error(`[fail] theme=${item.theme} idx=${item.id}: ${error.message}`);
    }
    await sleep(250);
  }

  let upserted = 0;
  if (!DRY_RUN && newRows.length > 0) {
    for (const [index, batch] of chunk(newRows, CHUNK_SIZE).entries()) {
      const result = await upsertChunk(config, batch);
      if (result.ok) {
        upserted += result.count;
        console.log(`chunk ${index + 1}: upserted ${result.count}`);
      } else {
        failures.push({ chunk: index + 1, error: result.error });
      }
    }
  }

  let updatedLocal = false;
  let fallbackUpdated = false;
  if (UPDATE_LOCAL && newRows.length > 0) {
    const merged = new Map(localRows.map((row) => [String(row.id), row]));
    for (const row of newRows) {
      merged.set(String(row.id), {
        id: Number(row.id),
        boardType: row.board_type ?? "",
        title: row.title ?? "",
        date: row.date ?? "",
        company: row.company ?? "",
        author: row.author ?? "",
        content: row.content ?? "",
        sourceUrl: row.source_url ?? "",
      });
    }
    const nextRows = sortRows([...merged.values()]);
    await writeFile(LOCAL_PATH, `${JSON.stringify(nextRows, null, 2)}\n`, "utf8");
    updatedLocal = true;
    console.log(`local dataset updated: ${localRows.length} -> ${nextRows.length}`);

    const fallback = rebuildJobsFallback();
    if (fallback.ok) {
      fallbackUpdated = true;
    } else {
      failures.push({ step: "build-jobs-fallback", error: fallback.error });
    }
  }

  const region = newRows.reduce(
    (acc, row) => {
      acc[row.region] = (acc[row.region] ?? 0) + 1;
      return acc;
    },
    { 부산: 0, 기타: 0 },
  );

  let remoteTotal = null;
  try {
    remoteTotal = await fetchRemoteCount(config);
  } catch (error) {
    console.warn(`remote count unavailable: ${error.message}`);
  }

  const report = {
    ticket: TICKET,
    envPath: config.envPath,
    dryRun: DRY_RUN,
    updateLocal: UPDATE_LOCAL,
    maxPages: MAX_PAGES,
    maxNew: MAX_NEW_EFFECTIVE,
    baselineRows: localRows.length,
    scans: scans.map((scan) => ({
      theme: scan.theme,
      slug: scan.slug,
      boardType: scan.boardType,
      pages: scan.pages,
      discovered: scan.unknown.length,
    })),
    discovered: discovered.length,
    selected: uniqueNew.length,
    newRows: newRows.map((row) => ({
      id: row.id,
      boardType: row.board_type,
      title: row.title,
      date: row.date,
      region: row.region,
      sourceUrl: row.source_url,
    })),
    region,
    upserted,
    updatedLocal,
    fallbackUpdated,
    remoteTotal,
    failures,
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "jobs-incremental-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `new=${newRows.length} busan=${region.부산} other=${region.기타} upserted=${upserted} ` +
      `local=${updatedLocal} fallback=${fallbackUpdated} failures=${failures.length}`,
  );
  console.log(`remote total=${remoteTotal ?? "n/a"} evidence=${EVIDENCE_DIR}`);

  if (failures.length > 0) process.exitCode = 1;
}

await main();

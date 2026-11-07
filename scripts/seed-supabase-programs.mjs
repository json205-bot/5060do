import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TABLE = "programs";
const SOURCE_PATH = path.resolve("src", "data", "programs_all.json");
const CHUNK_SIZE = Number(process.env.SEED_CHUNK_SIZE ?? 100);
const MAX_RETRIES = Number(process.env.SEED_MAX_RETRIES ?? 3);
const REQUEST_TIMEOUT_MS = Number(process.env.SEED_TIMEOUT_MS ?? 30_000);
const REFERENCE_DATE = process.env.PROGRAM_REFERENCE_DATE ?? "2026-11-07";
const CENTER_LOCATION = "오륙도인생후반전지원센터";
const SAMPLE_SIZE = 5;

const EVIDENCE_DIR = path.resolve(
  "docs",
  "evidence",
  `supabase-seed-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`,
);

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
  const fileValues = found
    ? parseEnvFile(await readFile(found, "utf8"))
    : {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileValues.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? fileValues.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileValues.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      `Supabase URL or service role key missing. Checked env file: ${found ?? "none"}`,
    );
  }

  return { envPath: found ?? "process.env", url: url.replace(/\/+$/, ""), anonKey, serviceKey };
}

const applyStart = (period) => (period.split("~")[0] ?? "").trim();
const applyEnd = (period) => (period.split("~")[1] ?? applyStart(period ?? "")).trim();

function normalizeStatus(program) {
  if (program.status === "대기신청") return "대기접수";
  if (program.status === "신청마감" || program.status === "종료") return "마감";
  if (program.status === "수강신청") {
    if (applyStart(program.applyPeriod ?? "") > REFERENCE_DATE) return "접수예정";
    if (applyEnd(program.applyPeriod ?? "") < REFERENCE_DATE) return "마감";
    return "접수중";
  }
  return "마감";
}

function formatCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value}명`;
}

function formatFee(fee) {
  const value = Number(fee);
  if (!Number.isFinite(value) || value <= 0) return "무료";
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatEnrolled(enrolled) {
  const value = Number(enrolled);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function toRow(program) {
  return {
    id: String(program.id),
    title: program.title ?? "",
    category: program.category ?? "",
    target: program.target ?? "",
    capacity: formatCapacity(program.capacity),
    enrolled: formatEnrolled(program.enrolled),
    fee: formatFee(program.fee),
    edu_period: program.eduPeriod ?? "",
    apply_period: program.applyPeriod ?? "",
    location: program.location || CENTER_LOCATION,
    status: normalizeStatus(program),
    summary: program.summary ?? "",
    content: program.content ?? "",
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(config, pathAndQuery, init = {}) {
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
    const response = await request(config, `${TABLE}?on_conflict=id`, {
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
      console.warn(
        `chunk retry ${attempt}/${MAX_RETRIES} after ${wait}ms: ${error.message}`,
      );
      await sleep(wait);
      return upsertChunk(config, rows, attempt + 1);
    }
    return { ok: false, error: error.message };
  }
}

async function upsertRows(config, rows) {
  const failed = [];
  let inserted = 0;

  for (const [index, batch] of chunk(rows, CHUNK_SIZE).entries()) {
    const result = await upsertChunk(config, batch);
    if (result.ok) {
      inserted += result.count;
      console.log(`chunk ${index + 1}: upserted ${result.count}`);
      continue;
    }

    console.warn(`chunk ${index + 1} failed, isolating records: ${result.error}`);
    for (const row of batch) {
      const single = await upsertChunk(config, [row], 1);
      if (single.ok) {
        inserted += 1;
      } else {
        failed.push({ id: row.id, title: row.title, error: single.error });
      }
    }
  }

  return { inserted, failed };
}

async function assertEnrolledColumn(config) {
  const response = await request(config, `${TABLE}?select=id,enrolled&limit=1`);
  if (response.ok) return;

  const body = (await response.text()).slice(0, 400);
  if (body.includes("42703") || body.includes("enrolled")) {
    throw new Error(
      `${TABLE}.enrolled column is missing (HTTP ${response.status}). ` +
        "Run this once in the Supabase SQL editor, then re-run the seed:\n" +
        "ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS enrolled INTEGER DEFAULT 0;",
    );
  }
  throw new Error(`preflight select failed: HTTP ${response.status} ${body}`);
}

async function fetchCount(config) {
  const response = await request(config, `${TABLE}?select=id&limit=1`, {
    headers: { Prefer: "count=exact" },
  });
  if (!response.ok) throw new Error(`count query failed: HTTP ${response.status}`);
  const range = response.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : NaN;
}

function pickSamples(rows, size) {
  const pool = [...rows];
  const picked = [];
  for (let index = 0; index < size && pool.length > 0; index += 1) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

async function verifySamples(config, samples) {
  const ids = samples.map((row) => row.id);
  const response = await request(
    config,
    `${TABLE}?select=*&id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`,
  );
  if (!response.ok) throw new Error(`sample query failed: HTTP ${response.status}`);
  const remoteRows = await response.json();
  const remoteById = new Map(remoteRows.map((row) => [String(row.id), row]));

  return samples.map((expected) => {
    const actual = remoteById.get(expected.id);
    const mismatches = ["title", "edu_period", "status", "category", "fee", "capacity", "enrolled"]
      .filter((field) => (actual?.[field] ?? null) !== expected[field])
      .map((field) => ({
        field,
        expected: expected[field],
        actual: actual?.[field] ?? null,
      }));
    return {
      id: expected.id,
      title: expected.title,
      edu_period: expected.edu_period,
      status: expected.status,
      capacity: expected.capacity,
      enrolled: expected.enrolled,
      found: Boolean(actual),
      pass: Boolean(actual) && mismatches.length === 0,
      mismatches,
    };
  });
}

async function main() {
  const startedAt = new Date();
  const config = await loadConfig();
  console.log(`env: ${config.envPath}`);
  console.log(`target: ${config.url}/rest/v1/${TABLE}`);

  const source = JSON.parse(await readFile(SOURCE_PATH, "utf8"));
  const rows = source.map(toRow);
  console.log(`source rows: ${rows.length} (chunk=${CHUNK_SIZE})`);

  await assertEnrolledColumn(config);

  const { inserted, failed } = await upsertRows(config, rows);
  const total = await fetchCount(config);
  const samples = pickSamples(rows, SAMPLE_SIZE);
  const sampleResults = await verifySamples(config, samples);

  const elapsedMs = Date.now() - startedAt.getTime();
  const report = {
    ticket: "5060DO-20261107-1305",
    envPath: config.envPath,
    target: `${config.url}/rest/v1/${TABLE}`,
    sourceRows: rows.length,
    chunkSize: CHUNK_SIZE,
    upserted: inserted,
    failed: failed.length,
    failedRecords: failed,
    remoteCount: total,
    countPass: total === rows.length,
    samples: sampleResults,
    samplePass: sampleResults.every((item) => item.pass),
    startedAt: startedAt.toISOString(),
    elapsedMs,
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "seed-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (failed.length > 0) {
    await writeFile(
      path.join(EVIDENCE_DIR, "failed-records.json"),
      `${JSON.stringify(failed, null, 2)}\n`,
      "utf8",
    );
  }

  console.log(`upserted=${inserted} failed=${failed.length}`);
  console.log(`remoteCount=${total} expected=${rows.length} countPass=${report.countPass}`);
  for (const sample of sampleResults) {
    console.log(
      `sample ${sample.id} pass=${sample.pass} title="${sample.title}" status=${sample.status} enrolled=${sample.enrolled}/${sample.capacity}`,
    );
    for (const mismatch of sample.mismatches) {
      console.log(
        `  mismatch ${mismatch.field}: expected=${JSON.stringify(mismatch.expected)} actual=${JSON.stringify(mismatch.actual)}`,
      );
    }
  }
  console.log(`elapsedMs=${elapsedMs}`);
  console.log(`evidence=${EVIDENCE_DIR}`);

  if (!report.countPass || !report.samplePass || failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();

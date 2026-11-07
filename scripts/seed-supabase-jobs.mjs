import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toSupabaseJobRow } from "../src/lib/jobs.ts";

const TABLE = "jobs";
const SOURCE_PATH = path.resolve("src", "data", "jobs_all.json");
const DDL_PATH = path.join("docs", "sql", "setup_jobs.sql");
const CHUNK_SIZE = Number(process.env.JOBS_SEED_CHUNK_SIZE ?? 100);
const MAX_RETRIES = Number(process.env.JOBS_SEED_MAX_RETRIES ?? 3);
const REQUEST_TIMEOUT_MS = Number(process.env.JOBS_SEED_TIMEOUT_MS ?? 30_000);
const SAMPLE_SIZE = 5;

const EVIDENCE_DIR = path.resolve(
  "docs",
  "evidence",
  `jobs-seed-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`,
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
  const fileValues = found ? parseEnvFile(await readFile(found, "utf8")) : {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileValues.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileValues.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      `Supabase URL or service role key missing. Checked env file: ${found ?? "none"}`,
    );
  }

  return { envPath: found ?? "process.env", url: url.replace(/\/+$/, ""), serviceKey };
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

async function assertJobsTable(config) {
  const response = await request(
    config,
    `${TABLE}?select=id,board_type,region,source_url&limit=1`,
  );
  if (response.ok) return;

  const body = (await response.text()).slice(0, 400);
  if (response.status === 404 || body.includes("PGRST205")) {
    throw new Error(
      `${TABLE} table is missing (HTTP ${response.status}). ` +
        `Apply ${DDL_PATH} once through the NAS psql route, then re-run this seed.\n` +
        'docker exec -i -e PGPASSWORD="$SUPABASE_DB_PASSWORD" postgres-common ' +
        'psql "host=aws-0-ap-northeast-2.pooler.supabase.com port=5432 ' +
        'user=postgres.aljizecqcdlqmjnkelah dbname=postgres sslmode=require" ' +
        `< ${DDL_PATH}`,
    );
  }
  throw new Error(`preflight select failed: HTTP ${response.status} ${body}`);
}

async function fetchCount(config, filter) {
  const query = filter
    ? `${TABLE}?select=id&${filter.column}=eq.${encodeURIComponent(filter.value)}&limit=1`
    : `${TABLE}?select=id&limit=1`;
  const response = await request(config, query, {
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
    const actual = remoteById.get(String(expected.id));
    const mismatches = ["title", "board_type", "date", "region", "source_url"]
      .filter((field) => (actual?.[field] ?? null) !== expected[field])
      .map((field) => ({
        field,
        expected: expected[field],
        actual: actual?.[field] ?? null,
      }));
    return {
      id: expected.id,
      title: expected.title,
      region: expected.region,
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

  await assertJobsTable(config);

  const source = JSON.parse(await readFile(SOURCE_PATH, "utf8"));
  if (!Array.isArray(source)) {
    throw new Error("src/data/jobs_all.json must be an array");
  }
  const rows = source.map(toSupabaseJobRow);
  const expectedTotal = rows.length;
  const expectedBusan = rows.filter((row) => row.region === "부산").length;
  const expectedOther = rows.filter((row) => row.region === "기타").length;
  console.log(
    `source rows: ${rows.length} (busan=${expectedBusan} other=${expectedOther}, chunk=${CHUNK_SIZE})`,
  );

  const { inserted, failed } = await upsertRows(config, rows);
  const remoteTotal = await fetchCount(config, null);
  const remoteBusan = await fetchCount(config, { column: "region", value: "부산" });
  const remoteOther = await fetchCount(config, { column: "region", value: "기타" });
  const samples = pickSamples(rows, SAMPLE_SIZE);
  const sampleResults = await verifySamples(config, samples);

  const totalPass = remoteTotal === expectedTotal;
  const regionPass =
    remoteBusan === expectedBusan && remoteOther === expectedOther;
  const samplePass = sampleResults.every((item) => item.pass);
  const elapsedMs = Date.now() - startedAt.getTime();
  const report = {
    ticket: "5060DO-20261108-0505",
    envPath: config.envPath,
    target: `${config.url}/rest/v1/${TABLE}`,
    sourceRows: rows.length,
    chunkSize: CHUNK_SIZE,
    upserted: inserted,
    failed: failed.length,
    failedRecords: failed,
    expected: { total: expectedTotal, busan: expectedBusan, other: expectedOther },
    remote: { total: remoteTotal, busan: remoteBusan, other: remoteOther },
    totalPass,
    regionPass,
    samplePass,
    samples: sampleResults,
    startedAt: startedAt.toISOString(),
    elapsedMs,
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "jobs-seed-report.json"),
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
  console.log(
    `remote total=${remoteTotal} (expected ${expectedTotal}) busan=${remoteBusan} other=${remoteOther}`,
  );
  console.log(
    `totalPass=${totalPass} regionPass=${regionPass} samplePass=${samplePass}`,
  );
  for (const sample of sampleResults) {
    console.log(
      `sample ${sample.id} pass=${sample.pass} region=${sample.region} title="${sample.title}"`,
    );
    for (const mismatch of sample.mismatches) {
      console.log(
        `  mismatch ${mismatch.field}: expected=${JSON.stringify(mismatch.expected)} actual=${JSON.stringify(mismatch.actual)}`,
      );
    }
  }
  console.log(`elapsedMs=${elapsedMs}`);
  console.log(`evidence=${EVIDENCE_DIR}`);

  if (!totalPass || !regionPass || !samplePass || failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TABLE = "documents";
const SOURCE_PATH = path.resolve("src", "data", "center_knowledge.json");
const REQUEST_TIMEOUT_MS = Number(process.env.SEED_TIMEOUT_MS ?? 30_000);

const EVIDENCE_DIR = path.resolve(
  "docs",
  "evidence",
  `knowledge-seed-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`,
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

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileValues.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileValues.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      `Supabase URL or service role key missing. Checked env file: ${found ?? "none"}`,
    );
  }

  return { envPath: found ?? "process.env", url: url.replace(/\/+$/, ""), serviceKey };
}

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

// The crawler emits one chunk per page section. Blank chunks mean the section
// was an image or map with no readable text, so they are dropped instead of
// creating empty knowledge rows.
function flattenKnowledge(entries) {
  const documents = [];
  for (const entry of entries) {
    const content = (entry.chunks ?? [])
      .filter((chunk) => typeof chunk === "string" && chunk.trim().length > 0)
      .map((chunk) => chunk.trim())
      .join("\n\n");

    if (!content) continue;

    documents.push({
      id: documents.length + 1,
      title: entry.title ?? entry.id,
      category: entry.category ?? "",
      content,
      sourceId: entry.id,
      sourceUrl: entry.sourceUrl ?? "",
    });
  }
  return documents;
}

async function upsertDocuments(config, rows) {
  const response = await request(config, `${TABLE}?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(
      rows.map(({ id, title, category, content }) => ({
        id,
        title,
        category,
        content,
      })),
    ),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 800);
    throw new Error(`upsert failed: HTTP ${response.status} ${body}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data.length : 0;
}

async function fetchCount(config) {
  const response = await request(config, `${TABLE}?select=id&limit=1`, {
    headers: { Prefer: "count=exact" },
  });
  if (!response.ok) {
    throw new Error(`count query failed: HTTP ${response.status}`);
  }
  const range = response.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : NaN;
}

async function fetchTitles(config, ids) {
  const response = await request(
    config,
    `${TABLE}?select=id,title,category,content&id=in.(${ids.join(",")})&order=id.asc`,
  );
  if (!response.ok) {
    throw new Error(`verification query failed: HTTP ${response.status}`);
  }
  return response.json();
}

// Keyword checks mirror the chatbot answer groups: center history, organization,
// life plan, work activity, shared office, convention, floor guide, and location.
const KEYWORD_CHECKS = [
  { name: "연혁", keywords: ["연혁", "2023년"], mode: "content" },
  { name: "조직도", keywords: ["조직도", "센터장"], mode: "content" },
  { name: "생애설계", keywords: ["생애설계", "7대 영역"], mode: "content" },
  { name: "일활동", keywords: ["일활동"], mode: "content" },
  { name: "공유사무실", keywords: ["공유사무실", "공유오피스"], mode: "content" },
  { name: "대관", keywords: ["대관"], mode: "content" },
  { name: "층별안내", keywords: ["층별안내"], mode: "content" },
  { name: "오시는길", keywords: ["오시는길", "주소"], mode: "content" },
];

function verifyKeywords(remoteRows) {
  const titleBlob = remoteRows.map((row) => row.title ?? "").join("\n");
  const contentBlob = remoteRows.map((row) => row.content ?? "").join("\n");

  return KEYWORD_CHECKS.map((check) => {
    const blob = check.mode === "title" ? titleBlob : contentBlob;
    const missing = check.keywords.filter((keyword) => !blob.includes(keyword));
    return {
      name: check.name,
      mode: check.mode,
      keywords: check.keywords,
      missing,
      pass: missing.length === 0,
    };
  });
}

async function main() {
  const startedAt = new Date();
  const config = await loadConfig();
  console.log(`env: ${config.envPath}`);
  console.log(`target: ${config.url}/rest/v1/${TABLE}`);

  const source = JSON.parse(await readFile(SOURCE_PATH, "utf8"));
  const documents = flattenKnowledge(source);
  const emptyEntries = source.length - documents.length;
  console.log(
    `source entries: ${source.length}, documents: ${documents.length}, skipped(no text): ${emptyEntries}`,
  );

  const upserted = await upsertDocuments(config, documents);
  const total = await fetchCount(config);
  const remoteRows = await fetchTitles(
    config,
    documents.map((document) => document.id),
  );
  const keywordResults = verifyKeywords(remoteRows);
  const remoteById = new Map(remoteRows.map((row) => [row.id, row]));
  const contentMatches = documents.every((expected) => {
    const actual = remoteById.get(expected.id);
    return (
      actual?.title === expected.title &&
      (actual?.category ?? "") === expected.category &&
      (actual?.content ?? "").length === expected.content.length
    );
  });

  const report = {
    ticket: "5060DO-20261107-2235",
    table: TABLE,
    envPath: config.envPath,
    target: `${config.url}/rest/v1/${TABLE}`,
    sourceEntries: source.length,
    documentCount: documents.length,
    skippedEntries: emptyEntries,
    upserted,
    remoteCount: total,
    countPass: total === documents.length,
    contentPass: contentMatches,
    keywordChecks: keywordResults,
    keywordPass: keywordResults.every((item) => item.pass),
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      category: document.category,
      sourceId: document.sourceId,
      sourceUrl: document.sourceUrl,
      contentChars: document.content.length,
    })),
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "seed-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log(`upserted=${upserted}`);
  console.log(
    `remoteCount=${total} expected=${documents.length} countPass=${report.countPass}`,
  );
  console.log(`contentPass=${report.contentPass} keywordPass=${report.keywordPass}`);
  for (const document of report.documents) {
    console.log(
      `  [${document.id}] ${document.category} / ${document.title} (${document.contentChars} chars)`,
    );
  }
  for (const check of keywordResults) {
    console.log(
      `  keyword ${check.name}: pass=${check.pass}${
        check.missing.length > 0 ? ` missing=${check.missing.join(",")}` : ""
      }`,
    );
  }
  console.log(`evidence=${EVIDENCE_DIR}`);

  if (!report.countPass || !report.contentPass || !report.keywordPass) {
    process.exitCode = 1;
  }
}

await main();

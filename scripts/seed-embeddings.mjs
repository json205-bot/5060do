import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  buildEmbeddingSpace,
  cosineSimilarity,
  documentSpaceText,
  embedDocument,
  embedText,
  parseVector,
  toVectorLiteral,
} from "../src/lib/embedding.ts";

const TABLE = "documents";
const REQUEST_TIMEOUT_MS = Number(process.env.EMBEDDINGS_TIMEOUT_MS ?? 30_000);
const DRY_RUN = process.argv.includes("--dry-run") || process.env.EMBEDDINGS_DRY_RUN === "1";
// Mirrors DEFAULT_MIN_SCORE in src/lib/rag.ts.
const MIN_SCORE = 0.1;

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const EVIDENCE_DIR = path.resolve("docs", "evidence", `rag-embeddings-${stamp}`);

const ENV_CANDIDATES = [
  path.resolve("env", "supabase_5060do.env"),
  path.resolve("..", "env", "supabase_5060do.env"),
  path.resolve("..", "..", "env", "supabase_5060do.env"),
  "Z:\\common\\env\\supabase_5060do.env",
  "/volume1/workspace/common/env/supabase_5060do.env",
  "/workspace/common/env/supabase_5060do.env",
];

// Natural-language questions that share almost no wording with the document
// they should retrieve. They prove the vector index works without an exact
// keyword hit. An empty `expect` means the query must stay below MIN_SCORE.
const QUALITY_CHECKS = [
  { query: "차를 어디에 세워요?", expect: ["오시는 길"] },
  { query: "동아리 모임은 어떻게 하나요?", expect: ["커뮤니티지원"] },
  { query: "5층에 사무실 쓰고 싶어요", expect: ["공유사무실 참여방법"] },
  { query: "센터는 언제 문을 열었나요?", expect: ["연혁"] },
  { query: "강당 빌리는 비용 알려줘", expect: ["대관신청"] },
  { query: "대관료 얼마예요?", expect: ["대관신청"] },
  { query: "어떤 부서가 있나요?", expect: ["조직도"] },
  { query: "요리실이나 강의실은 몇 층이에요?", expect: ["시설안내"] },
  { query: "전화번호와 주소가 궁금해요", expect: ["오시는 길"] },
  { query: "인생 이모작 상담 받고 싶어요", expect: ["생애설계진단/상담"] },
  { query: "커뮤니티 활동 알려줘", expect: ["커뮤니티 참여방법", "커뮤니티지원"] },
  { query: "비전이 뭐예요?", expect: ["비전/미션"] },
  { query: "일자리 프로그램 있나요?", expect: ["일·활동"] },
  { query: "헬스장 있나요?", expect: [] },
  { query: "오늘 날씨 어때요?", expect: [] },
  { query: "맛집 추천해줘", expect: [] },
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

async function fetchDocuments(config) {
  const response = await request(
    config,
    `${TABLE}?select=id,title,category,content&order=id.asc`,
  );
  if (!response.ok) {
    throw new Error(`document read failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function writeEmbedding(config, id, vector) {
  const response = await request(config, `${TABLE}?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ embedding: toVectorLiteral(vector) }),
  });
  if (!response.ok) {
    throw new Error(
      `embedding update failed for id=${id}: HTTP ${response.status} ${await response.text()}`,
    );
  }
}

async function fetchEmbeddings(config) {
  const response = await request(config, `${TABLE}?select=id,title,category,content,embedding&order=id.asc`);
  if (!response.ok) {
    throw new Error(`embedding read failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function toSearchIndex(rows) {
  return rows
    .map((row) => {
      const embedding = parseVector(row.embedding);
      if (!embedding || embedding.length !== EMBEDDING_DIM) return null;
      return {
        id: String(row.id),
        title: row.title ?? String(row.id),
        category: row.category ?? "",
        content: (row.content ?? "").trim(),
        sourceUrl: "",
        embedding,
      };
    })
    .filter(Boolean);
}

function rankQuery(index, space, query, topK = 3) {
  const queryVector = embedText(query, space);
  return index
    .map((document) => ({
      id: document.id,
      title: document.title,
      score: Number(cosineSimilarity(queryVector, document.embedding).toFixed(4)),
    }))
    .filter((item) => item.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

async function main() {
  const startedAt = new Date();
  const config = await loadConfig();
  console.log(`env: ${config.envPath}`);
  console.log(`target: ${config.url}/rest/v1/${TABLE}`);
  console.log(`model: ${EMBEDDING_MODEL} (${EMBEDDING_DIM} dims)`);

  const documents = await fetchDocuments(config);
  console.log(`documents: ${documents.length}`);
  if (documents.length !== 14) {
    console.warn(`[warn] expected 14 center knowledge rows, found ${documents.length}`);
  }

  // The vocabulary is derived from the exact rows being embedded, so the seed
  // script and the browser (which derives it from center_knowledge.json) produce
  // the same vector space.
  const space = buildEmbeddingSpace(
    documents.map((row) =>
      documentSpaceText({
        title: row.title ?? String(row.id),
        category: row.category ?? "",
        content: row.content ?? "",
      }),
    ),
  );
  console.log(`vocabulary: ${space.index.size}/${EMBEDDING_DIM}`);

  const planned = documents.map((row) => ({
    id: row.id,
    title: row.title,
    vector: embedDocument(
      {
        title: row.title ?? String(row.id),
        category: row.category ?? "",
        content: row.content ?? "",
      },
      space,
    ),
  }));

  const failures = [];
  if (!DRY_RUN) {
    for (const row of planned) {
      try {
        await writeEmbedding(config, row.id, row.vector);
        console.log(`  updated id=${row.id} ${row.title}`);
      } catch (error) {
        failures.push({ id: row.id, title: row.title, error: String(error.message ?? error) });
        console.error(`  [fail] id=${row.id} ${row.title}: ${error.message ?? error}`);
      }
    }
  } else {
    console.log("dry run: skipping embedding updates");
  }

  const remoteRows = await fetchEmbeddings(config);
  const missing = remoteRows.filter((row) => !parseVector(row.embedding)).length;
  const wrongDim = remoteRows.filter((row) => {
    const vector = parseVector(row.embedding);
    return !vector || vector.length !== EMBEDDING_DIM;
  }).length;

  const consistency = remoteRows.map((row) => {
    const stored = parseVector(row.embedding);
    const expected = embedDocument(
      {
        title: row.title ?? String(row.id),
        category: row.category ?? "",
        content: row.content ?? "",
      },
      space,
    );
    const storedScore = stored ? cosineSimilarity(stored, expected) : 0;
    return {
      id: row.id,
      title: row.title,
      dims: stored?.length ?? 0,
      cosine: Number(storedScore.toFixed(6)),
      pass: Boolean(stored) && stored.length === EMBEDDING_DIM && storedScore > 0.9999,
    };
  });

  const index = toSearchIndex(remoteRows);
  const quality = QUALITY_CHECKS.map((check) => {
    const ranking = rankQuery(index, space, check.query, 3);
    let pass;
    if (check.expect.length === 0) {
      pass = ranking.length === 0;
    } else {
      pass = ranking.some(
        (item, position) => check.expect.includes(item.title) && position < 3,
      );
    }
    return {
      query: check.query,
      expect: check.expect,
      ranking,
      pass,
    };
  });

  const report = {
    ticket: "5060DO-20261108-0145",
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
    table: TABLE,
    envPath: config.envPath,
    dryRun: DRY_RUN,
    documentCount: documents.length,
    embeddedCount: remoteRows.length - wrongDim,
    missing,
    wrongDim,
    updateFailures: failures,
    consistencyPass: consistency.every((item) => item.pass),
    consistency,
    qualityPass: quality.every((item) => item.pass),
    quality,
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "embedding-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log(`embedded=${report.embeddedCount}/${documents.length} wrongDim=${wrongDim}`);
  console.log(`consistencyPass=${report.consistencyPass} qualityPass=${report.qualityPass}`);
  for (const check of quality) {
    const top = check.ranking.map((item) => `${item.title}(${item.score})`).join(" > ");
    console.log(`  ${check.pass ? "PASS" : "FAIL"} ${check.query} → ${top}`);
  }
  console.log(`evidence=${EVIDENCE_DIR}`);

  if (failures.length > 0 || wrongDim > 0 || !report.consistencyPass || !report.qualityPass) {
    process.exitCode = 1;
  }
}

await main();

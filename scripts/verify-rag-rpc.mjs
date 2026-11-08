import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRagEngine } from "../src/lib/rag-core.ts";

// Verifies both halves of the RAG contract:
//   1. public.match_documents answers a real vector query when it is installed.
//   2. any RPC failure (missing function, HTTP error, exception, empty result,
//      timeout) returns the bundled vector matches instead of throwing.
const TICKET = "5060DO-20261108-1340";
const TABLE_RPC = "match_documents";
const KNOWLEDGE_PATH = path.resolve("src", "data", "center_knowledge.json");
const REQUEST_TIMEOUT_MS = Number(process.env.RAG_RPC_HTTP_TIMEOUT_MS ?? 20_000);
const TEST_TIMEOUT_MS = Number(process.env.RAG_RPC_TEST_TIMEOUT_MS ?? 2_500);

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const EVIDENCE_DIR = path.resolve("docs", "evidence", `rag-rpc-${stamp}`);

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
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    fileValues.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    fileValues.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error(`Supabase URL/key missing. Checked env file: ${found ?? "none"}`);
  }
  return { envPath: found ?? "process.env", url: url.replace(/\/+$/, ""), anonKey };
}

function signature(matches) {
  return JSON.stringify(
    matches.map((match) => ({
      id: match.id,
      title: match.title,
      score: Number(match.score.toFixed(4)),
    })),
  );
}

async function main() {
  const startedAt = new Date();
  const config = await loadConfig();
  const entries = JSON.parse(await readFile(KNOWLEDGE_PATH, "utf8"));
  const engine = createRagEngine(entries);
  const endpoint = `${config.url}/rest/v1/rpc/${TABLE_RPC}`;
  const checks = [];

  const record = (name, pass, detail = {}) => {
    checks.push({ name, pass, ...detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail.note ? ` — ${detail.note}` : ""}`);
  };

  const realRpc = async (args) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      const text = await response.text();
      if (!response.ok) {
        return {
          status: response.status,
          data: null,
          error: { message: `HTTP ${response.status} ${text.slice(0, 300)}` },
        };
      }
      return { status: response.status, data: JSON.parse(text), error: null };
    } finally {
      clearTimeout(timer);
    }
  };

  const question = "센터는 언제 문을 열었나요?";
  const expectedTitle = "연혁";

  const bundleMatches = engine.search(question, { topK: 3 });
  const rpcOutcome = await engine.searchWithRpc(
    question,
    { topK: 3 },
    realRpc,
    { timeoutMs: REQUEST_TIMEOUT_MS },
  );

  record("RPC 엔드포인트 응답", rpcOutcome.source === "rpc", {
    source: rpcOutcome.source,
    reason: rpcOutcome.reason,
    rpcRows: rpcOutcome.rpcRows,
    top: rpcOutcome.matches[0]?.title,
  });
  record(`RPC 결과 최상위 문서 = ${expectedTitle}`, rpcOutcome.matches[0]?.title === expectedTitle, {
    top: rpcOutcome.matches[0]?.title,
    score: rpcOutcome.matches[0]?.score,
  });

  const fallbackCases = [
    {
      name: "함수 미존재(PGRST202) → 번들 폴백",
      call: async () => ({
        data: null,
        error: { message: "PGRST202 Could not find the function public.match_documents" },
      }),
      reason: "rpc-error",
    },
    {
      name: "네트워크 예외 → 번들 폴백",
      call: async () => {
        throw new TypeError("fetch failed");
      },
      reason: "rpc-exception",
    },
    {
      name: "빈 결과 → 번들 폴백",
      call: async () => ({ data: [], error: null }),
      reason: "rpc-empty",
    },
    {
      name: "응답 지연 → 번들 폴백",
      call: () => new Promise(() => {}),
      reason: "rpc-exception",
      timeoutMs: 250,
    },
  ];

  for (const item of fallbackCases) {
    const outcome = await engine.searchWithRpc(
      question,
      { topK: 3 },
      item.call,
      { timeoutMs: item.timeoutMs ?? TEST_TIMEOUT_MS },
    );
    const sameAsBundle = signature(outcome.matches) === signature(bundleMatches);
    record(item.name, outcome.source === "bundle" && sameAsBundle, {
      source: outcome.source,
      reason: outcome.reason,
      matchesBundle: sameAsBundle,
    });
  }

  record(
    "번들 검색 기준선",
    bundleMatches.length > 0 && bundleMatches[0]?.title === expectedTitle,
    { top: bundleMatches[0]?.title, score: bundleMatches[0]?.score },
  );

  const pass = checks.every((check) => check.pass);
  const report = {
    ticket: TICKET,
    endpoint,
    envPath: config.envPath,
    question,
    expectedTitle,
    testTimeoutMs: TEST_TIMEOUT_MS,
    pass,
    checks,
    bundleTop: bundleMatches.map((match) => ({
      title: match.title,
      score: Number(match.score.toFixed(4)),
    })),
    rpcTop: rpcOutcome.matches.map((match) => ({
      title: match.title,
      score: Number(match.score.toFixed(4)),
    })),
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "rag-rpc-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log(`\n${pass ? "PASS" : "FAIL"} (${checks.filter((c) => c.pass).length}/${checks.length})`);
  console.log(`evidence=${EVIDENCE_DIR}`);

  if (!pass) process.exitCode = 1;
}

await main();

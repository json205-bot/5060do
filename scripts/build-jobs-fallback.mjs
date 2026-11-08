import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// The offline fallback used to be the full 2,034-row crawl (~1.7MB). That is a
// heavy lazy chunk to pull when Supabase is unreachable, so this script keeps
// only the newest postings in a separate bundle-sized file. The full dataset
// stays the source of truth for seeding Supabase and can still be rebuilt.
const SOURCE_PATH = path.resolve("src", "data", "jobs_all.json");
const TARGET_PATH = path.resolve("src", "data", "jobs_recent.json");
const RECENT_LIMIT = Number(process.env.JOBS_RECENT_LIMIT ?? 300);
const MAX_BYTES = Number(process.env.JOBS_RECENT_MAX_BYTES ?? 300 * 1024);

const source = JSON.parse(await readFile(SOURCE_PATH, "utf8"));
if (!Array.isArray(source)) {
  throw new Error("src/data/jobs_all.json must be an array");
}

// Mirrors sortJobs() in src/lib/jobs.ts: newest date first, then newest id.
const byNewest = (left, right) =>
  String(right.date ?? "").localeCompare(String(left.date ?? "")) ||
  Number(right.id ?? 0) - Number(left.id ?? 0);

const recent = [...source].sort(byNewest).slice(0, RECENT_LIMIT);

await writeFile(
  TARGET_PATH,
  `${JSON.stringify(recent, null, 2)}\n`,
  "utf8",
);

const { size } = await stat(TARGET_PATH);
const oldest = recent[recent.length - 1]?.date ?? "-";
const newest = recent[0]?.date ?? "-";
const boards = recent.reduce((acc, row) => {
  const key = row.boardType ?? "(none)";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `jobs_recent: rows=${recent.length}/${source.length} bytes=${size} ` +
    `range=${oldest}~${newest}`,
);
console.log(`jobs_recent boards: ${JSON.stringify(boards)}`);

if (recent.length !== Math.min(RECENT_LIMIT, source.length)) {
  console.error("[실패] 최근 폴백 건수가 기대값과 다릅니다.");
  process.exit(1);
}

if (size > MAX_BYTES) {
  console.error(
    `[실패] jobs_recent.json이 ${MAX_BYTES}바이트를 넘었습니다 (${size}바이트).`,
  );
  process.exit(1);
}

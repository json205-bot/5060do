import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ALL_PATH = path.resolve("src", "data", "programs_all.json");
const CURATED_PATH = path.resolve("src", "data", "programs.json");
const REFERENCE_DATE = process.env.PROGRAM_REFERENCE_DATE ?? "2026-11-07";
const CENTER_LOCATION = "오륙도인생후반전지원센터";

const all = JSON.parse(await readFile(ALL_PATH, "utf8"));
const curated = JSON.parse(await readFile(CURATED_PATH, "utf8"));
const curatedById = new Map(curated.map((item) => [item.id, item]));

const applyStart = (period) => (period.split("~")[0] ?? "").trim();
const applyEnd = (period) =>
  (period.split("~")[1] ?? applyStart(period)).trim();

function normalizeStatus(program) {
  if (program.status === "대기신청") return "대기접수";
  if (program.status === "신청마감" || program.status === "종료") return "마감";
  if (program.status === "수강신청") {
    if (applyStart(program.applyPeriod) > REFERENCE_DATE) return "접수예정";
    if (applyEnd(program.applyPeriod) < REFERENCE_DATE) return "마감";
    return "접수중";
  }
  return "마감";
}

const rows = all
  .filter((program) => program.status !== "종료")
  .map((program) => {
    const override = curatedById.get(program.id);
    return {
      id: program.id,
      title: program.title,
      category: program.category,
      summary: override?.summary || program.summary || "",
      capacity: program.capacity,
      enrolled: program.enrolled,
      location: override?.location || program.location || CENTER_LOCATION,
      fee: program.fee,
      target: program.target,
      applyPeriod: program.applyPeriod,
      eduPeriod: program.eduPeriod,
      status: normalizeStatus(program),
      sourceUrl: program.sourceUrl,
    };
  })
  .sort((a, b) => b.id - a.id);

await writeFile(
  CURATED_PATH,
  `${JSON.stringify(rows, null, 2)}\n`,
  "utf8",
);

const counts = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});
console.log(`rows=${rows.length}`, counts);

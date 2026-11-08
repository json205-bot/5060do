import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Exercises the --update-local pipeline without touching the real bundles or
// Supabase: a tiny baseline in a temp dir forces a few "new" ids, the crawler
// runs in dry-run so no upsert happens, and the auto rebuild must produce the
// companion jobs_recent.json from the merged temp dataset.
const REAL_DATASET = path.resolve("src", "data", "jobs_all.json");
const BASELINE_ROWS = 5;
const NEW_LIMIT = 2;
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const EVIDENCE_DIR = path.resolve(
  "docs",
  "evidence",
  `jobs-incremental-${stamp}-local-sync`,
);

async function main() {
  const realRows = JSON.parse(await readFile(REAL_DATASET, "utf8"));
  if (!Array.isArray(realRows) || realRows.length < BASELINE_ROWS) {
    throw new Error("src/data/jobs_all.json is missing or too small");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "5060do-local-sync-"));
  const allPath = path.join(workDir, "jobs_all.json");
  const recentPath = path.join(workDir, "jobs_recent.json");
  const baseline = realRows.slice(0, BASELINE_ROWS);
  await writeFile(allPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  const env = {
    ...process.env,
    JOBS_ALL_PATH: allPath,
    JOBS_RECENT_PATH: recentPath,
    JOBS_CRAWL_MAX_PAGES: "1",
  };
  console.log(
    `[run] crawl --dry-run --update-local --limit=${NEW_LIMIT} maxPages=1 baseline=${BASELINE_ROWS}`,
  );
  const child = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "scripts/crawl-incremental-jobs.mjs",
      "--dry-run",
      "--update-local",
      `--limit=${NEW_LIMIT}`,
    ],
    { env, encoding: "utf8" },
  );
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  process.stdout.write(output);

  const allRows = JSON.parse(await readFile(allPath, "utf8"));
  const recentRows = JSON.parse(await readFile(recentPath, "utf8"));
  const recentInfo = await stat(recentPath);

  const evidenceLine = output.match(/^evidence=(.+)$/m)?.[1]?.trim();
  let crawlReport = null;
  if (evidenceLine) {
    try {
      crawlReport = JSON.parse(
        await readFile(
          path.join(evidenceLine, "jobs-incremental-report.json"),
          "utf8",
        ),
      );
    } catch {
      console.warn(`crawl report not readable: ${evidenceLine}`);
    }
  }

  const checks = [
    {
      name: "크롤러 종료 코드 0",
      pass: child.status === 0,
      detail: child.status,
    },
    {
      name: `jobs_all.json ${BASELINE_ROWS} -> ${BASELINE_ROWS + NEW_LIMIT}`,
      pass: allRows.length === BASELINE_ROWS + NEW_LIMIT,
      detail: allRows.length,
    },
    {
      name: "jobs_recent.json 자동 생성",
      pass:
        recentRows.length === Math.min(300, BASELINE_ROWS + NEW_LIMIT) &&
        recentInfo.size > 0,
      detail: { rows: recentRows.length, bytes: recentInfo.size },
    },
    {
      name: "로그에 local=true fallback=true",
      pass:
        /local=true/.test(output) &&
        /fallback=true/.test(output) &&
        /failures=0/.test(output),
      detail: output.match(/new=.*failures=\d+/)?.[0] ?? "",
    },
  ];

  const report = {
    baselineRows: BASELINE_ROWS,
    newLimit: NEW_LIMIT,
    mergedRows: allRows.length,
    recentRows: recentRows.length,
    recentBytes: recentInfo.size,
    crawlReportPath: evidenceLine ?? null,
    crawlReportSummary: crawlReport
      ? {
          updatedLocal: crawlReport.updatedLocal,
          fallbackUpdated: crawlReport.fallbackUpdated,
          failures: crawlReport.failures,
        }
      : null,
    checks,
    pass: checks.every((check) => check.pass),
    checkedAt: new Date().toISOString(),
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "jobs-local-sync.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  for (const check of checks) {
    console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  }
  console.log(`${report.pass ? "PASS" : "FAIL"} jobs-local-sync`);
  console.log(`evidence=${EVIDENCE_DIR}`);

  await rm(workDir, { recursive: true, force: true });
  if (!report.pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

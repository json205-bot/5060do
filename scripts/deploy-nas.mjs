import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One-click NAS release: build the static export under /5060do, copy it to the
// NAS www root, refresh the site index, then run the live verifier. Manual runs
// used to chain three separate commands; a failed step now stops the pipeline.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/5060do";
// The NAS build talks to Supabase pgvector first and falls back to the bundled
// index when the network or RPC fails. Override with NEXT_PUBLIC_RAG_SOURCE=local
// to ship the bundle-only build again.
const RAG_SOURCE = process.env.NEXT_PUBLIC_RAG_SOURCE ?? "supabase";
const SITE = process.env.NAS_WWW_SITE ?? "5060do";
const NAS_HOST = process.env.NAS_SSH_HOST ?? "bot@100.83.116.15";
const NAS_PORT = process.env.NAS_SSH_PORT ?? "2233";
const NAS_KEY =
  process.env.NAS_SSH_KEY ??
  path.join(homedir(), ".ssh", "maintain_bot_ed25519");
const REMOTE_SOURCE =
  process.env.NAS_DEPLOY_SOURCE ?? "/volume1/workspace/dev/5060do/out";
const REMOTE_DEPLOY_SCRIPT =
  process.env.NAS_DEPLOY_SCRIPT ??
  "/volume1/workspace/common/scripts/deploy_www.sh";
const REMOTE_INDEX_SCRIPT =
  process.env.NAS_INDEX_SCRIPT ??
  "/volume1/workspace/common/scripts/www_index.sh";
const TARGET_URL =
  process.env.NAS_LIVE_URL ?? `http://100.83.116.15:8780/${SITE}/`;

// npm and cmd.exe refuse a UNC working directory, so a caller that started from
// `\\x4\workspace\...` is moved to the drive letter pointing at the same tree.
function toDrivePath(uncPath) {
  const match = uncPath.match(/^\\\\[^\\]+\\[^\\]+(\\[\s\S]*)?$/);
  if (!match) return null;
  const rest = (match[1] ?? "").replace(/^\\+/, "");
  for (let code = 90; code >= 65; code -= 1) {
    const candidate = path.join(`${String.fromCharCode(code)}:\\`, rest);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

if (process.platform === "win32" && process.cwd().startsWith("\\\\")) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const mapped = toDrivePath(process.cwd()) ?? toDrivePath(scriptRoot);
  if (mapped) {
    process.chdir(mapped);
    console.log(`[안내] UNC 작업 경로를 드라이브 경로로 변환: ${mapped}`);
  }
}

// Resolve the checkout through the drive letter too: npm refuses to spawn from
// a UNC path even after the process cwd was remapped above.
let repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform === "win32" && repoRoot.startsWith("\\\\")) {
  repoRoot = toDrivePath(repoRoot) ?? repoRoot;
}
const outDir = path.join(repoRoot, "out");

function run(label, command, args, options = {}) {
  console.log(`\n[실행] ${label}`);
  console.log(`[명령] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    throw new Error(`${label} 실행 실패: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} 실패 (Exit ${result.status ?? "null"})`);
  }
}

function sshArgs(remoteCommand) {
  return [
    "-i",
    NAS_KEY,
    "-p",
    NAS_PORT,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    NAS_HOST,
    remoteCommand,
  ];
}

// The NAS shares the same tree over SMB, so the checkout can be built on the
// workstation while deploy_www.sh still runs on the NAS host.
function runsOnNasHost() {
  return process.platform !== "win32" && existsSync(REMOTE_DEPLOY_SCRIPT);
}

function deployToWww() {
  const deployArgs = [REMOTE_DEPLOY_SCRIPT, REMOTE_SOURCE, SITE];
  if (runsOnNasHost()) {
    run("NAS www 동기화", "sh", deployArgs);
    run("NAS 사이트 목록 갱신", "sh", [REMOTE_INDEX_SCRIPT]);
    return;
  }
  run("NAS www 동기화", "ssh", sshArgs(`sh ${deployArgs.join(" ")}`));
  run("NAS 사이트 목록 갱신", "ssh", sshArgs(`sh ${REMOTE_INDEX_SCRIPT}`));
}

async function assertBasePathIntegrity() {
  const rootHtml = await readFile(path.join(outDir, "index.html"), "utf8");
  const classicHtml = await readFile(
    path.join(outDir, "classic", "index.html"),
    "utf8",
  );
  const escaped = BASE_PATH.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  const rootLeakPattern = /(?<![A-Za-z0-9._-])\/_next\//g;
  const prefixed = new RegExp(`${escaped}/_next/`, "g");
  const report = {
    rootPrefixed: (rootHtml.match(prefixed) ?? []).length,
    rootLeak: (rootHtml.match(rootLeakPattern) ?? []).length,
    classicPrefixed: (classicHtml.match(prefixed) ?? []).length,
    classicLeak: (classicHtml.match(rootLeakPattern) ?? []).length,
  };
  console.log(
    `[검사] basePath 무결성 root=${report.rootPrefixed}/${report.rootLeak} classic=${report.classicPrefixed}/${report.classicLeak}`,
  );
  if (
    report.rootPrefixed === 0 ||
    report.classicPrefixed === 0 ||
    report.rootLeak > 0 ||
    report.classicLeak > 0
  ) {
    throw new Error(
      `basePath 무결성 실패: ${JSON.stringify(report)}. ` +
        `NEXT_PUBLIC_BASE_PATH=${BASE_PATH} 로 다시 빌드해야 합니다.`,
    );
  }
}

async function main() {
  if (!/^[A-Za-z0-9_-]+$/.test(SITE)) {
    throw new Error(`사이트 이름이 올바르지 않습니다: ${SITE}`);
  }
  if (!BASE_PATH.startsWith("/") || /\s/.test(BASE_PATH)) {
    throw new Error(`basePath가 올바르지 않습니다: ${BASE_PATH}`);
  }

  console.log(`[정보] 사이트 ${SITE}, basePath ${BASE_PATH}`);
  console.log(`[정보] RAG 소스 ${RAG_SOURCE}`);
  console.log(`[정보] 검증 대상 ${TARGET_URL}`);

  run("정적 내보내기 빌드", "npm run build", [], {
    cwd: repoRoot,
    shell: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_BASE_PATH: BASE_PATH,
      NEXT_PUBLIC_RAG_SOURCE: RAG_SOURCE,
    },
  });

  if (!existsSync(path.join(outDir, "index.html"))) {
    throw new Error(`빌드 산출물이 없습니다: ${outDir}`);
  }
  await assertBasePathIntegrity();

  deployToWww();

  run("NAS 운영 배포 검증", process.execPath, [
    path.join(repoRoot, "scripts", "verify-nas-live.mjs"),
    "--url",
    TARGET_URL,
  ]);

  console.log("\n[완료] 빌드 · 배포 · 검증 원클릭 파이프라인이 끝났습니다.");
}

main().catch((error) => {
  console.error(`\n[실패] ${error.message}`);
  process.exit(1);
});

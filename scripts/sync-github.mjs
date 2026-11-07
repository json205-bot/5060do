import { spawnSync } from "node:child_process";

// Mirrors the current branch to the `github` remote so Vercel's Git
// integration can pick up the commit. Gitea `origin` is intentionally left
// untouched: this script only ever pushes to the mirror remote.
const REMOTE = "github";
const BRANCH = process.argv[2] ?? "master";

// Missing credentials must fail fast instead of opening a hidden prompt:
// GIT_TERMINAL_PROMPT covers terminal prompts and GCM_INTERACTIVE stops the
// Git Credential Manager from waiting on a GUI dialog.
function git(args, options = {}) {
  return spawnSync("git", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
    },
    ...options,
  });
}

const remoteUrl = git(["remote", "get-url", REMOTE]);

if (remoteUrl.status !== 0 || !remoteUrl.stdout.trim()) {
  console.error(
    [
      `[안내] '${REMOTE}' 원격이 설정되어 있지 않습니다.`,
      `GitHub 미러를 한 번만 등록하면 다음부터 이 명령으로 동기화할 수 있습니다.`,
      "",
      "  git remote add github https://github.com/<계정>/<저장소>.git",
      `  npm run push:github`,
      "",
      "원격을 등록하지 않아도 Gitea origin 푸시에는 영향이 없습니다.",
    ].join("\n"),
  );
  process.exit(1);
}

const status = git(["status", "--porcelain"]);

if (status.status !== 0) {
  console.error("[실패] git status 조회에 실패했습니다.");
  process.exit(status.status ?? 1);
}

if (status.stdout.trim()) {
  console.error(
    [
      "[중단] 작업 트리에 커밋되지 않은 변경이 있어 푸시하지 않았습니다.",
      "변경 내용을 커밋한 뒤 다시 실행하세요.",
      "",
      ...status.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => `  ${line}`),
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`[정보] ${REMOTE} → ${remoteUrl.stdout.trim()}`);
console.log(`[정보] git push ${REMOTE} ${BRANCH} 실행`);

const push = git(["push", REMOTE, BRANCH], { stdio: "inherit" });

if (push.status !== 0) {
  console.error(
    [
      `[실패] ${REMOTE} 푸시가 종료 코드 ${push.status ?? "null"}로 실패했습니다.`,
      `'${REMOTE}' 원격 저장소에 대한 쓰기 권한과 자격 증명을 확인하세요.`,
    ].join("\n"),
  );
  process.exit(push.status ?? 1);
}

const localHash = git(["rev-parse", "HEAD"]).stdout.trim();
const remoteHash = git(["ls-remote", REMOTE, `refs/heads/${BRANCH}`])
  .stdout.trim()
  .split(/\s+/)[0];

console.log(`[정보] 로컬 ${BRANCH} 커밋: ${localHash}`);
console.log(`[정보] 원격 ${BRANCH} 커밋: ${remoteHash || "(없음)"}`);

if (!remoteHash || remoteHash !== localHash) {
  console.error("[실패] 원격 브랜치 커밋이 로컬과 일치하지 않습니다.");
  process.exit(1);
}

console.log(`[완료] ${BRANCH} 브랜치를 ${REMOTE} 원격에 동기화했습니다.`);

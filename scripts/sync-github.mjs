import { spawnSync } from "node:child_process";

// Mirrors the current branch to the `github` remote so Vercel's Git
// integration can pick up the commit. Gitea `origin` is intentionally left
// untouched: this script only ever pushes to the mirror remote.
const REMOTE = "github";
const BRANCH = process.argv[2] ?? "master";

function run(args) {
  return spawnSync("git", args, { encoding: "utf8", shell: process.platform === "win32" });
}

const remoteUrl = run(["remote", "get-url", REMOTE]);

if (remoteUrl.status !== 0 || !remoteUrl.stdout.trim()) {
  console.log(
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
  process.exit(0);
}

console.log(`[정보] ${REMOTE} → ${remoteUrl.stdout.trim()}`);
console.log(`[정보] git push ${REMOTE} ${BRANCH} 실행`);

const push = spawnSync("git", ["push", REMOTE, BRANCH], {
  encoding: "utf8",
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (push.status !== 0) {
  console.error(
    `[실패] ${REMOTE} 푸시가 종료 코드 ${push.status ?? "null"}로 실패했습니다.`,
  );
  process.exit(push.status ?? 1);
}

console.log(`[완료] ${BRANCH} 브랜치를 ${REMOTE} 원격에 동기화했습니다.`);

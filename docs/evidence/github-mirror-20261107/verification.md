# 5060do GitHub 미러 연결·동기화 검증 기록

- 작업지시서: `TASK_20261107_2315_5060do-github-mirror-push-and-sync.md` (ticket `5060DO-20261107-2315`)
- 실행: 2026-11-07 23:15~23:47 KST, white PC, opencode(deepseek-v4.1-flash)
- 작업 경로: `Z:\dev\5060do`

## 1. 원격 구성

```
$ git remote -v
github  https://github.com/json205-bot/5060do.git (fetch)
github  https://github.com/json205-bot/5060do.git (push)
origin  http://100.83.116.15:3300/Jason/5060do.git (fetch)
origin  http://100.83.116.15:3300/Jason/5060do.git (push)

$ git ls-remote https://github.com/json205-bot/5060do.git
(출력 없음 — 원격 저장소 비어 있음)
```

## 2. GitHub 푸시 시도 (실패)

일반 `git push -u github master`는 자격 증명 관리자(GCM) 대화상자를 기다리며 300초 동안 응답이 없어 중단했다.
자격 증명 경로를 gh 토큰으로 고정하고 권한을 직접 확인한 결과는 아래와 같다.

```
$ git -c credential.helper= -c credential.helper="!gh auth git-credential" push --dry-run github master
remote: Permission to json205-bot/5060do.git denied to Jasonkim205.
fatal: unable to access 'https://github.com/json205-bot/5060do.git/': The requested URL returned error: 403
EXIT=128
```

```
$ gh api repos/json205-bot/5060do --jq '.permissions'
{"admin":false,"maintain":false,"pull":true,"push":false,"triage":false}
```

- 현재 PC에 저장된 GitHub 자격 증명은 `Jasonkim205` 계정 하나뿐이다(`gh auth status`).
- `json205-bot/5060do`는 `Jasonkim205`에게 읽기 권한만 부여되어 있다(쓰기 없음).
- 따라서 원격 등록 자체는 완료했지만 최초 푸시는 권한 차단으로 실패했다.

## 3. 동기화 스크립트

```
$ node scripts/sync-github.mjs        # 변경 미커밋 상태에서 실행
[중단] 작업 트리에 커밋되지 않은 변경이 있어 푸시하지 않았습니다.
변경 내용을 커밋한 뒤 다시 실행하세요.
  M scripts/sync-github.mjs
  ?? .sync-guard-test
EXIT=1
```

```
$ npm run push:github                 # 커밋 후 실행
[정보] github → https://github.com/json205-bot/5060do.git
[정보] git push github master 실행
fatal: Cannot prompt because user interactivity has been disabled.
fatal: could not read Username for 'https://github.com': terminal prompts disabled
[실패] github 푸시가 종료 코드 128로 실패했습니다.
'github' 원격 저장소에 대한 쓰기 권한과 자격 증명을 확인하세요.
EXIT=128
```

- 자격 증명이 없거나 권한이 없을 때 대화상자에서 멈추지 않고 즉시 실패하도록 `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`를 넣었다.
- 푸시 성공 시 로컬/원격 커밋 해시를 함께 출력하고 불일치하면 종료 코드 1로 끝난다(권한 확보 후 실사용 검증 필요).

## 4. 빌드·타입·E2E

```
$ npm run typecheck
> tsc --noEmit
EXIT=0

$ npm run lint
> eslint
EXIT=0

$ node scripts/test-vercel.mjs
PASS (80/80)
{
  "basePath": "",
  "buildExit": 0,
  "verifyExit": 0,
  "rootLeak": false,
  "probes": { "/": 200, "/classic/": 200 },
  "checkedAt": "2026-11-07T14:28:18.945Z"
}
EXIT=0

$ npm run build
> next build && node scripts/postbuild-static-rsc.mjs
[postbuild] classic\__next.classic.__PAGE__.txt <- classic\__next.classic\__PAGE__.txt
[postbuild] _not-found\__next._not-found.__PAGE__.txt <- _not-found\__next._not-found.__PAGE__.txt
EXIT=0
```

- E2E 산출물: `docs/evidence/vercel-e2e-20261107/` (프로그램 검증 80건 PASS, `/5060do` 누출 0건)
- `npm run build`는 다시 NAS 기준(`basePath=/5060do`) 산출물로 `out/`을 되돌려 두었다.

## 5. Gitea(origin) 반영

```
$ git commit -m "feat(deploy): setup github remote mirror and push:github script"
[master c37f2eb] feat(deploy): setup github remote mirror and push:github script
 6 files changed, 128 insertions(+), 46 deletions(-)

$ git push origin master
   bc96c0e..c37f2eb  master -> master
EXIT=0
```

## 6. 판정

| 항목 | 결과 |
|---|---|
| github 원격 등록 | PASS (`https://github.com/json205-bot/5060do.git`) |
| github 최초 푸시 | **FAIL** — 403, `Jasonkim205` 쓰기 권한 없음 |
| `npm run push:github` | **FAIL** — 자격 증명/권한 없음(즉시 실패, 행 없음) |
| typecheck | PASS (Exit 0) |
| lint | PASS (Exit 0) |
| Vercel 루트 E2E | PASS (80/80, 누출 0건) |
| build | PASS (Exit 0) |
| origin 푸시 | PASS (`c37f2eb`) |

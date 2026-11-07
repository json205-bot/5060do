---
title: 5060do Vercel·NAS 듀얼 basePath 및 접수중 임박순 정렬·타임아웃 가드
project: 5060do
date: 2026-11-07
pc: White
model: opencode / deepseek-v4.1-flash
ticket: 5060DO-20261107-1520
---

# 5060do Vercel·NAS 듀얼 basePath 및 접수중 임박순 정렬·타임아웃 가드

## 1. 목표

- Vercel 루트 배포와 NAS 서브패스(`/5060do`) 배포를 빌드 환경변수로 자동 분기.
- 첫 페이지 접수중 강좌를 잔여석 마감 임박순으로 표시.
- 수파베이스 무응답 시 5초 뒤 로컬 데이터로 폴백.

## 2. 구현

| 파일 | 변경 |
|---|---|
| `next.config.ts` | `NEXT_PUBLIC_BASE_PATH ?? (VERCEL ? "" : "/5060do")` 동적 basePath, `env`로 클라이언트 번들에 값 인라인 |
| `src/lib/basePath.ts` | 신규. `basePath`·`withBasePath()` 헬퍼 |
| `src/app/page.tsx` | 로고 3종 `src`를 `withBasePath()`로 교체 |
| `src/app/classic/page.tsx` | 로고 3종·홈 링크를 `withBasePath()`로 교체 |
| `src/components/version-switcher.tsx` | 하드코딩 `/5060do` 경로를 `withBasePath()` 결과로 교체 |
| `src/lib/programs.ts` | `programRequestTimeoutMs = 5000`, `withRequestTimeout()` AbortController, 카운트·페이지 쿼리에 `abortSignal` 연결, `orderOpenProgramsByImminence()` 추가 |
| `src/hooks/usePrograms.ts` | 첫 페이지 fetch에만 접수중 임박순 정렬 적용, [더보기]는 서버 순서 그대로 append |
| `scripts/verify-programs.mjs` | 접수중 임박순·5초 타임아웃 폴백 검증 2건 추가 |

## 3. 검증

| 항목 | 결과 | 증거 |
|---|---|---|
| `npm run typecheck` | Exit 0 | — |
| `npm run lint` | Exit 0 | `docs/evidence/dual-basepath-20261107/lint.log` |
| Vercel 루트 모드 빌드 (`VERCEL=1`) | Exit 0, `out/index.html`에 `/5060do` 0건 | `build-vercel-root.log`, `vercel-root-html.txt` |
| 루트 모드 산출물 HTTP | `/`·`/classic/`·로고·JS 전부 200 | `vercel-root-http.txt` |
| NAS 모드 빌드 | Exit 0, `_next`·`assets` 전부 `/5060do` 접두 | `build-nas-basepath.log`, `nas-html-check.txt` |
| NAS 배포 | 37파일 `/volume3/www/5060do` | `deploy.log` |
| 게이트웨이 HTTP | `/5060do/`·`/classic/`·로고·아이콘 200 | `gateway-http.txt` |
| `verify-programs.mjs` | **70/70 PASS** | `verification.json`, `verify-programs.log` |
| 접수중 잔여 비율 | 0.067 → 0.286 → 0.5 → 0.533 → 0.533 → 0.55 → 1.0 오름차순 | `verification.json` |
| 타임아웃 폴백 | 5,230ms 뒤 local 47건 전환 | `verification.json` |

## 4. 남은 위험

- Vercel 실제 배포는 자격증명이 없어 하지 않았다. 루트 모드 빌드 산출물과 로컬 정적 서버 200 응답까지만 확인했다.
- `scripts/verify-dual-version.mjs`·`verify-viewports.mjs`는 여전히 `/5060do` 고정 주소를 전제로 한다. 루트 모드 E2E는 미검증.
- 접수중 그룹이 30건을 넘으면 2페이지 접수중 카드는 서버 순서(최신 id)로 append되어 첫 페이지와 기준이 달라진다. 현재 접수중 7건이라 발생하지 않는다.

## 5. 판정

- 검증: **PASS** (70/70)
- 평가: **ACCEPT**

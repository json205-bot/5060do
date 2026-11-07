---
title: 5060do 센터 지식 documents 적재·챗봇 활성강좌 전용 조회·Vercel 배포 가이드
project: 5060do
date: 2026-11-07
pc: White
model: opencode / deepseek-v4.1-flash
ticket: 5060DO-20261107-1810
---

# 5060do 센터 지식 documents 적재·챗봇 활성강좌 전용 조회·Vercel 배포 가이드

## 1. 목표

- `src/data/center_knowledge.json`의 센터 안내·시설·위치 지식을 수파베이스 `public.documents`에 일괄 적재한다.
- 챗봇이 메인 목록 첫 페이지(30건)와 무관하게 활성 강좌(접수중·접수예정·대기접수) 전체를 근거로 답하도록 분리 조회한다.
- 접수중 30건 초과 시 페이지 경계 병합에서도 잔여석 임박순이 유지되는지 외부 패키지 없는 단위 테스트로 고정한다.
- Vercel 클라우드 실배포 절차(대시보드·GitHub 미러·CLI)를 문서로 확정하고 배포 자동화 경로를 정리한다.

## 2. 구현

| 파일 | 내용 |
|---|---|
| `scripts/seed-supabase-knowledge.mjs` | 신규. `center_knowledge.json` 14개 항목 중 텍스트가 있는 6개만 평탄화해 `documents(id, title, category, content)`로 upsert. 빈 청크 8개 제외, 6건 적재 후 count·내용 길이·키워드(인사말·층별안내·위치/주차·대관) 검증, 증거 JSON 기록 |
| `src/lib/programs.ts` | `activeProgramColumns`, `activeStatusOrderLimit=4`, `fetchActivePrograms()` 추가. `status_order < 4` 조건으로 활성 강좌 전용 경량 컬럼 1회 조회(`range 0..999`) |
| `src/hooks/usePrograms.ts` | `activePrograms` 상태와 `loadActivePrograms()` 추가. 챗봇을 처음 열 때 1회만 조회하도록 지연 실행해 초기 목록 15KB 예산 유지, 실패 시 로컬 활성 강좌 폴백 |
| `src/components/ChatbotWidget.tsx` | `activePrograms`·`onOpen` props 추가. `freeCourseReply()`는 활성 강좌 전체에서 무료 강좌 추출, `applyReply()`는 활성 강좌의 접수중 건수 사용, 트리거 클릭 시 `onOpen()` 호출 |
| `src/app/page.tsx` | `activePrograms`·`loadActivePrograms` 전달 |
| `tests/unit-merge-programs.mjs` | 신규. Node 내장 `assert`만 사용. 40건 접수중(1페이지 30 + 2페이지 10) 병합 후 잔여석 비율 0.0→1.0 오름차순, id 중복 없음, 재병합 무증가, 마감 그룹 순서 보존 |
| `package.json` | `test:unit`, `data:knowledge` 스크립트 등록 |
| `docs/VERCEL_DEPLOY_GUIDE.md` | 신규. Vercel 프로젝트 설정값, 필수 환경변수 3종, GitHub 미러 푸시, CLI 배포, 7단계 확인 체크리스트, 문제 해결 |

## 3. 검증

| 검증 | 실행 | 결과 |
|---|---|---|
| 타입체크 | `node node_modules/typescript/bin/tsc --noEmit` | Exit 0 |
| 린트 | `node node_modules/eslint/bin/eslint.js .` | Exit 0 |
| 지식 적재 | `node scripts/seed-supabase-knowledge.mjs` | 6건 upsert, count 6/6, 내용 길이 일치, 키워드 4종 PASS |
| 단위 테스트 | `node tests/unit-merge-programs.mjs` | PASS (40건, 0.0→1.0) |
| 활성 강좌 조회 | `fetchActivePrograms()` 실호출 | 15건(접수중 7·접수예정 1·대기접수 7), 무료 2건 |
| NAS 빌드 | `node node_modules/next/dist/bin/next build` + `postbuild-static-rsc.mjs` | Exit 0, `/5060do` 28회 |
| NAS 배포 | `deploy_www.sh /volume1/workspace/dev/5060do/out 5060do` | 37개 파일, `/5060do/` 200, `/5060do/classic/` 200 |
| NAS E2E | `BASE_URL=http://100.83.116.15:8780/5060do/ node scripts/verify-programs.mjs` | **77/77 PASS** |
| Vercel 루트 E2E | `node scripts/test-vercel.mjs` | 빌드 Exit 0, `/` 200, `/classic/` 200, `/5060do` 누출 0, **77/77 PASS** |

증거 경로:

- `docs/evidence/knowledge-chatbot-20261107/` — typecheck·lint·unit·build·deploy·E2E 로그, `fetch-active-programs.json`, 스크린샷
- `docs/evidence/knowledge-seed-20261107T091521/seed-report.json` — documents 적재 결과

## 4. 결정 사항

- 활성 강좌 전용 조회는 페이지 로드가 아니라 챗봇 최초 오픈 시점에 실행한다. 초기 목록 원본 JSON 15KB 예산(`verify-programs.mjs` 검사)을 넘기지 않으면서 챗봇은 전체 활성 강좌를 확보한다.
- `documents.id`는 정수 기본키이므로 원본 14개 항목 중 텍스트가 있는 순서대로 1..6을 부여한다. 재실행 시 `on_conflict=id` upsert라 중복이 생기지 않는다.
- 단위 테스트는 새 패키지 없이 Node 24의 TypeScript 타입 스트리핑으로 `src/lib/programs.ts`를 직접 import 한다.

## 5. 남은 위험

- 실제 Vercel 클라우드 배포는 GitHub 원격·Vercel 토큰이 없어 실행하지 않았다. 로컬 루트 빌드·정적 서빙·E2E로 재현만 했다.
- 활성 강좌가 30건을 넘는 실데이터 상황은 만들지 않았다. 40건 가상 데이터 단위 테스트로 병합 경로만 검증했다.
- `fetchActivePrograms()`는 `range 0..999` 단일 조회다. 활성 강좌가 1,000건을 넘으면 일부가 누락된다(현재 15건).
- 센터 지식 14개 항목 중 8개는 크롤링 원문이 이미지·지도라 텍스트가 없어 적재에서 제외됐다(연혁·조직도·사업안내 등).

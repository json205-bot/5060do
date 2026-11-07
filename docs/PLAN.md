---
title: 5060do 반응형 웹 프로토타입 계획
project: 5060do
date: 2026-11-06
status: done
---

# 5060do 반응형 웹 프로토타입 계획

## 1. 목표

오륙도인생후반전지원센터 웹사이트의 반응형 웹(PC·태블릿·모바일) 개편과
향후 하이브리드 앱(웹뷰)·전자결제 연동 전에, 로컬에서 수강신청 흐름을
끝까지 검증할 수 있는 프로토타입을 만든다.

- 50~60대 신중년 이용자를 위한 고대비·대형 터치 UI
- 모바일 1열 / 태블릿 2열 / PC 3열 카드 그리드
- 강좌 상세 모달 → 신청자 정보 입력 → 가상 결제 승인까지 한 흐름

## 2. 구현 범위

| 구분 | 내용 |
|---|---|
| 스택 | Next.js 16.4.5 (App Router), TypeScript, Tailwind CSS v4, lucide-react |
| 데이터 | `src/data/programs.json` — 크롤링 아카이브의 실제 강좌 3건 + 마감 상태 확인용 1건 |
| 화면 | `src/app/page.tsx` — 헤더·히어로·카드 그리드·모달·신청 폼·완료 화면 |
| 반응형 | 모바일 1열, 태블릿 2열, PC 3열 / 기본 글자 18px / 주요 버튼 최소 56px |
| 가상 결제 | 결제 버튼 클릭 시 콘솔 로그 + 얼럿 "테스트 결제 승인 완료" |

## 3. 검증 기준

1. `npm run typecheck` 오류 0건
2. `npm run build` 성공 (Exit Code 0)
3. 뷰포트 390 / 768 / 1280px에서 가로 스크롤 없음, 열 수 1/2/3 일치
4. 모달 열기·닫기, 신청 폼, 가상 결제 얼럿·완료 화면 동작
5. 마감 강좌는 신청 버튼이 비활성화되는가

## 4. 검증 결과

- typecheck PASS, build PASS
- `scripts/verify-viewports.mjs` (Chrome CDP 헤드리스)로 5개 항목 전부 PASS
- 증거: `docs/evidence/verification.json`, 스크린샷 7장

## 5. 남은 일

- 실제 백엔드·본인인증·PG 연동은 범위 밖(프로토타입)
- 채용정보·공지사항은 외부 링크 안내만 제공
- 관리자용 강좌 등록 화면 미구현

## 6. 나스 상시 배포 (2026-11-06 19:30)

| 구분 | 내용 |
|---|---|
| 목표 | 화이트 PC 전원과 무관하게 테일스케일 환경에서 상시 접속 |
| 설정 | `next.config.ts` — `output: "export"`, `basePath: "/5060do"`, `trailingSlash: true`, `images.unoptimized: true` |
| 배포 | `deploy_www.sh /volume1/workspace/dev/5060do/out 5060do` → `/volume3/www/5060do` |
| 주소 | `http://100.83.116.15:8780/5060do/` |
| 검증 | typecheck·build Exit 0, 실서버 HTTP 200, 정적 리소스 404 0건, 390px E2E 전 흐름 PASS |
| 증거 | `docs/evidence/build-deploy.log`, `docs/evidence/verify-deploy.log`, `docs/evidence/deploy-20261106/` |

## 7. 모바일 하단 5탭 내비게이션 (2026-11-06 19:58)

| 구분 | 내용 |
|---|---|
| 목표 | 28개 메뉴 구조를 모바일에서 5개 핵심 동선으로 단순화, 50~60대 터치 오조작 최소화 |
| 구현 | `src/app/page.tsx` — 하단 고정 5탭(홈·교육신청·채용정보·공지사항·전체), 전체 메뉴 드로어, 스크롤 위치 기반 활성 탭, 헤더 메뉴는 `md` 이상에서만 노출 |
| 스타일 | 탭 라벨 13px, 390px 기준 탭 높이 72px, 활성 `text-brand-700 font-bold` + 상단 인디케이터, 비활성 `text-slate-500`, `env(safe-area-inset-bottom)` 패딩 |
| 레이아웃 | `layout.tsx` `viewportFit: "cover"`, 콘텐츠 래퍼 `pb-20 md:pb-0` |
| 검증 | typecheck·lint·build Exit 0, 실서버 HTTP 200·리소스 404 0건, 390px 5탭·탭 높이 72px·라벨 13px, 탭 4종 스크롤 도달, 드로어 열기/바로가기/닫기, 768·1280px `display: none` |
| 증거 | `docs/evidence/verify-mobile-bottom-nav.log`, `docs/evidence/mobile-bottom-nav-http.log`, `docs/evidence/mobile-bottom-nav-20261106/` |

## 8. 원본 반응형(Classic)·축소 모던(Modern) 듀얼 버전 (2026-11-07 05:30)

| 구분 | 내용 |
|---|---|
| 목표 | 원본 8대 GNB·28개 세부 메뉴를 보존한 Classic 버전과 5탭 모던 버전을 동시 서빙 |
| 구조 | Modern `/5060do/` (기존 유지), Classic `/5060do/classic/` 신설, 두 화면 최상단 버전 전환 배너 |
| Classic PC | 로고·유틸리티(로그인/회원가입/브로슈어/통합검색) + 8대 GNB 메가드롭다운(그룹별 8·4·2·2·2·4·6·1 링크) |
| Classic 모바일 | 우측 슬라이드 인 드로어 + 8대 대메뉴 아코디언(총 29개 세부 링크 100% 접근) |
| 본문 | 비주얼 롤링 3종, 사업안내/교육신청/일자리정보 탭 카드, 새 소식·일자리 그리드, 바로가기, 층별 시설·상담 안내를 Flex/Grid 1열 자동 재배치 |
| 빌드 보정 | `scripts/postbuild-static-rsc.mjs` — 중첩 라우트 RSC 페이로드(`classic/__next.classic.__PAGE__.txt`) 미러링으로 정적 export 404 제거 |
| 검증 | typecheck·lint·build Exit 0, 실서버 두 경로 HTTP 200·리소스 404 0건, 390/768/1280px 가로 스크롤 없음, 드로어·아코디언 29링크, 모던 5탭, 전환 왕복 PASS |
| 증거 | `docs/evidence/dual-version-*.log`, `docs/evidence/dual-version-20261107/` |

## 9. 크롤링 HTML 데이터 정제·JSON 지식 베이스 추출 (2026-11-07 05:50)

| 구분 | 내용 |
|---|---|
| 목표 | 나스 미러(`/data_collect/web_crawling/5060do.or.kr/mirror`)의 3,521쪽 HTML에서 교육·일자리·센터 안내를 구조화 JSON으로 추출 |
| 스크립트 | `scripts/extract_data.py` — 표준 라이브러리 `html.parser` 기반 DOM 파서, 외부 패키지 없음 |
| 프로그램 | `src/data/programs_all.json` 667건 (상세 페이지 667쪽 전수), 필드 `id·title·category·summary·capacity·enrolled·location·fee·target·applyPeriod·eduPeriod·status·sourceUrl·content` |
| 일자리 | `src/data/jobs_all.json` 2,034건 (사회공헌 48·취업지원 459·창업 121·일자리 1,406) |
| 지식 청크 | `src/data/center_knowledge.json` 14쪽(센터소개 7·사업안내 4·커뮤니티 1·공유사무실 1·대관 1), 텍스트 7청크 |
| 검증 | `scripts/verify_data.py` PASS (건수·중복·필수 필드), `npm run typecheck` Exit 0 |
| 한계 | 프로그램 상세 641건과 일자리 34건, 센터 안내 8쪽은 본문이 이미지뿐이어서 텍스트가 비었다. OCR은 이번 범위 밖 |
| 증거 | `docs/evidence/data-extraction-20261107/` |

## 10. 교육신청 상태 요약 칩·스마트 정렬·카드/목록 보기 전환 (2026-11-07 06:00)

| 구분 | 내용 |
|---|---|
| 목표 | 50~60대 신청자가 접수 상태를 한눈에 파악하고 신청 가능한 강좌를 먼저 보도록 교육신청 화면 개편 |
| 데이터 | `scripts/build_programs_dataset.mjs` — `programs_all.json`의 비종료 47건을 `programs.json`으로 정규화. 접수중 7·접수예정 1·대기접수 7·마감 32 |
| 상태 칩 | `전체·접수중·접수예정·대기접수·마감` 카운터 칩. 터치 시 즉시 필터, 활성 칩 고대비, `aria-pressed`·`role=status` |
| 스마트 정렬 | 접수중(잔여 비율 임박순) → 접수예정(시작일 임박순) → 대기접수 → 마감 순 자동 정렬 |
| 보기 전환 | 카드형(기본, 1/2/3열) ↔ 목록형. PC는 8컬럼 표(상태·분야·강좌명·교육기간·장소·정원(잔여)·수강료·신청), 1024px 미만은 컴팩트 행 카드 |
| 모달 | 카드·목록 양쪽에서 상세 모달 연결. 접수중 수강신청, 대기접수 대기신청, 접수예정·마감 비활성 |
| 검증 | typecheck·lint·build Exit 0, 실서버 HTTP 200·리소스 404 0건, `verify-programs.mjs` 35/35 PASS, `verify-viewports.mjs` 회귀 PASS |
| 증거 | `docs/evidence/programs-20261107/` |

## 11. 스타일 가이드 기반 메인 화면 단일 통합 리팩토링 및 나스 배포 (2026-11-07 06:10)

| 구분 | 내용 |
|---|---|
| 목표 | `docs/STYLE_GUIDE.md`의 고대비 4.5:1(본문 7:1)·18px 본문·48px 이상 터치 영역을 메인 화면과 모달에 일괄 적용 |
| 전역 토큰 | `globals.css`에 강좌 4대 상태 색(`--color-status-open/ready/wait/closed`)과 시니어 타이포 스케일(`--text-xs`~`--text-3xl`) 추가. `html` 18px·`--color-ink` 7:1 유지 |
| 헤더·탭바 | 헤더 72px 고정, 로고 44px. 모바일 하단 탭바 64px·5탭 48×48px 이상·라벨 13px bold. 본문 `pb-20` 유지 |
| 카드 | 곡률 24px·패딩 24px·CTA 56px, 잔여석 고대비(브랜드/적색), 진행 막대 10px. 상태 배지 4색 토큰 정합 |
| 목록 | PC 8컬럼 고대비 표, 1024px 미만 행 카드. 390·412·768·820px 가로 스크롤 0 |
| 모달·폼 | 입력 52px·18px(모바일 자동 확대 차단), 확인/결제 버튼 56px, 중간 톤 회색 본문 제거 |
| 검증 | typecheck·lint·build Exit 0, 실서버 HTTP 200·리소스 404 0건, `verify-style-guide.mjs` 88/88 PASS, `verify-programs.mjs` 35/35, `verify-viewports.mjs` 회귀 PASS |
| 증거 | `docs/evidence/styleguide-20261107/` |

## 12. 수파베이스 서버 사이드 페이징(Range Query)·상태별 카운트 분리 (2026-11-07 13:35)

| 구분 | 내용 |
|---|---|
| 목표 | 667건 전체(267KB 원본)를 한 번에 내려받던 구조를 초기 30건 범위 조회로 바꿔 초기 전송량 90% 이상 절감 |
| 카운트 쿼리 | `src/lib/programs.ts` `fetchProgramCounts()` — `select("id", {count:"exact", head:true})` 5회(전체+4상태)로 본문 없이 건수만 조회. 칩 카운터에 즉시 반영 |
| 페이징 조회 | `fetchProgramPage()` — 선별 컬럼 + `order(status.desc, created_at.desc, id.asc)` + `.range(offset, offset+29)`. 서버 정렬은 페이징 결정성만 보장하고 최종 표시 순서는 `comparePrograms()`로 클라이언트 재정렬 |
| 더보기 | `src/hooks/usePrograms.ts` — 30건씩 증분 페칭·id 중복 제거 후 병합, 총 건수 도달 시 버튼 자동 숨김. 상태 칩 전환 시 1페이지부터 재조회 |
| 폴백 | 수파베이스 카운트/목록 실패 시 로컬 `programs.json` 47건을 같은 30건 페이징 규칙으로 사용 |
| 검증 | typecheck·lint·build Exit 0, NAS 배포 HTTP 200, `verify-programs.mjs` 65/65 PASS. 초기 목록 GET 2,560B(gzip)·11,347B(raw) — 원본 267,043B 대비 95.8% 절감 |
| 증거 | `docs/evidence/programs-paging-20261107/` |

## 13. 상태 정렬 `status_order` 도입·칩 카운트 깜빡임 제거 (2026-11-07 14:46)

| 구분 | 내용 |
|---|---|
| 목표 | 대기접수 7건이 전체 목록 마지막 페이지로 밀리던 문제를 서버 정렬로 해결하고, 초기 칩 카운트 47→667 깜빡임과 [더보기] 카드 중간 삽입을 제거 |
| DB | `public.programs.status_order`(1 접수중·2 접수예정·3 대기접수·4 마감) + `idx_programs_status_order (status_order, id DESC)` 추가·667건 백필 |
| 시드 | `scripts/seed-supabase-programs.mjs`가 `status`에서 `status_order`를 산출해 재적재. 667건 failed 0 |
| 서버 정렬 | `fetchProgramPage()` — `order(status_order.asc, id.desc)`. 첫 30건 = 접수중7·접수예정1·대기접수7·마감15 |
| 클라이언트 | 첫 페이지는 서버 순서 유지, [더보기]는 id 중복 제거 후 끝에 append(재정렬 제거) |
| 깜빡임 | `defaultProgramCounts`(667/7/1/7/652)로 초기 렌더. 정적 HTML `[667]`, `[47]` 없음. 서버 실패 시에만 로컬 카운트로 복귀 |
| Vercel | `vercel.json` — `npm run build`, 출력 `out` (실배포 미검증) |
| 검증 | typecheck·lint·build Exit 0, NAS HTTP 200, `verify-programs.mjs` **68/68 PASS**. 초기 GET gzip 2,900B·원본 12,239B, 더보기 후 기존 30건 순서 불변 |
| 증거 | `docs/evidence/status-order-20261107/`, `docs/evidence/seed-status-order-20261107.log`, `docs/logs/2026 11 07 1446 로그 5060do 상태 정렬 status_order 도입 및 칩 카운트 깜빡임 제거.md` |

## 14. Vercel·NAS 듀얼 basePath·접수중 임박순·5초 타임아웃 가드 (2026-11-07 15:20)

| 구분 | 내용 |
|---|---|
| 목표 | Vercel 루트 배포와 NAS `/5060do` 배포를 한 코드베이스로 지원하고, 첫 페이지 접수중 강좌를 마감 임박순으로 보여주며, 수파베이스 무응답 시 5초 안에 로컬 폴백 |
| basePath | `next.config.ts` — `NEXT_PUBLIC_BASE_PATH ?? (VERCEL ? "" : "/5060do")`, 해석값을 `env`로 클라이언트에 인라인. `src/lib/basePath.ts`의 `withBasePath()`로 로고·클래식 홈·버전 전환 링크 통일 |
| 정렬 | `orderOpenProgramsByImminence()` — 첫 페이지의 접수중 그룹만 잔여 비율 오름차순(동률은 신청 마감일·id). [더보기]는 서버 순서 append 유지 |
| 타임아웃 | `programRequestTimeoutMs = 5000` + `withRequestTimeout()` AbortController. 카운트 5건은 공유 signal, 페이지 조회는 개별 signal |
| Vercel 검증 | `VERCEL=1 npm run build` Exit 0, `out/index.html`에 `/5060do` 0건, 루트 정적 서버에서 `/`·`/classic/`·로고·JS 200 (실배포는 미실시) |
| NAS 검증 | NAS 모드 빌드 Exit 0, 배포 37파일, `/5060do/`·`/classic/`·로고 HTTP 200, `verify-programs.mjs` **70/70 PASS**, 타임아웃 폴백 5,230ms 실측 |
| 증거 | `docs/evidence/dual-basepath-20261107/` |

## 15. Vercel 루트 E2E·접수중 전역 임박순·챗봇 실시간 데이터 연동 (2026-11-07 16:00)

| 항목 | 내용 |
|---|---|
| 목표 | `BASE_PATH` 하나로 NAS `/5060do`와 Vercel 루트("")를 같은 E2E 스크립트로 검증하고, [더보기] 이후에도 접수중 그룹 전체의 잔여석 임박순을 유지하며, 챗봇이 실시간 강좌 건수를 안내하도록 정비 |
| E2E | `scripts/verify-programs.mjs` — `BASE_PATH`/`BASE_ORIGIN` 동적 URL, 내부 링크 BASE_PATH 일관성·버전 전환 링크 검증, 전체 접수중 임박순(전역)·챗봇 실시간 건수 검증 추가 (77개 항목) |
| 원클릭 검증 | `scripts/test-vercel.mjs` — `VERCEL=1`·`NEXT_PUBLIC_BASE_PATH=""` 빌드 후 3102 포트 정적 서빙, `BASE_PATH=""` E2E 자동 실행. `npm run test:vercel`/`verify:vercel` 등록 (cross-env 없이 Node 로 직접 빌드) |
| 정렬 | `mergeProgramPage()` — [더보기] 유입분에 접수중이 있으면 기존 접수중 그룹과 합쳐 잔여 비율 오름차순 재정렬, 접수예정·대기접수·마감 그룹 순서는 보존 |
| 챗봇 | `ChatbotWidget`이 `overview`(전체 첫 페이지)와 `counts`(실시간 667/7/1/7/652)를 props로 받아 무료 강좌·접수중 건수를 실시간 데이터로 안내. 47건 더미 카운트 제거 |
| 검증 | typecheck Exit 0, lint Exit 0, NAS build Exit 0, Vercel 루트 build Exit 0(`/5060do` 누출 0), NAS E2E **77/77 PASS**, Vercel 루트 E2E **77/77 PASS**, 챗봇 접수중 7건 일치 |
| 배포 | `deploy_www.sh` → `/volume3/www/5060do` 37개 파일, `/5060do/`·`/5060do/classic/` HTTP 200 |
| 증거 | `docs/evidence/vercel-e2e-20261107/`, `docs/evidence/nas-e2e-20261107/` |
| 한계 | 실제 Vercel 클라우드 배포는 하지 않았다. 접수중 7건이 모두 첫 페이지에 있어 페이지 경계를 넘는 재정렬은 현재 데이터로 직접 발생하지 않는다 |

## 16. 센터 지식 documents 적재·챗봇 활성강좌 전용 조회·Vercel 배포 가이드 (2026-11-07 18:10)

| 항목 | 내용 |
|---|---|
| 목표 | 센터 안내 지식을 수파베이스 `public.documents`에 적재하고, 챗봇이 첫 페이지 30건과 무관하게 활성 강좌 전체를 근거로 답하며, 접수중 30건 초과 시 전역 임박순을 단위 테스트로 고정하고, Vercel 실배포 절차를 문서로 확정 |
| 지식 적재 | `scripts/seed-supabase-knowledge.mjs` — `center_knowledge.json` 14개 항목 중 텍스트 있는 6개를 평탄화해 `documents(id, title, category, content)`에 upsert. 빈 청크 8개 제외, `npm run data:knowledge` 등록 |
| 챗봇 조회 | `fetchActivePrograms()` — `status_order < 4`(접수중·접수예정·대기접수) 전용 경량 컬럼 1회 조회(`range 0..999`). 챗봇을 열 때 지연 조회해 첫 페이지 15KB 예산을 유지. `freeCourseReply()`는 활성 강좌 전체에서 무료 강좌 추출, `applyReply()`는 활성 강좌의 접수중 건수 사용 |
| 단위 검증 | `tests/unit-merge-programs.mjs` — Node 내장 `assert`(외부 패키지 없음). 40건 접수중(1페이지 30 + 2페이지 10) 병합 후 잔여석 비율 0.0→1.0 오름차순, id 중복 없음, 마감 그룹 순서 보존. `npm run test:unit` 등록 |
| 배포 문서 | `docs/VERCEL_DEPLOY_GUIDE.md` — Vercel 대시보드·GitHub 미러·CLI 3경로, 필수 환경변수 3종(`NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`NEXT_PUBLIC_BASE_PATH=""`), 빌드/출력 디렉터리, 7단계 확인 체크리스트 |
| 적재 검증 | `node scripts/seed-supabase-knowledge.mjs` — 6건 upsert, `documents` count 6/6 일치, 내용 길이 일치, 인사말·층별안내·위치/주차·대관 키워드 4종 PASS |
| 검증 | typecheck Exit 0, lint Exit 0, unit PASS(40건), NAS build Exit 0, Vercel 루트 build Exit 0(`/5060do` 누출 0), NAS E2E **77/77 PASS**, Vercel 루트 E2E **77/77 PASS**, 활성 강좌 15건(7/1/7)·무료 2건 조회 확인 |
| 배포 | `deploy_www.sh` → `/volume3/www/5060do` 37개 파일, `/5060do/`·`/5060do/classic/` HTTP 200 |
| 증거 | `docs/evidence/knowledge-chatbot-20261107/`, `docs/evidence/knowledge-seed-20261107T091521/` |
| 한계 | 실제 Vercel 클라우드 배포는 토큰·GitHub 원격이 없어 실행하지 않았다. 활성 강좌 15건으로 30건 초과 상황은 단위 테스트로만 검증했다 |

## 17. 센터 지식 14종 완결·챗봇 지식 질의 확장·GitHub 미러 동기화 (2026-11-07 22:35)

| 항목 | 내용 |
|---|---|
| 목표 | 이미지로만 제공되던 센터 안내 8종을 공식 텍스트로 보완해 지식 14종을 전량 완결하고, 챗봇이 연혁·조직·공유사무실·커뮤니티·생애설계를 1:1로 안내하며, GitHub 미러 푸시를 한 명령으로 수행 |
| 지식 보완 | `src/data/center_knowledge.json` — 연혁, 조직도, 생애설계진단/상담, 인생설계, 일·활동, 커뮤니티지원, 커뮤니티 참여방법, 공유사무실 참여방법 8종에 구조화 청크 작성. `note`(이미지라 추출 불가) 필드 제거, 14개 전 항목 텍스트 확보 |
| 적재 | `scripts/seed-supabase-knowledge.mjs` — 14건 전량을 `documents(id, title, category, content)`로 업서트. 키워드 검증 8종(연혁·조직도·생애설계·일활동·공유사무실·대관·층별안내·오시는길) 전수 확인 |
| 챗봇 확장 | `src/components/ChatbotWidget.tsx` — 연혁(2023년 개관), 조직(센터장·운영팀·교육기획팀·일자리지원팀), 공유사무실(5층·입주 대상·신청 절차), 커뮤니티(동아리 등록·공간 지원), 생애설계(7대 영역 진단·1:1 상담) 핸들러 추가. 퀵 질문을 `무료 강좌·수강신청·주차/위치·시설/공유사무실·상담원 전화` 5종으로 정리 |
| 안전 가드 | `src/lib/programs.ts` — `activeProgramsFetchLimit = 1000`. 조회 결과가 1,000건에 도달하면 `[WARN] Active programs reached 1000 limit` 경고 후 1,000건으로 슬라이스. **운영 정책: 활성 강좌가 500건을 초과하면 `fetchActivePrograms()`를 Range Loop Paging으로 전환한다** (1회 1,000건 상한 유지, 페이지 루프로 전량 수집) |
| GitHub 미러 | `scripts/sync-github.mjs` + `npm run push:github` — `github` 원격이 있으면 `git push github master`, 없으면 `git remote add` 안내 후 무해 종료(Exit 0). Gitea `origin`은 건드리지 않음 |
| E2E | `scripts/verify-programs.mjs` — 챗봇 무료 텍스트 질의 3종(연혁·조직도·커뮤니티) 추가, 총 **80개 항목** |
| 검증 | typecheck Exit 0, lint Exit 0, unit PASS, build Exit 0, 시드 14/14 PASS, NAS E2E 80/80 PASS, 게이트웨이 `/5060do/` HTTP 200 |
| 증거 | `docs/evidence/knowledge-complete-20261107/` |

## 18. GitHub 동기화 안전 가드·Vercel 실배포 검증·센터 지식 RAG 임베딩 (2026-11-08 02:00)

| 항목 | 내용 |
|---|---|
| 목표 | UNC 작업 경로에서도 GitHub 미러 동기화가 끊기지 않게 하고, Vercel 루트 배포를 기계 검증하며, 센터 지식 14종을 768차원 pgvector 임베딩으로 적재해 키워드 없는 자연어 질의에 답한다 |
| 동기화 가드 | `scripts/sync-github.mjs` — 현재 위치가 `\\x4\...`(UNC)면 같은 트리의 드라이브 문자(`Z:\dev\5060do`)로 `process.chdir` 후 실행. `GIT_TERMINAL_PROMPT=0`·`GCM_INTERACTIVE=never` 유지 |
| 배포 검증 | `scripts/verify-vercel-live.mjs` — 인자/`VERCEL_LIVE_URL`의 배포 URL 또는 로컬 프리뷰를 대상으로 `/`·`/classic/` 200, 내부 `/5060do` 누출 0건, 수파베이스 실시간 강좌 바인딩, 클래식 헤더·GNB 8개, 콘솔 오류 0건을 검사(14항목) |
| 임베딩 | `src/lib/embedding.ts` — 14건 코퍼스에서 만든 768차원 고정 어휘 + IDF 가중, 한국어 조사·어미 제거, 동의어 개념 토큰. 외부 임베딩 API 없이 시드와 브라우저가 동일 벡터를 계산 |
| pgvector | `docs/sql/setup_pgvector.sql` — `documents.embedding vector(768)`, HNSW 인덱스, `match_documents()` RPC. `scripts/seed-embeddings.mjs`(`npm run data:embeddings`)가 14건을 적재하고 코사인 재계산 일치·자연어 질의 16건을 검증 |
| 챗봇 연결 | `src/lib/rag.ts` `searchKnowledgeRAG()` 상위 3건, `ChatbotWidget.tsx`가 키워드 규칙 미매칭 질문을 벡터 검색으로 안내. 점수 0.10 미만은 무응답 처리 |
| 검증 | typecheck Exit 0, lint Exit 0, build Exit 0, Vercel 루트 E2E **80/80 PASS**, 실배포 검증 **14/14 PASS**(로컬 프리뷰), 임베딩 **14/14·질의 16/16 PASS**, 챗봇 RAG 실화면 확인 |
| 증거 | `docs/evidence/rag-20261108/`, `docs/evidence/rag-embeddings-20261107T170228/`, `docs/evidence/vercel-live-20261107T170856/` |

## 19. 채용정보 2,034건 수파베이스 적재·화면 연동·RAG 동의어 사전 보강 (2026-11-08 05:05)

| 항목 | 내용 |
|---|---|
| 목표 | 게시판 2,034건을 수파베이스 `jobs`에 적재하고 메인 채용정보 섹션을 실데이터로 바꾸며, 신중년 FAQ 어휘를 RAG 동의어 사전에 추가한다 |
| 스키마 | `docs/sql/setup_jobs.sql` — `public.jobs(id bigint PK, board_type, title, date, company, author, content, region, source_url)`, 날짜·직종·지역 인덱스, RLS 공개 읽기, anon/authenticated SELECT |
| DDL 적용 | REST로는 불가해 NAS `postgres-common` psql → pooler(`aws-0-ap-northeast-2.pooler.supabase.com`) 경로로 1회 적용(2026-11-08) |
| 적재 | `scripts/seed-supabase-jobs.mjs`(`npm run data:jobs`) — 100건 배치 upsert, 21배치, 총 2,034건·부산 2,011·기타 23 검증 |
| 지역 판정 | `deriveJobRegion()` — 부산/부산 구 명시 또는 무표기면 부산, 다른 시·도 명시면 기타. 시드와 화면이 같은 함수를 쓴다 |
| 화면 | `src/lib/jobs.ts` + `src/hooks/useJobs.ts` + `page.tsx` — 직종 칩, 지역 칩, 제목·내용 검색, 12건 페이징, 상세 모달·원문 링크. 5초 타임아웃 후 로컬 JSON 지연 청크로 폴백 |
| RAG 사전 | `src/lib/embedding.ts` — 일자리(구직·알바·시니어클럽·사회공헌), 프로그램안내/인생설계(자격증·배움터·수강·강의), 커뮤니티지원(동아리방·모임장소), 공유사무실(회의실) 추가. 모델 `5060do-vocab-768-v4` |
| 임베딩 검증 | `npm run data:embeddings` — 14/14 재적재, 코사인 일치, 자연어 질의 **23/23 PASS** |
| 배포 검증 | `scripts/verify-vercel-live.mjs` — 채용정보 실데이터 바인딩·지역/직종 필터·상세 모달 검사 추가, **21/21 PASS** |
| 검증 | typecheck Exit 0, lint Exit 0, build Exit 0, `node scripts/test-vercel.mjs` **80/80 PASS**, 합계 2,034건 일치 |
| 증거 | `docs/evidence/jobs-seed-20261107T201327/`, `docs/evidence/rag-embeddings-20261107T201335/`, `docs/evidence/vercel-live-20261107T201852/`, `docs/evidence/jobs-20261108-*.log` |




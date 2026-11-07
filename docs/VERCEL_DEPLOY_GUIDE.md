# 5060do Vercel 배포 가이드

> 대상: `Z:\dev\5060do` / `main` 브랜치(`master`) / 정적 내보내기(`output: "export"`)
> NAS 운영 주소: `http://100.83.116.15:8780/5060do/`
> Vercel 운영 주소: 프로젝트 루트(`https://<project>.vercel.app/`)

이 문서는 Vercel 클라우드에 5060do를 배포하는 두 가지 경로(대시보드 + GitHub 연동, Vercel CLI)를 정리한다.
로컬 빌드·서빙·E2E 재현은 `node scripts/test-vercel.mjs`(= `npm run test:vercel`)로 이미 자동화되어 있다.

---

## 1. 사전 준비

| 항목 | 값 | 비고 |
|---|---|---|
| Node.js | 24 LTS 이상 | Vercel 기본 런타임과 동일 계열 |
| 패키지 매니저 | `npm` | `package-lock.json` 기준 `npm install` |
| 저장소 루트 | `Z:\dev\5060do` | `vercel.json`, `package.json`이 있는 위치 |
| Gitea 원격 | `origin` → `http://100.83.116.15:3300/Jason/5060do.git` | 내부 원격(현재 설정) |

## 2. Vercel 프로젝트 설정값

`vercel.json`이 이미 아래 값을 고정하고 있으므로 대시보드에서 바꾸지 않는다.

| 항목 | 값 |
|---|---|
| Framework Preset | `Other` (`framework: null`) |
| Root Directory | 저장소 루트(`./`) |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `out` |
| Trailing Slash | `true` (`trailingSlash: true`) |

`npm run build`는 `next build` 뒤에 `node scripts/postbuild-static-rsc.mjs`를 실행해 정적 RSC 페이로드 404를 제거한다. Vercel에서도 동일하게 동작한다.

## 3. 환경변수 (필수 3종)

Vercel 대시보드 → Project → Settings → Environment Variables에 아래 3개를 등록한다.
Production / Preview / Development 모두 동일값으로 둔다.

| 변수 | 값 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 수파베이스 REST 주소. 비밀값 아님(클라이언트 공개값) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | 공개 조회용 키. `service_role` 키는 **절대 넣지 않는다** |
| `NEXT_PUBLIC_BASE_PATH` | 빈 문자열(`""`) | Vercel은 루트 서빙이므로 basePath를 비운다 |

주의 사항:

1. `NEXT_PUBLIC_BASE_PATH`를 비우면 `next.config.ts`가 `process.env.VERCEL`을 보고 자동으로 루트(`""`)를 선택한다. 명시적으로 빈 값을 넣어 두면 NAS 빌드(`/5060do`)와 섞이지 않는다.
2. `SUPABASE_SERVICE_ROLE_KEY`는 Vercel 환경변수에 넣지 않는다. 시드 스크립트는 로컬/NAS에서만 실행한다.
3. 환경변수를 바꾼 뒤에는 반드시 Redeploy를 1회 실행한다(빌드 타임에 번들로 인라인됨).

## 4. 경로 A — 대시보드 + GitHub 연동

1. GitHub에 빈 저장소를 만든다(예: `Jason/5060do`).
2. 로컬에서 GitHub 미러 원격을 추가하고 `master`를 1회 푸시한다.

```bash
git remote add github https://github.com/<계정>/5060do.git
git push github master
```

3. Vercel 대시보드 → **Add New → Project → Import Git Repository**에서 해당 저장소를 선택한다.
4. Framework Preset `Other`, Root Directory `./`, Build Command `npm run build`, Output Directory `out`을 확인한다.
5. 환경변수 3종을 등록한다.
6. **Deploy**를 누르고 빌드 로그에서 아래를 확인한다.
   - `next build` 완료 후 `scripts/postbuild-static-rsc.mjs` 실행 로그
   - `out/index.html` 생성
   - `NEXT_PUBLIC_BASE_PATH`가 빈 값이므로 HTML에 `/5060do` 경로가 없어야 한다.
7. 배포된 루트 URL에서 아래를 확인한다.
   - `/` HTTP 200
   - `/classic/` HTTP 200
   - 강좌 목록 첫 페이지 30건 + 상태 칩 5개
   - 챗봇 무료 강좌 답변에 `전체 667개 강좌 중 접수중 7개` 표시

GitHub 연동이 끝나면 이후 `git push github master`만으로 자동 배포된다.

## 5. 경로 B — Vercel CLI

로컬에서 즉시 배포할 때 사용한다. 토큰은 저장소에 커밋하지 않는다.

```bash
npm install -g vercel
vercel login
vercel link            # 프로젝트 연결 (최초 1회)
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add NEXT_PUBLIC_BASE_PATH   # 빈 값 입력
vercel --prod
```

- `vercel link`에서 Framework는 `Other`, Output Directory는 `out`으로 지정한다.
- `vercel --prod`는 `vercel.json`의 `buildCommand`/`outputDirectory`를 그대로 사용한다.
- 배포 후 출력되는 Production URL을 기록한다.

## 6. 배포 확인 체크리스트

| 순서 | 확인 | 판정 기준 |
|---|---|---|
| 1 | 빌드 로그 | Exit 0, `postbuild-static-rsc` 실행됨 |
| 2 | `/` | HTTP 200 |
| 3 | `/classic/` | HTTP 200, 버전 전환 링크가 `/classic/` |
| 4 | `/5060do` 누출 | HTML에 `/5060do` 문자열 0건 |
| 5 | 강좌 목록 | 첫 페이지 30건, 칩 `[667] [7] [1] [7] [652]` |
| 6 | 챗봇 | 무료 답변 `접수중 7개`, 신청 답변 `접수 중인 강좌는 7개` |
| 7 | 콘솔 오류 | Supabase 요청 실패 로그 0건 |

로컬에서 같은 체크리스트를 미리 돌리는 명령:

```bash
node scripts/test-vercel.mjs
```

이 스크립트는 `VERCEL=1`, `NEXT_PUBLIC_BASE_PATH=""`로 빌드하고 3102 포트에 정적 서빙한 뒤
`BASE_PATH=""` 기준 E2E(`scripts/verify-programs.mjs`, 80개 항목)를 자동 실행한다.

실제 배포 도메인(또는 로컬 프리뷰)을 대상으로 라우트·경로 누출·브라우저 바인딩·콘솔 오류까지
한 번에 확인하려면 아래 명령을 쓴다.

```bash
node scripts/verify-vercel-live.mjs https://<project>.vercel.app/
node scripts/verify-vercel-live.mjs            # 배포 전 로컬 프리뷰 검증
```

검증 항목은 `/`·`/classic/` HTTP 200, 내부 `/5060do` 경로 누출 0건, 수파베이스 실시간 강좌
바인딩과 카드 렌더링, 클래식 헤더·GNB 8개, 콘솔 오류 0건이다. 결과는
`docs/evidence/vercel-live-<시각>/vercel-live-verification.json`에 저장된다.

## 7. NAS 배포와의 차이

| 구분 | NAS | Vercel |
|---|---|---|
| 서빙 경로 | `/5060do/` | `/` |
| basePath | `/5060do` | `""` |
| 배포 명령 | `deploy_www.sh /volume1/workspace/dev/5060do/out 5060do` | `vercel --prod` 또는 GitHub push |
| 빌드 환경변수 | 기본값(미설정) | `NEXT_PUBLIC_BASE_PATH=""` |
| 확인 URL | `http://100.83.116.15:8780/5060do/` | Production URL |

두 경로 모두 `next.config.ts`의 동적 basePath 하나로 갈라지므로, 빌드 산출물을 서로 덮어쓰지 않도록
NAS 배포는 NAS에서, Vercel 배포는 Vercel에서 빌드한다.

## 8. 문제 해결

| 증상 | 원인 | 조치 |
|---|---|---|
| 자산 404 | basePath가 `/5060do`로 빌드됨 | `NEXT_PUBLIC_BASE_PATH=""` 등록 후 Redeploy |
| `/classic/` 404 | Output Directory 미설정 | 대시보드 Output Directory를 `out`으로 |
| RSC 페이로드 404 | `postbuild-static-rsc.mjs` 미실행 | Build Command를 `npm run build`로 |
| 강좌 목록이 더미 15건 | Supabase 환경변수 누락 | 3종 재확인 후 Redeploy |
| 챗봇이 667건 대신 47건 | 로컬 폴백 사용 | 브라우저 콘솔의 `[supabase]` 경고 확인 |

## 9. 센터 지식 RAG 검색

`public.documents` 14건은 768차원 임베딩을 `embedding` 컬럼(pgvector)에 저장한다.
챗봇은 키워드 규칙에 걸리지 않는 질문을 `searchKnowledgeRAG()`로 보내 상위 3건을 안내한다.

| 항목 | 내용 |
|---|---|
| 스키마 | `docs/sql/setup_pgvector.sql`(`vector(768)`, HNSW 인덱스, `match_documents` RPC) |
| 임베딩 모델 | `5060do-vocab-768-v3` — 14건 코퍼스에서 만든 768차원 고정 어휘 + IDF 가중 |
| 적재 | `npm run data:embeddings` (로컬/NAS 전용, service role 키 사용) |
| 검증 | 시드 스크립트가 저장 벡터 재계산 일치(코사인 0.9999 초과)와 자연어 질의 16건을 확인 |

임베딩은 외부 API 없이 문서 텍스트에서 결정적으로 계산한다. 정적 내보내기에는 API 키를
숨길 서버가 없고, 시드 스크립트와 브라우저가 같은 함수를 쓰므로 어느 쪽에서 만든 벡터도
같은 공간에 놓인다.

---
title: 5060do Vercel 실배포 검증·GitHub 동기화 가드·센터 지식 RAG 임베딩
project: 5060do
date: 2026-11-08 02:00
ticket: 5060DO-20261108-0145
pc: white
model: deepseek-v4.1-flash
status: done
---

# 5060do Vercel 실배포 검증·GitHub 동기화 가드·센터 지식 RAG 임베딩

## 1. 목표

- UNC 작업 경로에서도 `npm run push:github`가 드라이브 문자 기준으로 안전하게 실행되게 보완
- Vercel 루트 배포(또는 로컬 프리뷰)를 라우트·경로 누출·브라우저 바인딩·콘솔 오류까지 기계 검증
- 수파베이스 `public.documents` 14건을 768차원 pgvector 임베딩으로 적재하고, 키워드 일치 없이
  자연어 질문에 답하는 RAG 검색을 챗봇에 연결

## 2. 수행 내용

| 대상 | 내용 |
|---|---|
| GitHub 동기화 | `scripts/sync-github.mjs` — 현재 위치가 UNC(`\\x4\...`)면 같은 트리의 드라이브 문자 경로(`Z:\dev\5060do`)로 전환 후 git 실행. 스크립트 위치 기준 대체 경로도 시도 |
| Vercel 실배포 검증 | `scripts/verify-vercel-live.mjs` 신규 — 배포 URL 인자/`VERCEL_LIVE_URL` 또는 로컬 프리뷰 대상. HTTP 200, 내부 `/5060do` 누출, 수파베이스 실시간 데이터 바인딩, 클래식 GNB, 콘솔 오류 검사 |
| 임베딩 모델 | `src/lib/embedding.ts` 신규 — 14건 코퍼스의 768차원 고정 어휘, IDF 가중, 한국어 조사·어미 제거, 동의어 개념 토큰. 시드 스크립트와 브라우저가 같은 함수를 사용 |
| pgvector 스키마 | `docs/sql/setup_pgvector.sql` 신규 — `documents.embedding vector(768)`, HNSW 인덱스, `match_documents()` RPC(코사인 유사도) |
| 임베딩 적재 | `scripts/seed-embeddings.mjs` 신규(`npm run data:embeddings`) — 14건 PATCH, 저장 벡터 재계산 일치, 자연어 질의 16건 회귀 확인 |
| RAG 검색 | `src/lib/rag.ts` 신규 — `searchKnowledgeRAG()` 상위 3건(기본 점수 0.10 이상). `NEXT_PUBLIC_RAG_SOURCE=supabase`일 때 DB 벡터 사용, 기본은 번들 벡터 |
| 챗봇 연결 | `src/components/ChatbotWidget.tsx` — 키워드 규칙에 걸리지 않는 질문을 RAG로 보내 `[제목] 본문 요약 + 관련 안내 링크`로 답변 |

## 3. 검증 결과

| 항목 | 명령 | 결과 |
|---|---|---|
| 타입 검사 | `npm run typecheck` | PASS (Exit 0) |
| 린트 | `npm run lint` | PASS (Exit 0) |
| 빌드 | `npm run build` | PASS (Exit 0, 5개 정적 페이지) |
| Vercel 루트 E2E | `node scripts/test-vercel.mjs` | PASS (80/80) |
| Vercel 실배포 검증 | `node scripts/verify-vercel-live.mjs --no-build` | PASS (14/14, 로컬 프리뷰) |
| 임베딩 적재 | `npm run data:embeddings` | PASS (14/14, wrongDim 0, 일치 14/14) |
| 자연어 질의 | 시드 스크립트 내장 16건 | PASS (13건 정답 + 무관 질의 3건 무응답) |
| 챗봇 RAG 실화면 | 로컬 프리뷰 CDP | PASS (`[연혁] ... 2023년 개관`, 무관 질의는 안내 문구) |

핵심 측정값:

- 루트 E2E: `{"basePath":"","buildExit":0,"verifyExit":0,"rootLeak":false,"probes":{"/":200,"/classic/":200}}`
- 실배포 검증: `/`·`/classic/` 200, 내부 `/5060do` 0건, 실시간 소스 `supabase`, 콘솔 오류 0건
- 임베딩: 어휘 580/768, `차를 어디에 세워요? → 오시는 길(0.3841)`,
  `센터는 언제 문을 열었나요? → 연혁(0.36)`, `헬스장 있나요? → 무응답`

## 4. 증거

- `docs/evidence/rag-20261108/` — typecheck·lint·build·E2E·실배포 로그, 챗봇 RAG 화면/JSON
- `docs/evidence/rag-embeddings-20261107T170228/embedding-report.json` — 14건 벡터·질의 16건 상세
- `docs/evidence/vercel-live-20261107T170856/vercel-live-verification.json` — 14항목 검사 결과
- `docs/evidence/vercel-e2e-20261107/` — 80/80 E2E 산출물 갱신

## 5. 남은 위험

- Vercel 프로젝트는 아직 Import 되지 않아 원격 도메인 실배포 검증은 로컬 프리뷰로 대체했다.
  Import 후 `node scripts/verify-vercel-live.mjs https://<project>.vercel.app/`로 동일 검사를 실행하면 된다.
- 임베딩은 외부 임베딩 API가 아닌 코퍼스 기반 결정적 벡터다. 어휘에 없는 신조어·타 도메인 질문은
  무응답으로 떨어지며, 이는 잘못된 답변보다 안전한 동작으로 설계했다.
- `match_documents()` RPC는 SQL 파일로만 제공된다. 실DB 반영은 Supabase SQL 에디터에서 1회 실행해야 한다.
- `documents.embedding` 컬럼은 이미 `vector(768)`로 존재해 시드는 REST로 성공했지만, 새 프로젝트에서는
  SQL 파일을 먼저 실행해야 한다.

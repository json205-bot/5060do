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

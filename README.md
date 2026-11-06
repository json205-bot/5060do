This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 5060do 반응형 웹 프로토타입

오륙도인생후반전지원센터 수강신청 흐름을 로컬에서 검증하는 프로토타입입니다.

```bash
npm install
npm run dev      # http://localhost:3000
npm run typecheck
npm run build
```

### 구성

| 경로 | 설명 |
|---|---|
| `src/app/page.tsx` | 헤더·카드 그리드·상세 모달·신청 폼·가상 결제 |
| `src/data/programs.json` | 크롤링 아카이브 기반 목업 강좌 데이터 |
| `scripts/verify-viewports.mjs` | 390/768/1280 뷰포트 및 신청 흐름 자동 검증 |
| `docs/PLAN.md` | 목표·구현·검증 기준 |
| `docs/evidence/` | 검증 결과 JSON, 스크린샷 |

`assets/`(센터 홈페이지 크롤링 아카이브)는 용량 문제로 git에서 제외되어 있습니다.

## Getting Started (Next.js)

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) — currently a system font stack for Korean text.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

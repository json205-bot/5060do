# 5060do 시니어 친화적 웹/앱 스타일 가이드 (Style Guide)

본 문서는 오륙도인생후반전지원센터(5060do)의 50~60대 신중년층 대상 웹 및 하이브리드 앱 구축을 위한 공식 디자인·퍼블리싱 표준 규격서입니다.

---

## 1. 3대 핵심 원칙 (Core Principles)

1. **고대비 보장 (High Contrast)**: 텍스트와 배경 간 명도비 4.5:1 이상(본문 7:1 권장)을 엄격히 준수하여 야외 및 노안 환경에서도 선명한 가독성 확보.
2. **대형 타이포그래피 (Large Typography)**: 기본 본문 폰트 18px(최소 16px, 1.0rem), 최소 캡션 14px 하한선을 강제하여 브라우저 강제 확대 없이도 편안하게 읽힘.
3. **대형 터치 영역 (Generous Touch Target)**: 모든 대화형 요소(버튼, 탭, 링크)의 터치 영역을 최소 48×48px 이상(권장 52~56px)으로 확보하고 버튼 간 12px 이상 간격을 두어 오터치 방지.

---

## 2. 색상 체계 (Color System)

Tailwind CSS v4 `@theme` 토큰 기반으로 정의된 색상 팔레트입니다.

### 2-1. 브랜드 및 공통 색상
| 토큰명 | CSS 변수 | HEX 코드 | 설명 및 용도 |
| :--- | :--- | :--- | :--- |
| `brand-800` | `--color-brand-800` | `#123f36` | 기관 주 색상 (헤더, 대제목, 주요 섹션 배경) |
| `brand-700` | `--color-brand-700` | `#175043` | 주 액션 색상 (확인 버튼, 활성 탭 인디케이터) |
| `brand-50` | `--color-brand-50` | `#eef6f4` | 소프트 배경 틴트 (카테고리 배지 배경, 하이라이트 박스) |
| `accent-500` | `--color-accent-500` | `#f0a72e` | 강조 오렌지 (수강신청 CTA 버튼, 핵심 알림) |
| `accent-600` | `--color-accent-600` | `#d98c12` | 강조 오렌지 호버 상태 |
| `canvas` | `--color-canvas` | `#f6f4ef` | 소프트 웜 미색 배경 (눈부심 방지) |
| `ink` | `--color-ink` | `#16232e` | 딥 차콜 본문 글자색 (명도비 7:1 이상) |

### 2-2. 강좌 4대 상태 색상
| 상태 | 토큰명 | HEX 코드 | 배지 및 시각화 용도 |
| :--- | :--- | :--- | :--- |
| **접수중** | `emerald-600` / `emerald-100` | `#059669` / `#d1fae5` | 즉시 수강신청 가능 강좌 (녹색) |
| **접수예정** | `sky-600` / `sky-100` | `#0284c7` / `#e0f2fe` | 오픈 대기 강좌 (파란색) |
| **대기접수** | `amber-600` / `amber-100` | `#d97706` / `#fef3c7` | 정원 초과 대기자 접수 강좌 (주황색) |
| **마감** | `slate-500` / `slate-200` | `#64748b` / `#e2e8f0` | 정원 마감 및 종료 강좌 (회색) |

---

## 3. 타이포그래피 (Typography)

- **기본 글꼴**: `Pretendard Variable`, `Pretendard`, `Noto Sans KR`, system-ui, sans-serif
- **기본 루트 크기**: `html { font-size: 18px; }`

| 단계 | 크기 | Tailwind 클래스 | Weight | 행간 (Line-height) | 적용처 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **H1** | 32px (1.78rem) | `text-3xl` | Bold (700) | 1.3 | 메인 히어로 헤드라인 |
| **H2** | 24px (1.33rem) | `text-2xl` | Bold (700) | 1.4 | 섹션 타이틀, 상세 모달 제목 |
| **H3** | 20px (1.11rem) | `text-xl` | Bold (700) | 1.4 | 강좌 카드명, 탭바 제목 |
| **Body L** | 18px (1.00rem) | `text-base` | Medium (500) | 1.6 | 본문 설명, 강좌 상세 요약 |
| **Body M** | 16px (0.89rem) | `text-sm` | SemiBold (600) | 1.55 | 폼 라벨, 목록 행 텍스트 |
| **Caption** | 14px (0.78rem) | `text-xs` | Bold (700) | 1.5 | 배지, 날짜 태그 (최소 하한선) |

---

## 4. 컴포넌트 규격 (Component Specs)

### 4-1. 버튼 (Button)
- **Primary 대형 버튼**: 최소 높이 `56px` (`h-14`), 패딩 `px-6`, 폰트 `18px font-bold`, 곡률 `rounded-2xl`.
- **Secondary 보조 버튼**: 최소 높이 `48px` (`h-12`), 패딩 `px-4`, 폰트 `16px font-semibold`, 곡률 `rounded-xl`.
- **터치 보장**: 모든 클릭 타깃은 마진 포함 최소 `48×48px` 이상 영역 확보.

### 4-2. 입력 폼 (Input Form)
- **인풋 필드**: 높이 `52px` (`h-13`), 패딩 `px-4`, 폰트 `18px`, 테두리 `border-2 border-slate-300 focus:border-brand-600`.
- 모바일 가상 키보드 호출 시 화면 자동 확대(Zoom-in)를 방지하기 위해 `font-size: 16px` 이상 필수 유지.

### 4-3. 모바일 하단 5대 탭바 (Bottom Nav)
- 화면 하단 고정: `fixed bottom-0 left-0 right-0 z-40 h-16 bg-white border-t border-slate-200 md:hidden`.
- 탭 아이콘 규격: `size-6` (24px), 탭 라벨 폰트 `12~13px font-bold`.
- 본문 하단 패딩: 탭바에 내용이 가려지지 않도록 `pb-20 md:pb-0` 확보.

### 4-4. 카드 컨테이너 (Card)
- 패딩 `p-5 sm:p-6`, 곡률 `rounded-3xl`, 테두리 `border border-slate-200 bg-white shadow-sm`.
- 호버 인터랙션: `hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md transition`.

---

## 5. Tailwind CSS v4 테마 설정 파일 (`src/app/globals.css`)

```css
@import "tailwindcss";

@theme {
  /* 브랜드 팔레트 */
  --color-brand-50: #eef6f4;
  --color-brand-100: #d6e9e4;
  --color-brand-200: #aed3c9;
  --color-brand-300: #7ab6a7;
  --color-brand-400: #4a9684;
  --color-brand-500: #2f7d6b;
  --color-brand-600: #1f6455;
  --color-brand-700: #175043;
  --color-brand-800: #123f36;
  --color-brand-900: #0d2f28;

  /* 강조 색상 */
  --color-accent-100: #fdf1d9;
  --color-accent-500: #f0a72e;
  --color-accent-600: #d98c12;

  /* 캔버스 및 텍스트 */
  --color-canvas: #f6f4ef;
  --color-ink: #16232e;

  /* 상태 색상 */
  --color-status-open: #059669;
  --color-status-ready: #0284c7;
  --color-status-wait: #d97706;
  --color-status-closed: #64748b;

  /* 시니어 타이포그래피 스케일 */
  --text-xs: 0.78rem;
  --text-xs--line-height: 1.5;
  --text-sm: 0.89rem;
  --text-sm--line-height: 1.55;
  --text-base: 1rem;
  --text-base--line-height: 1.6;
  --text-xl: 1.11rem;
  --text-xl--line-height: 1.4;
  --text-2xl: 1.33rem;
  --text-2xl--line-height: 1.4;
  --text-3xl: 1.78rem;
  --text-3xl--line-height: 1.3;
}
```

export type ClassicNavLink = {
  label: string;
  href: string;
};

export type ClassicNavGroup = {
  label: string;
  href: string;
  description: string;
  children: ClassicNavLink[];
};

const ORIGIN = "https://www.5060do.or.kr";

// Six top-level menus restored from the official portal IA. Sub-links still
// point at the original pages so nothing has to be rebuilt in this phase.
export const classicNav: ClassicNavGroup[] = [
  {
    label: "센터소개",
    href: `${ORIGIN}/subLifeTwist/vision`,
    description: "기관 정체성과 운영 체계 안내",
    children: [
      { label: "인사말", href: `${ORIGIN}/subLifeTwist/greeting` },
      { label: "연혁", href: `${ORIGIN}/subLifeTwist/history` },
      { label: "비전/미션", href: `${ORIGIN}/subLifeTwist/vision` },
      { label: "운영법인", href: `${ORIGIN}/subLifeTwist/corporate` },
      { label: "조직도", href: `${ORIGIN}/subLifeTwist/organization` },
      { label: "오시는 길", href: `${ORIGIN}/subLifeTwist/location` },
    ],
  },
  {
    label: "생애설계",
    href: `${ORIGIN}/subLifeTwist/lifePlanAssay`,
    description: "생애설계진단부터 일·활동까지",
    children: [
      { label: "생애설계진단/상담", href: `${ORIGIN}/subLifeTwist/lifePlanAssay` },
      { label: "인생설계", href: `${ORIGIN}/subLifeTwist/lifeTimePlan` },
      { label: "일·활동", href: `${ORIGIN}/subLifeTwist/lifeTaskDo` },
      { label: "커뮤니티지원", href: `${ORIGIN}/subLifeTwist/lifeSocalhelp` },
    ],
  },
  {
    label: "교육/강좌",
    href: `${ORIGIN}/education/lifeEduList`,
    description: "프로그램 신청과 추천 강좌",
    children: [
      { label: "프로그램신청", href: `${ORIGIN}/education/lifeEduList` },
      { label: "프로그램신청방법", href: `${ORIGIN}/education/lifeEduWay` },
      { label: "이달의 추천강의", href: `${ORIGIN}/education/lifeEduList_reco` },
    ],
  },
  {
    label: "일자리/사회공헌",
    href: `${ORIGIN}/board/lifeWelfare`,
    description: "채용·창업·사회공헌 정보",
    children: [
      { label: "사회공헌", href: `${ORIGIN}/board/lifeWelfare` },
      { label: "취업 지원 게시판", href: `${ORIGIN}/board/lifeFindJob` },
      { label: "창업", href: `${ORIGIN}/board/lifeVenture` },
      { label: "공공/민간일자리", href: `${ORIGIN}/board/lifeJobHunt` },
    ],
  },
  {
    label: "커뮤니티",
    href: `${ORIGIN}/board/lifeCommunity`,
    description: "커뮤니티 참여와 센터 소식",
    children: [
      { label: "커뮤니티소개", href: `${ORIGIN}/board/lifeCommunity` },
      { label: "커뮤니티참여방법", href: `${ORIGIN}/subLifeTwist/lifeSocalEntry` },
      { label: "공지사항", href: `${ORIGIN}/board/lifeNotice` },
      { label: "센터소식", href: `${ORIGIN}/board/lifeNews` },
      { label: "FAQ", href: `${ORIGIN}/board/lifeInquiry` },
    ],
  },
  {
    label: "시설/대관",
    href: `${ORIGIN}/subLifeTwist/facility`,
    description: "층별 시설 안내와 대관 신청",
    children: [
      { label: "시설안내", href: `${ORIGIN}/subLifeTwist/facility` },
      { label: "대관신청", href: `${ORIGIN}/convention/index` },
      { label: "공유사무실안내", href: `${ORIGIN}/board/lifeOffice` },
      { label: "오시는 길", href: `${ORIGIN}/subLifeTwist/location` },
    ],
  },
];

export const classicSubmenuCount = classicNav.reduce(
  (total, group) => total + group.children.length,
  0,
);

export type ClassicHeroSlide = {
  badge: string;
  title: string;
  description: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
  statLabel: string;
  statValue: string;
};

export const classicHeroSlides: ClassicHeroSlide[] = [
  {
    badge: "2026 겨울학기 수강생 모집",
    title: "오륙십대가 행복한 도시,\n배움으로 시작하는 인생 후반전",
    description:
      "평생학습 특화프로그램과 60+교실까지. 오륙도인생후반전지원센터의 교육과정을 확인하고 신청하세요.",
    primary: { label: "프로그램 신청", href: `${ORIGIN}/education/lifeEduList` },
    secondary: { label: "수강신청 방법", href: `${ORIGIN}/education/lifeEduWay` },
    statLabel: "2026 겨울학기",
    statValue: "모집 중",
  },
  {
    badge: "센터 소개",
    title: "생애설계와 일·활동을\n한 곳에서 지원합니다",
    description:
      "생애설계진단/상담, 인생설계, 일·활동, 커뮤니티지원까지 신중년의 새로운 도전을 함께 준비합니다.",
    primary: { label: "센터 소개 보기", href: `${ORIGIN}/subLifeTwist/vision` },
    secondary: { label: "오시는 길", href: `${ORIGIN}/subLifeTwist/location` },
    statLabel: "지원 영역",
    statValue: "4개 사업",
  },
  {
    badge: "일자리정보",
    title: "취업과 창업 정보를\n지역에서 만나보세요",
    description:
      "취업 지원 게시판, 공공/민간일자리, 창업, 사회공헌 정보를 오륙도인생후반전지원센터에서 안내합니다.",
    primary: { label: "일자리정보 보기", href: `${ORIGIN}/board/lifeFindJob` },
    secondary: { label: "공공/민간일자리", href: `${ORIGIN}/board/lifeJobHunt` },
    statLabel: "일자리 채널",
    statValue: "4개 게시판",
  },
];

export type ClassicProgramTab = {
  key: string;
  label: string;
  items: ClassicNavLink[];
};

export const classicProgramTabs: ClassicProgramTab[] = [
  {
    key: "business",
    label: "사업안내",
    items: [
      { label: "생애설계진단/상담", href: `${ORIGIN}/subLifeTwist/lifePlanAssay` },
      { label: "인생설계", href: `${ORIGIN}/subLifeTwist/lifeTimePlan` },
      { label: "일·활동", href: `${ORIGIN}/subLifeTwist/lifeTaskDo` },
      { label: "커뮤니티 지원", href: `${ORIGIN}/subLifeTwist/lifeSocalhelp` },
    ],
  },
  {
    key: "education",
    label: "교육신청",
    items: [
      { label: "특강", href: `${ORIGIN}/education/lifeEduList` },
      { label: "수요조사", href: `${ORIGIN}/education/lifeEduList` },
      { label: "인생설계", href: `${ORIGIN}/education/lifeEduList` },
      { label: "일활동", href: `${ORIGIN}/education/lifeEduList` },
      { label: "60+교실", href: `${ORIGIN}/education/lifeEduList` },
    ],
  },
  {
    key: "jobs",
    label: "일자리정보",
    items: [
      { label: "사회공헌", href: `${ORIGIN}/board/lifeWelfare` },
      { label: "취업", href: `${ORIGIN}/board/lifeFindJob` },
      { label: "창업", href: `${ORIGIN}/board/lifeVenture` },
      { label: "공공/민간일자리", href: `${ORIGIN}/board/lifeJobHunt` },
      { label: "관심기업", href: `${ORIGIN}/board/lifeFindJob` },
    ],
  },
];

export type ClassicNotice = {
  title: string;
  date: string;
  tag: string;
};

export const classicNotices: ClassicNotice[] = [
  {
    title:
      "[부산남구문화재단] 모두의 이기대 프로젝트 보행 체험 참여자 모집 안내",
    date: "2026-10-21",
    tag: "모집",
  },
  {
    title:
      "평생학습 특화프로그램 「남자의 식탁」 수강생 모집",
    date: "2026-10-15",
    tag: "교육",
  },
  {
    title:
      "[가죽공예] 오륙도에서 찾아가는 나의 시간들 (2026 모두의 인문학) 추가모집",
    date: "2026-10-12",
    tag: "모집",
  },
];

export const classicJobs: ClassicNavLink[] = [
  { label: "취업 지원 게시판", href: `${ORIGIN}/board/lifeFindJob` },
  { label: "공공/민간일자리", href: `${ORIGIN}/board/lifeJobHunt` },
  { label: "창업 정보", href: `${ORIGIN}/board/lifeVenture` },
  { label: "사회공헌 활동", href: `${ORIGIN}/board/lifeWelfare` },
];

export type ClassicShortcut = {
  label: string;
  description: string;
  href: string;
};

export const classicShortcuts: ClassicShortcut[] = [
  {
    label: "상담신청",
    description: "생애설계진단/상담",
    href: `${ORIGIN}/subLifeTwist/lifePlanAssay`,
  },
  {
    label: "채용정보",
    description: "취업 지원 게시판",
    href: `${ORIGIN}/board/lifeFindJob`,
  },
  {
    label: "공유사무실",
    description: "공유사무실 안내",
    href: `${ORIGIN}/board/lifeOffice`,
  },
  {
    label: "블로그",
    description: "센터 소식 구독",
    href: "https://blog.naver.com/5060do",
  },
  {
    label: "인스타그램",
    description: "현장 사진 보기",
    href: "https://www.instagram.com/5060do_",
  },
];

export type ClassicFacility = {
  floor: string;
  name: string;
  description: string;
};

export const classicFacilities: ClassicFacility[] = [
  {
    floor: "1층",
    name: "56do카페",
    description: "교육생과 지역 주민이 함께 쉬어가는 열린 카페",
  },
  {
    floor: "3층",
    name: "56do강당",
    description: "특강과 행사를 진행하는 다목적 강당",
  },
  {
    floor: "3층",
    name: "UN남구일자리드림센터",
    description: "취업 상담과 일자리 정보를 한 곳에서",
  },
  {
    floor: "3층",
    name: "공유사무실",
    description: "신중년 창업과 활동을 지원하는 업무 공간",
  },
];

export type ClassicFamilySite = {
  label: string;
  href: string;
};

// Values come from the official footer markup so the restored footer does not
// invent contact details.
export const CLASSIC_CENTER = {
  name: "오륙도인생후반전지원센터",
  tagline: "오륙십대가 행복한 도시",
  phone: "051-628-5060",
  fax: "051-628-5064",
  email: "5060do@naver.com",
  address: "부산광역시 남구 이기대공원로 18 더파크이기대 101동",
  businessNumber: "619-82-71998",
  representative: "황보경",
  hours: "평일 09:00 ~ 18:00",
  lunch: "점심시간 12:00 ~ 13:00",
  facilityHref: `${ORIGIN}/subLifeTwist/facility`,
  locationHref: `${ORIGIN}/subLifeTwist/location`,
  mainHref: `${ORIGIN}/index/main`,
  searchAction: `${ORIGIN}/board/search`,
  policyLinks: [
    { label: "이용약관", href: `${ORIGIN}/index/policy` },
    { label: "개인정보처리방침", href: `${ORIGIN}/index/private` },
  ] as ClassicNavLink[],
  familySites: [
    { label: "오륙도인생후반전지원센터", href: `${ORIGIN}/index/main` },
    { label: "센터 블로그", href: "https://blog.naver.com/5060do" },
    { label: "센터 인스타그램", href: "https://www.instagram.com/5060do_" },
  ] as ClassicFamilySite[],
};

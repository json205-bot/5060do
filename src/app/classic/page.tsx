"use client";

import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  MapPin,
  Megaphone,
  Menu,
  MessagesSquare,
  Phone,
  Search,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import ChatbotWidget from "@/components/ChatbotWidget";
import VersionSwitcher from "@/components/version-switcher";
import { useJobs } from "@/hooks/useJobs";
import { usePrograms } from "@/hooks/usePrograms";
import { withBasePath } from "@/lib/basePath";
import type { Job } from "@/lib/jobs";
import type { Program, ProgramStatus } from "@/lib/programs";
import {
  CLASSIC_CENTER,
  classicFacilities,
  classicHeroSlides,
  classicJobs,
  classicNav,
  classicNotices,
  classicPhotos,
  classicQuickServices,
} from "@/data/classic";

const heroAutoplayMs = 5200;

const quickServiceIcons = {
  consult: MessagesSquare,
  course: GraduationCap,
  job: Briefcase,
  office: Building2,
  notice: Megaphone,
  location: MapPin,
} as const;

const programBadgeStyles: Record<ProgramStatus, string> = {
  접수중: "bg-emerald-100 text-emerald-900",
  접수예정: "bg-sky-100 text-sky-900",
  대기접수: "bg-amber-100 text-amber-900",
  마감: "bg-slate-200 text-slate-800",
};

const programActionLabels: Record<ProgramStatus, string> = {
  접수중: "상세보기",
  접수예정: "접수예정",
  대기접수: "대기신청",
  마감: "모집 마감",
};

const formatFee = (fee: number) =>
  fee > 0 ? `${fee.toLocaleString("ko-KR")}원` : "무료";

export default function ClassicPage() {
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileVisible, setMobileVisible] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<number | null>(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [noticeTab, setNoticeTab] = useState<"notice" | "photo">("notice");
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const savedOverflowRef = useRef("");

  const slide = classicHeroSlides[slideIndex];
  // Same live snapshot as the modern screen so both chat widgets answer with
  // identical course data.
  const {
    programs,
    overview: chatbotOverview,
    activePrograms: chatbotActivePrograms,
    counts: chatbotCounts,
    loadActivePrograms,
  } = usePrograms("전체");
  const { jobs } = useJobs({ boardType: "전체", region: "전체", query: "" });

  const featuredPrograms = useMemo(() => {
    const openPrograms = programs.filter((program) => program.status !== "마감");
    return (openPrograms.length >= 4 ? openPrograms : programs).slice(0, 6);
  }, [programs]);

  const selectedProgram = useMemo<Program | null>(
    () => programs.find((program) => program.id === selectedProgramId) ?? null,
    [programs, selectedProgramId],
  );

  const selectedJob = useMemo<Job | null>(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const featuredJobs = jobs.slice(0, 4);

  const goToSlide = useCallback((next: number) => {
    const length = classicHeroSlides.length;
    setSlideIndex(((next % length) + length) % length);
  }, []);

  const handleFamilySite = (event: ChangeEvent<HTMLSelectElement>) => {
    const href = event.currentTarget.value;
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
    event.currentTarget.value = "";
  };

  useEffect(() => {
    if (paused) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setSlideIndex((current) => (current + 1) % classicHeroSlides.length);
    }, heroAutoplayMs);
    return () => window.clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    if (!mobileOpen) return;
    const trigger = drawerTriggerRef.current;
    const frame = window.requestAnimationFrame(() => setMobileVisible(true));
    savedOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = savedOverflowRef.current;
      setMobileVisible(false);
      trigger?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (selectedProgramId === null && selectedJobId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedProgramId(null);
      setSelectedJobId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedProgramId, selectedJobId]);

  return (
    <div className="flex min-h-screen flex-col bg-classic-100 text-slate-900">
      <VersionSwitcher current="classic" />

      <header
        className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm"
        data-testid="classic-header"
        onMouseLeave={() => setOpenGroup(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpenGroup(null);
        }}
      >
        <div className="hidden bg-classic-700 text-white lg:block">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-2">
            <p className="text-sm font-semibold text-sky-100">
              {CLASSIC_CENTER.tagline}
            </p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 text-sm font-semibold">
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="inline-flex touch-target items-center hover:text-sky-200"
                  title="원본 사이트에서 로그인"
                >
                  로그인
                </a>
                <span aria-hidden className="text-white/40">
                  |
                </span>
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="inline-flex touch-target items-center hover:text-sky-200"
                  title="원본 사이트에서 회원가입"
                >
                  회원가입
                </a>
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="flex touch-target items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 hover:bg-white/20"
                  title="원본 사이트 브로슈어"
                >
                  브로슈어
                </a>
              </div>
              <form
                action={CLASSIC_CENTER.searchAction}
                method="get"
                role="search"
                className="flex items-center gap-1 rounded-md bg-white/10 p-1 focus-within:bg-white/20"
              >
                <input type="hidden" name="theme" value="all" />
                <input type="hidden" name="type" value="all" />
                <label htmlFor="classic-search" className="sr-only">
                  통합검색
                </label>
                <input
                  id="classic-search"
                  name="text"
                  type="search"
                  placeholder="검색어를 입력해 주세요"
                  className="w-48 touch-target rounded-sm bg-transparent px-2 py-1 text-sm text-white placeholder:text-sky-200/80 focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="통합검색"
                  className="flex size-12 items-center justify-center rounded-sm text-white hover:bg-white/20"
                >
                  <Search aria-hidden className="size-4" />
                </button>
              </form>
            </div>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <a
            href={withBasePath("/classic/")}
            className="flex touch-target min-w-0 shrink-0 items-center gap-3"
            aria-label="원본 메뉴형 홈으로 이동"
          >
            <Image
              src={withBasePath("/assets/logo_pc.png")}
              alt="오륙도인생후반전지원센터"
              width={394}
              height={73}
              priority
              className="hidden h-10 w-auto md:block"
            />
            <Image
              src={withBasePath("/assets/logo_mobile.png")}
              alt="오륙도인생후반전지원센터"
              width={394}
              height={73}
              priority
              className="h-9 w-auto md:hidden"
            />
          </a>

          <div className="hidden items-center gap-5 text-sm font-medium text-slate-600 lg:flex">
            <span className="flex items-center gap-1.5">
              <Clock aria-hidden className="size-4 text-classic-700" />
              {CLASSIC_CENTER.hours}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone aria-hidden className="size-4 text-classic-700" />
              {CLASSIC_CENTER.phone}
            </span>
          </div>

          <button
            ref={drawerTriggerRef}
            type="button"
            data-testid="classic-menu-button"
            aria-label="전체 메뉴 열기"
            aria-expanded={mobileOpen}
            aria-haspopup="dialog"
            onClick={() => setMobileOpen(true)}
            className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-slate-700 transition-colors hover:bg-slate-100 lg:hidden"
          >
            <Menu aria-hidden className="size-6" />
          </button>
        </div>

        <div className="hidden border-t border-slate-200 bg-white lg:block">
          <nav
            aria-label="주요 메뉴"
            data-testid="classic-gnb"
            className="mx-auto w-full max-w-6xl px-2"
          >
            <ul className="flex w-full items-stretch justify-between">
              {classicNav.map((group, index) => {
                const isOpen = openGroup === index;
                return (
                  <li
                    key={group.label}
                    className="flex flex-1"
                    onMouseEnter={() => setOpenGroup(index)}
                    onFocus={() => setOpenGroup(index)}
                  >
                    <a
                      href={group.href}
                      aria-expanded={isOpen}
                      aria-haspopup="true"
                      data-testid={`classic-gnb-item-${index}`}
                      className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-2 py-3 text-sm font-bold transition-colors ${
                        isOpen
                          ? "border-classic-700 text-classic-700"
                          : "border-transparent text-slate-700 hover:text-classic-700"
                      }`}
                    >
                      {group.label}
                      <ChevronDown
                        aria-hidden
                        className={`size-4 transition-transform ${
                          isOpen ? "rotate-180 text-classic-700" : "text-slate-600"
                        }`}
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        {openGroup !== null && (
          <div
            data-testid="classic-mega-menu"
            className="absolute inset-x-0 top-full hidden border-t border-slate-200 bg-white shadow-xl lg:block"
          >
            <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-7 lg:grid-cols-[240px_1fr]">
              <ul className="flex flex-col gap-1 border-r border-slate-200 pr-6">
                {classicNav.map((group, index) => (
                  <li key={group.label}>
                    <button
                      type="button"
                      onMouseEnter={() => setOpenGroup(index)}
                      onFocus={() => setOpenGroup(index)}
                      onClick={() => setOpenGroup(index)}
                      aria-current={openGroup === index ? "true" : undefined}
                      className={`flex touch-target w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold transition-colors ${
                        openGroup === index
                          ? "bg-classic-50 text-classic-700"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {group.label}
                      <ChevronRight aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <div>
                <div className="flex flex-col gap-1 border-b border-slate-200 pb-3">
                  <h2 className="text-xl font-bold text-classic-700">
                    {classicNav[openGroup].label}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {classicNav[openGroup].description}
                  </p>
                </div>
                <ul className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                  {classicNav[openGroup].children.map((child) => (
                    <li key={child.href}>
                      <a
                        href={child.href}
                        className="flex touch-target items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-700 transition-colors hover:bg-classic-50 hover:text-classic-700"
                      >
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-classic-700/40"
                        />
                        {child.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <section
          data-testid="classic-hero"
          aria-label="비주얼 롤링 영역"
          className="relative overflow-hidden bg-classic-900 text-white"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-24 z-0 size-[420px] rounded-full bg-sky-500/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-40 -left-24 z-0 size-[380px] rounded-full bg-amber-400/10 blur-3xl"
          />
          <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 md:px-6 md:py-16 lg:grid-cols-[1.55fr_1fr] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-bold text-sky-100">
                {slide.badge}
              </p>
              <h1
                data-testid="classic-hero-title"
                className="mt-4 whitespace-pre-line text-3xl font-bold leading-snug md:text-4xl"
              >
                {slide.title}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-sky-100">
                {slide.description}
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href={slide.primary.href}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-accent-500 px-6 text-lg font-bold text-classic-900 transition-colors hover:bg-accent-400"
                >
                  {slide.primary.label}
                  <ArrowRight aria-hidden className="size-5" />
                </a>
                <a
                  href={slide.secondary.href}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-white/50 px-6 text-lg font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {slide.secondary.label}
                  <ArrowUpRight aria-hidden className="size-5" />
                </a>
              </div>
            </div>

            <a
              href={slide.primary.href}
              target="_blank"
              rel="noreferrer"
              aria-label={`${slide.badge} 자세히 보기`}
              className="group relative block overflow-hidden rounded-2xl border border-white/20 bg-classic-800 shadow-lg"
            >
              <span className="relative block aspect-square w-full lg:aspect-[1152/437]">
                <Image
                  src={withBasePath(slide.image.desktop)}
                  alt={slide.image.alt}
                  fill
                  priority
                  sizes="(min-width: 1024px) 430px, 100vw"
                  className="hidden object-cover lg:block"
                />
                <Image
                  src={withBasePath(slide.image.mobile)}
                  alt={slide.image.alt}
                  fill
                  priority
                  sizes="100vw"
                  className="object-cover lg:hidden"
                />
              </span>
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-classic-900/95 to-transparent p-4">
                <span>
                  <span className="block text-sm font-semibold text-sky-200">
                    {slide.statLabel}
                  </span>
                  <span className="block text-2xl font-black text-white">
                    {slide.statValue}
                  </span>
                </span>
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
                  <ArrowUpRight aria-hidden className="size-5" />
                </span>
              </span>
            </a>
          </div>

          <div className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pb-6 md:px-6">
            <div className="flex items-center gap-2">
              {classicHeroSlides.map((item, index) => (
                <button
                  key={item.badge}
                  type="button"
                  aria-label={`${index + 1}번째 비주얼 보기`}
                  aria-current={index === slideIndex ? "true" : undefined}
                  onClick={() => goToSlide(index)}
                  className="flex size-12 items-center justify-center"
                >
                  <span
                    aria-hidden
                    className={`h-2.5 rounded-full transition-all ${
                      index === slideIndex
                        ? "w-8 bg-accent-500"
                        : "w-2.5 bg-white/40 hover:bg-white/70"
                    }`}
                  />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="이전 비주얼"
                onClick={() => goToSlide(slideIndex - 1)}
                className="flex size-12 items-center justify-center rounded-full border border-white/30 text-white transition-colors hover:bg-white/10"
              >
                <ChevronLeft aria-hidden className="size-5" />
              </button>
              <button
                type="button"
                aria-label="다음 비주얼"
                data-testid="classic-hero-next"
                onClick={() => goToSlide(slideIndex + 1)}
                className="flex size-12 items-center justify-center rounded-full border border-white/30 text-white transition-colors hover:bg-white/10"
              >
                <ChevronRight aria-hidden className="size-5" />
              </button>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="classic-quick-heading"
          className="border-b border-slate-200 bg-white"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-classic-700">
                자주 찾는 서비스
              </p>
              <h2
                id="classic-quick-heading"
                className="text-2xl font-bold text-slate-900"
              >
                바로가기
              </h2>
            </div>
            <ul
              data-testid="classic-quick-services"
              className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
            >
              {classicQuickServices.map((service) => {
                const Icon = quickServiceIcons[service.icon];
                return (
                  <li key={service.key} className="flex">
                    <a
                      href={service.href}
                      target={service.href.startsWith("http") ? "_blank" : undefined}
                      rel={
                        service.href.startsWith("http")
                          ? "noreferrer"
                          : undefined
                      }
                      data-testid={`classic-quick-${service.key}`}
                      className="group flex w-full flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-center transition-all hover:-translate-y-0.5 hover:border-classic-700/40 hover:shadow-md"
                    >
                      <span className="flex size-14 items-center justify-center rounded-2xl bg-classic-50 text-classic-700 transition-colors group-hover:bg-classic-700 group-hover:text-white">
                        <Icon aria-hidden className="size-7" />
                      </span>
                      <span className="flex flex-col gap-1">
                        <span className="text-base font-bold text-slate-900">
                          {service.label}
                        </span>
                        <span className="text-sm text-slate-600">
                          {service.description}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section
          aria-labelledby="classic-program-heading"
          className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold text-classic-700">
                오륙십대가 행복한 도시
              </p>
              <h2
                id="classic-program-heading"
                className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl"
              >
                교육/강좌
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                현재 신청 가능한 강좌를 실시간으로 안내합니다.
              </p>
            </div>
            <a
              href="https://www.5060do.or.kr/education/lifeEduList"
              className="inline-flex touch-target items-center gap-1 text-sm font-bold text-classic-700 hover:underline"
            >
              전체 프로그램 보기
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </div>

          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featuredPrograms.map((program) => (
              <li key={program.id} className="flex">
                <button
                  type="button"
                  data-testid="classic-program-card"
                  data-status={program.status}
                  aria-haspopup="dialog"
                  onClick={() => setSelectedProgramId(program.id)}
                  className="group flex w-full flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-classic-700/40 hover:shadow-md"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-classic-50 px-3 py-1 text-sm font-bold text-classic-700">
                      {program.category}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-bold ${programBadgeStyles[program.status]}`}
                    >
                      {program.status}
                    </span>
                  </span>
                  <span className="mt-3 text-lg font-bold leading-snug text-slate-900">
                    {program.title}
                  </span>
                  <span className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                    <span className="inline-flex items-start gap-2">
                      <CalendarDays
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-classic-600"
                      />
                      {program.eduPeriod}
                    </span>
                    <span className="inline-flex items-start gap-2">
                      <MapPin
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-classic-600"
                      />
                      {program.location}
                    </span>
                    <span className="inline-flex items-start gap-2">
                      <Wallet
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-classic-600"
                      />
                      {formatFee(program.fee)}
                    </span>
                  </span>
                  <span className="mt-4 flex min-h-12 items-center justify-center gap-1 rounded-xl bg-classic-700 text-base font-bold text-white transition-colors group-hover:bg-classic-800">
                    {programActionLabels[program.status]}
                    <ChevronRight aria-hidden className="size-4" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:px-6 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-bold text-slate-900">알림마당</h2>
                <a
                  href="https://www.5060do.or.kr/board/lifeNotice"
                  className="inline-flex touch-target items-center text-sm font-bold text-classic-700 hover:underline"
                >
                  더보기
                </a>
              </div>
              <div
                role="tablist"
                aria-label="알림마당 분류"
                className="mt-4 flex flex-wrap gap-2 border-b border-slate-200"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={noticeTab === "notice"}
                  data-testid="classic-notice-tab"
                  onClick={() => setNoticeTab("notice")}
                  className={`-mb-px min-h-12 border-b-2 px-5 text-base font-bold transition-colors ${
                    noticeTab === "notice"
                      ? "border-classic-700 text-classic-700"
                      : "border-transparent text-slate-600 hover:text-classic-700"
                  }`}
                >
                  공지사항
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={noticeTab === "photo"}
                  data-testid="classic-photo-tab"
                  onClick={() => setNoticeTab("photo")}
                  className={`-mb-px min-h-12 border-b-2 px-5 text-base font-bold transition-colors ${
                    noticeTab === "photo"
                      ? "border-classic-700 text-classic-700"
                      : "border-transparent text-slate-600 hover:text-classic-700"
                  }`}
                >
                  포토 소식
                </button>
              </div>

              {noticeTab === "notice" ? (
                <ul className="mt-2 divide-y divide-slate-200">
                  {classicNotices.map((notice) => (
                    <li key={notice.title}>
                      <a
                        href="https://www.5060do.or.kr/board/lifeNotice"
                        className="flex min-h-16 flex-col justify-center gap-1 py-3 transition-colors hover:text-classic-700 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                      >
                        <span className="flex items-start gap-3">
                          <span className="mt-0.5 shrink-0 rounded bg-classic-50 px-2 py-0.5 text-xs font-bold text-classic-700">
                            {notice.tag}
                          </span>
                          <span className="text-base font-semibold leading-snug text-slate-800">
                            {notice.title}
                          </span>
                        </span>
                        <span className="shrink-0 pl-12 text-sm text-slate-600 sm:pl-0">
                          {notice.date}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {classicPhotos.map((photo) => (
                    <li key={photo.title}>
                      <a
                        href="https://www.5060do.or.kr/board/lifePhoto"
                        className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:border-classic-700/40 hover:shadow-md"
                      >
                        <span
                          aria-hidden
                          className="flex h-24 items-center justify-center bg-gradient-to-br from-classic-500 to-classic-800 text-white"
                        >
                          <Megaphone className="size-8" />
                        </span>
                        <span className="flex flex-1 flex-col gap-1 p-4">
                          <span className="text-sm font-bold text-classic-700">
                            {photo.album}
                          </span>
                          <span className="text-base font-semibold leading-snug text-slate-900">
                            {photo.title}
                          </span>
                          <span className="mt-auto text-sm text-slate-600">
                            {photo.date}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-bold text-slate-900">일자리정보</h2>
                <a
                  href="https://www.5060do.or.kr/board/lifeFindJob"
                  className="inline-flex touch-target items-center text-sm font-bold text-classic-700 hover:underline"
                >
                  더보기
                </a>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                신중년 채용 속보를 실시간으로 확인하세요.
              </p>
              {featuredJobs.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-2">
                  {featuredJobs.map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        data-testid="classic-job-card"
                        aria-haspopup="dialog"
                        onClick={() => setSelectedJobId(job.id)}
                        className="flex w-full flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-classic-700/40 hover:bg-classic-50"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-classic-50 px-2.5 py-1 text-sm font-bold text-classic-700">
                            {job.boardType}
                          </span>
                          <span className="text-base font-semibold text-slate-900">
                            {job.title}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays
                              aria-hidden
                              className="size-4 text-classic-600"
                            />
                            {job.date}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin
                              aria-hidden
                              className="size-4 text-classic-600"
                            />
                            {job.region === "부산" ? "부산" : "기타 지역"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {classicJobs.map((job) => (
                    <li key={job.href}>
                      <a
                        href={job.href}
                        className="flex min-h-20 flex-col justify-between gap-2 rounded-xl bg-classic-100 p-4 transition-colors hover:bg-classic-50"
                      >
                        <span className="text-base font-bold text-slate-800">
                          {job.label}
                        </span>
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-classic-700">
                          게시판 바로가기
                          <ArrowRight aria-hidden className="size-4" />
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="bg-classic-700 text-white">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:px-6 lg:grid-cols-[1.6fr_1fr]">
            <div>
              <h2 className="text-2xl font-bold text-white">층별 시설안내</h2>
              <p className="mt-2 text-sm text-sky-200">
                교육과 상담, 창업 활동이 한 건물에서 이어집니다.
              </p>
              <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {classicFacilities.map((facility) => (
                  <li
                    key={facility.name}
                    className="rounded-xl border border-white/15 bg-white/5 p-4"
                  >
                    <span className="inline-flex rounded bg-accent-500 px-2 py-0.5 text-xs font-black text-classic-800">
                      {facility.floor}
                    </span>
                    <h3 className="mt-2 text-base font-bold text-white">
                      {facility.name}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-sky-100">
                      {facility.description}
                    </p>
                  </li>
                ))}
              </ul>
              <a
                href={CLASSIC_CENTER.facilityHref}
                className="mt-4 inline-flex touch-target items-center gap-1 text-sm font-bold text-accent-500 hover:underline"
              >
                시설 둘러보기
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
            </div>

            <div className="rounded-2xl bg-white p-6 text-slate-900">
              <h2 className="text-xl font-bold text-classic-700">상담문의</h2>
              <a
                href={`tel:${CLASSIC_CENTER.phone.replace(/-/g, "")}`}
                className="mt-3 flex touch-target items-center gap-2 text-3xl font-black tracking-tight text-classic-700 hover:underline"
              >
                <Phone aria-hidden className="size-7 shrink-0" />
                {CLASSIC_CENTER.phone}
              </a>
              <dl className="mt-5 grid gap-3 text-sm">
                <div className="flex items-start gap-2">
                  <Clock
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-classic-700"
                  />
                  <dt className="sr-only">운영시간</dt>
                  <dd>
                    {CLASSIC_CENTER.hours}
                    <br />
                    {CLASSIC_CENTER.lunch}
                  </dd>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-classic-700"
                  />
                  <dt className="sr-only">오시는 길</dt>
                  <dd>
                    <a
                      href="https://www.5060do.or.kr/subLifeTwist/location"
                      className="inline-flex touch-target items-center font-bold text-classic-700 underline underline-offset-4"
                    >
                      오시는 길 안내 보기
                    </a>
                  </dd>
                </div>
              </dl>
              <a
                href="https://www.5060do.or.kr/subLifeTwist/lifePlanAssay"
                className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-lg bg-classic-700 text-base font-bold text-white transition-colors hover:bg-classic-800"
              >
                상담 신청하기
                <ArrowRight aria-hidden className="size-5" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer
        data-testid="classic-footer"
        className="border-t border-white/10 bg-classic-900 text-sky-100"
      >
        <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-10 md:px-6 lg:pb-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Image
                src={withBasePath("/assets/logo_footer.png")}
                alt="오륙도인생후반전지원센터"
                width={194}
                height={36}
                className="h-9 w-auto"
              />
              <p className="mt-4 text-lg font-bold text-white">
                {CLASSIC_CENTER.name}
              </p>
              <dl className="mt-4 grid gap-1 text-sm leading-relaxed">
                <div className="flex flex-wrap items-start gap-x-2">
                  <dt className="shrink-0 font-bold text-sky-200">주소</dt>
                  <dd>{CLASSIC_CENTER.address}</dd>
                </div>
                <div className="flex flex-wrap items-center gap-x-2">
                  <dt className="shrink-0 font-bold text-sky-200">대표전화</dt>
                  <dd>
                    <a
                      href={`tel:${CLASSIC_CENTER.phone.replace(/-/g, "")}`}
                      data-testid="classic-footer-tel"
                      className="inline-flex touch-target items-center font-bold text-white underline underline-offset-4 hover:text-sky-200"
                    >
                      {CLASSIC_CENTER.phone}
                    </a>
                  </dd>
                  <dt className="shrink-0 font-bold text-sky-200">팩스</dt>
                  <dd className="font-semibold">{CLASSIC_CENTER.fax}</dd>
                </div>
                <div className="flex flex-wrap items-center gap-x-2">
                  <dt className="shrink-0 font-bold text-sky-200">이메일</dt>
                  <dd>
                    <a
                      href={`mailto:${CLASSIC_CENTER.email}`}
                      className="inline-flex touch-target items-center text-white underline underline-offset-4 hover:text-sky-200"
                    >
                      {CLASSIC_CENTER.email}
                    </a>
                  </dd>
                </div>
                <div className="flex flex-wrap items-center gap-x-2">
                  <dt className="shrink-0 font-bold text-sky-200">오시는 길</dt>
                  <dd>
                    <a
                      href={CLASSIC_CENTER.locationHref}
                      data-testid="classic-footer-location"
                      className="inline-flex touch-target items-center font-bold text-white underline underline-offset-4 hover:text-sky-200"
                    >
                      오시는 길 안내 보기
                    </a>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex w-full flex-col gap-4 lg:w-auto lg:items-end">
              <div className="w-full lg:w-72">
                <label
                  htmlFor="classic-family-site"
                  className="block text-sm font-bold text-sky-100"
                >
                  패밀리 사이트
                </label>
                <select
                  id="classic-family-site"
                  data-testid="classic-family-site"
                  defaultValue=""
                  onChange={handleFamilySite}
                  className="mt-2 h-12 w-full rounded-lg border-2 border-white/40 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-sky-300 focus:outline-none"
                >
                  <option value="">패밀리 사이트 선택</option>
                  {CLASSIC_CENTER.familySites.map((site) => (
                    <option key={site.href} value={site.href}>
                      {site.label}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="flex flex-wrap items-center gap-x-3 lg:justify-end">
                {CLASSIC_CENTER.policyLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="inline-flex touch-target items-center text-sm font-semibold text-sky-100 underline underline-offset-4 hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-1 border-t border-white/15 pt-5 text-sm text-sky-200">
            <p>
              사업자등록번호 {CLASSIC_CENTER.businessNumber} · 대표자{" "}
              {CLASSIC_CENTER.representative}
            </p>
            <p className="text-sky-200/90">
              본 화면은 원본 사이트의 메뉴 구조를 보존한 반응형 시안입니다. 각
              메뉴는 원본 사이트의 해당 페이지로 연결됩니다.
            </p>
            <p data-testid="classic-copyright" className="font-semibold">
              © 2026 {CLASSIC_CENTER.name} All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {selectedProgram && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedProgramId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="classic-program-dialog-title"
            data-testid="classic-program-modal"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-classic-50 px-3 py-1 text-sm font-bold text-classic-700">
                    {selectedProgram.category}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-bold ${programBadgeStyles[selectedProgram.status]}`}
                  >
                    {selectedProgram.status}
                  </span>
                </div>
                <h2
                  id="classic-program-dialog-title"
                  className="mt-3 text-2xl font-bold leading-snug text-slate-900"
                >
                  {selectedProgram.title}
                </h2>
              </div>
              <button
                type="button"
                data-testid="classic-program-close"
                onClick={() => setSelectedProgramId(null)}
                aria-label="강좌 상세 창 닫기"
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-900 transition-colors hover:bg-slate-200"
              >
                <X aria-hidden className="size-6" />
              </button>
            </div>

            {selectedProgram.summary && (
              <p className="mt-4 text-base leading-relaxed text-slate-800">
                {selectedProgram.summary}
              </p>
            )}

            <dl className="mt-5 grid grid-cols-1 gap-3 rounded-2xl bg-classic-100 p-4 text-base sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <CalendarDays
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-classic-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-700">
                    교육기간
                  </dt>
                  <dd className="font-semibold text-slate-900">
                    {selectedProgram.eduPeriod || "정보 없음"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-classic-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-700">장소</dt>
                  <dd className="font-semibold text-slate-900">
                    {selectedProgram.location || "정보 없음"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Wallet
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-classic-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-700">
                    수강료
                  </dt>
                  <dd className="font-semibold text-slate-900">
                    {formatFee(selectedProgram.fee)}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Users
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-classic-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-700">정원</dt>
                  <dd className="font-semibold text-slate-900">
                    {selectedProgram.capacity}명
                    {selectedProgram.enrolled === undefined
                      ? ""
                      : ` · 신청 ${selectedProgram.enrolled}명`}
                  </dd>
                </div>
              </div>
            </dl>

            <a
              href={selectedProgram.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-classic-700 px-6 text-lg font-bold text-white transition-colors hover:bg-classic-800"
            >
              원본에서 신청하기
              <ArrowUpRight aria-hidden className="size-5" />
            </a>
          </div>
        </div>
      )}

      {selectedJob && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedJobId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="classic-job-dialog-title"
            data-testid="job-detail-modal"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-classic-50 px-3 py-1 text-sm font-bold text-classic-700">
                    {selectedJob.boardType}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-800">
                    {selectedJob.region === "부산" ? "부산" : "기타 지역"}
                  </span>
                </div>
                <h2
                  id="classic-job-dialog-title"
                  className="mt-3 text-2xl font-bold leading-snug text-slate-900"
                >
                  {selectedJob.title}
                </h2>
              </div>
              <button
                type="button"
                data-testid="job-detail-close"
                onClick={() => setSelectedJobId(null)}
                aria-label="채용정보 상세 창 닫기"
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-900 transition-colors hover:bg-slate-200"
              >
                <X aria-hidden className="size-6" />
              </button>
            </div>

            <dl className="mt-5 grid grid-cols-1 gap-3 rounded-2xl bg-classic-100 p-4 text-base sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <CalendarDays
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-classic-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-700">등록일</dt>
                  <dd className="font-semibold text-slate-900">
                    {selectedJob.date || "정보 없음"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-classic-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-700">지역</dt>
                  <dd className="font-semibold text-slate-900">
                    {selectedJob.region === "부산" ? "부산" : "기타 지역"}
                  </dd>
                </div>
              </div>
            </dl>

            <div className="mt-5 rounded-2xl border border-slate-200 p-4">
              <h3 className="text-base font-bold text-slate-900">공고 내용</h3>
              <div className="mt-2 whitespace-pre-line text-base leading-relaxed text-slate-800">
                {selectedJob.content || "상세 내용은 원문 게시판에서 확인하세요."}
              </div>
            </div>

            <a
              href={selectedJob.sourceUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="job-source-link"
              className="mt-5 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-classic-700 px-6 text-lg font-bold text-white transition-colors hover:bg-classic-800"
            >
              원문 게시판에서 보기
              <ArrowUpRight aria-hidden className="size-5" />
            </a>
          </div>
        </div>
      )}

      <ChatbotWidget
        programs={chatbotOverview}
        activePrograms={chatbotActivePrograms}
        counts={chatbotCounts}
        onOpen={() => {
          setMobileOpen(false);
          loadActivePrograms();
        }}
      />

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="전체 메뉴 닫기"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-slate-900/60"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="classic-drawer-title"
            data-testid="classic-drawer"
            className={`absolute right-0 top-0 flex h-full w-[min(88vw,380px)] flex-col bg-white shadow-2xl transition-transform duration-300 ${
              mobileVisible ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2
                id="classic-drawer-title"
                className="text-xl font-bold text-classic-700"
              >
                전체 메뉴
              </h2>
              <button
                ref={drawerCloseRef}
                type="button"
                data-testid="classic-drawer-close"
                onClick={() => setMobileOpen(false)}
                aria-label="전체 메뉴 닫기"
                className="flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <a href={CLASSIC_CENTER.mainHref} className="inline-flex touch-target items-center hover:text-classic-700">
                  로그인
                </a>
                <span aria-hidden className="text-slate-300">
                  |
                </span>
                <a href={CLASSIC_CENTER.mainHref} className="inline-flex touch-target items-center hover:text-classic-700">
                  회원가입
                </a>
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="ml-auto inline-flex touch-target items-center rounded-md bg-classic-50 px-2.5 py-1 text-classic-700"
                >
                  브로슈어
                </a>
              </div>

              <form
                action={CLASSIC_CENTER.searchAction}
                method="get"
                role="search"
                className="mt-3 flex items-center gap-1 rounded-lg border border-slate-300 p-1"
              >
                <input type="hidden" name="theme" value="all" />
                <input type="hidden" name="type" value="all" />
                <label htmlFor="classic-drawer-search" className="sr-only">
                  통합검색
                </label>
                <input
                  id="classic-drawer-search"
                  name="text"
                  type="search"
                  placeholder="검색어를 입력해 주세요"
                  className="min-w-0 flex-1 touch-target bg-transparent px-2 py-1.5 text-sm focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="통합검색"
                  className="flex size-12 items-center justify-center rounded-md bg-classic-700 text-white"
                >
                  <Search aria-hidden className="size-4" />
                </button>
              </form>

              <ul className="mt-4 border-t border-slate-200">
                {classicNav.map((group, index) => {
                  const isOpen = mobileGroup === index;
                  return (
                    <li key={group.label} className="border-b border-slate-200">
                      <button
                        type="button"
                        data-testid={`classic-accordion-${index}`}
                        aria-expanded={isOpen}
                        aria-controls={`classic-group-${index}`}
                        onClick={() =>
                          setMobileGroup((current) =>
                            current === index ? null : index,
                          )
                        }
                        className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left"
                      >
                        <span className="text-base font-bold text-slate-800">
                          {group.label}
                        </span>
                        <ChevronDown
                          aria-hidden
                          className={`size-5 shrink-0 text-slate-600 transition-transform ${
                            isOpen ? "rotate-180 text-classic-700" : ""
                          }`}
                        />
                      </button>
                      {isOpen && (
                        <ul
                          id={`classic-group-${index}`}
                          data-testid={`classic-accordion-panel-${index}`}
                          className="pb-3"
                        >
                          {group.children.map((child) => (
                            <li key={child.href}>
                              <a
                                href={child.href}
                                className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-classic-50 hover:text-classic-700"
                              >
                                {child.label}
                                <ArrowRight
                                  aria-hidden
                                  className="size-4 shrink-0 text-slate-300"
                                />
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>

              <dl className="mt-4 rounded-xl bg-classic-100 p-4 text-sm">
                <div className="flex items-center gap-2">
                  <Phone aria-hidden className="size-4 text-classic-700" />
                  <dt className="w-16 shrink-0 font-semibold text-slate-600">
                    상담전화
                  </dt>
                  <dd>
                    <a
                      href={`tel:${CLASSIC_CENTER.phone.replace(/-/g, "")}`}
                      className="font-bold text-classic-700 underline underline-offset-4"
                    >
                      {CLASSIC_CENTER.phone}
                    </a>
                  </dd>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Clock aria-hidden className="size-4 text-classic-700" />
                  <dt className="w-16 shrink-0 font-semibold text-slate-600">
                    운영시간
                  </dt>
                  <dd className="font-semibold text-slate-800">
                    {CLASSIC_CENTER.hours}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

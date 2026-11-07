"use client";

import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Menu,
  Phone,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import VersionSwitcher from "@/components/version-switcher";
import { withBasePath } from "@/lib/basePath";
import {
  CLASSIC_CENTER,
  classicFacilities,
  classicHeroSlides,
  classicJobs,
  classicNav,
  classicNotices,
  classicProgramTabs,
  classicShortcuts,
  classicSubmenuCount,
} from "@/data/classic";

const heroAutoplayMs = 5200;

export default function ClassicPage() {
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileVisible, setMobileVisible] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<number | null>(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [activeTab, setActiveTab] = useState(classicProgramTabs[0].key);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const savedOverflowRef = useRef("");

  const slide = classicHeroSlides[slideIndex];
  const activePrograms =
    classicProgramTabs.find((tab) => tab.key === activeTab) ??
    classicProgramTabs[0];

  const goToSlide = useCallback((next: number) => {
    const length = classicHeroSlides.length;
    setSlideIndex(((next % length) + length) % length);
  }, []);

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

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f6f9] text-slate-900">
      <VersionSwitcher current="classic" />

      <header
        className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm"
        data-testid="classic-header"
        onMouseLeave={() => setOpenGroup(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpenGroup(null);
        }}
      >
        <div className="hidden bg-[#0f3b66] text-white lg:block">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-2">
            <p className="text-[15px] font-semibold text-sky-100">
              {CLASSIC_CENTER.tagline}
            </p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 text-[15px] font-semibold">
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="hover:text-sky-200"
                  title="원본 사이트에서 로그인"
                >
                  로그인
                </a>
                <span aria-hidden className="text-white/40">
                  |
                </span>
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="hover:text-sky-200"
                  title="원본 사이트에서 회원가입"
                >
                  회원가입
                </a>
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 hover:bg-white/20"
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
                  className="w-48 rounded-sm bg-transparent px-2 py-1 text-[15px] text-white placeholder:text-sky-200/80 focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="통합검색"
                  className="flex size-8 items-center justify-center rounded-sm text-white hover:bg-white/20"
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
            className="flex min-w-0 shrink-0 items-center gap-3"
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

          <div className="hidden items-center gap-5 text-[15px] font-medium text-slate-500 lg:flex">
            <span className="flex items-center gap-1.5">
              <Clock aria-hidden className="size-4 text-[#0f3b66]" />
              {CLASSIC_CENTER.hours}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone aria-hidden className="size-4 text-[#0f3b66]" />
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
                      className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-2 py-3 text-[16px] font-bold transition-colors ${
                        isOpen
                          ? "border-[#0f3b66] text-[#0f3b66]"
                          : "border-transparent text-slate-700 hover:text-[#0f3b66]"
                      }`}
                    >
                      {group.label}
                      <ChevronDown
                        aria-hidden
                        className={`size-4 transition-transform ${
                          isOpen ? "rotate-180 text-[#0f3b66]" : "text-slate-400"
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
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[16px] font-bold transition-colors ${
                        openGroup === index
                          ? "bg-[#eef3f9] text-[#0f3b66]"
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
                  <h2 className="text-xl font-bold text-[#0f3b66]">
                    {classicNav[openGroup].label}
                  </h2>
                  <p className="text-[15px] text-slate-500">
                    {classicNav[openGroup].description}
                  </p>
                </div>
                <ul className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                  {classicNav[openGroup].children.map((child) => (
                    <li key={child.href}>
                      <a
                        href={child.href}
                        className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-[16px] font-medium text-slate-700 transition-colors hover:bg-[#eef3f9] hover:text-[#0f3b66]"
                      >
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-[#0f3b66]/40"
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
          className="relative overflow-hidden bg-[#0b2c4d] text-white"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-24 size-[420px] rounded-full bg-sky-500/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-40 -left-24 size-[380px] rounded-full bg-amber-400/10 blur-3xl"
          />
          <div className="relative mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 md:px-6 md:py-16 lg:grid-cols-[1.55fr_1fr] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-[15px] font-bold text-sky-100">
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
                  className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-[#f0b429] px-6 text-lg font-bold text-[#0b2c4d] transition-colors hover:bg-[#ffc94d]"
                >
                  {slide.primary.label}
                  <ArrowRight aria-hidden className="size-5" />
                </a>
                <a
                  href={slide.secondary.href}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-white/40 px-6 text-lg font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {slide.secondary.label}
                  <ArrowUpRight aria-hidden className="size-5" />
                </a>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur-sm lg:block">
              <p className="text-[15px] font-semibold text-sky-200">
                {slide.statLabel}
              </p>
              <p className="mt-1 text-4xl font-black text-white">
                {slide.statValue}
              </p>
              <dl className="mt-6 grid gap-3 text-[15px]">
                <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-3">
                  <dt className="text-sky-200">상담전화</dt>
                  <dd className="font-bold text-white">
                    {CLASSIC_CENTER.phone}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-3">
                  <dt className="text-sky-200">운영시간</dt>
                  <dd className="font-bold text-white">
                    {CLASSIC_CENTER.hours}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-3">
                  <dt className="text-sky-200">메뉴 구성</dt>
                  <dd className="font-bold text-white">
                    8대 메뉴 · {classicSubmenuCount}개 세부 메뉴
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pb-6 md:px-6">
            <div className="flex items-center gap-2">
              {classicHeroSlides.map((item, index) => (
                <button
                  key={item.badge}
                  type="button"
                  aria-label={`${index + 1}번째 비주얼 보기`}
                  aria-current={index === slideIndex ? "true" : undefined}
                  onClick={() => goToSlide(index)}
                  className={`h-2.5 rounded-full transition-all ${
                    index === slideIndex
                      ? "w-8 bg-[#f0b429]"
                      : "w-2.5 bg-white/40 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="이전 비주얼"
                onClick={() => goToSlide(slideIndex - 1)}
                className="flex size-10 items-center justify-center rounded-full border border-white/30 text-white transition-colors hover:bg-white/10"
              >
                <ChevronLeft aria-hidden className="size-5" />
              </button>
              <button
                type="button"
                aria-label="다음 비주얼"
                data-testid="classic-hero-next"
                onClick={() => goToSlide(slideIndex + 1)}
                className="flex size-10 items-center justify-center rounded-full border border-white/30 text-white transition-colors hover:bg-white/10"
              >
                <ChevronRight aria-hidden className="size-5" />
              </button>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="classic-program-heading"
          className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[15px] font-bold text-[#0f3b66]">
                오륙십대가 행복한 도시
              </p>
              <h2
                id="classic-program-heading"
                className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl"
              >
                교육 프로그램
              </h2>
            </div>
            <a
              href="https://www.5060do.or.kr/education/lifeEduList"
              className="inline-flex items-center gap-1 text-[16px] font-bold text-[#0f3b66] hover:underline"
            >
              전체 프로그램 보기
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </div>

          <div
            role="tablist"
            aria-label="프로그램 분류"
            className="mt-5 flex flex-wrap gap-2 border-b border-slate-200"
          >
            {classicProgramTabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`classic-tab-${tab.key}`}
                  onClick={() => setActiveTab(tab.key)}
                  className={`-mb-px min-h-12 border-b-2 px-5 text-[17px] font-bold transition-colors ${
                    isActive
                      ? "border-[#0f3b66] text-[#0f3b66]"
                      : "border-transparent text-slate-500 hover:text-[#0f3b66]"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activePrograms.items.map((item, index) => (
              <li key={`${activePrograms.key}-${item.label}`}>
                <a
                  href={item.href}
                  className="group flex h-full flex-col justify-between gap-6 rounded-xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-[#0f3b66]/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[15px] font-black tabular-nums text-[#0f3b66]/40">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <ArrowUpRight
                      aria-hidden
                      className="size-5 shrink-0 text-slate-300 transition-colors group-hover:text-[#0f3b66]"
                    />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold leading-snug text-slate-900">
                      {item.label}
                    </h3>
                    <p className="mt-2 text-[15px] text-slate-500">
                      {activePrograms.label} · 자세히 보기
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:px-6 lg:grid-cols-2">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-bold text-slate-900">새로운 소식</h2>
                <a
                  href="https://www.5060do.or.kr/board/lifeNotice"
                  className="text-[15px] font-bold text-[#0f3b66] hover:underline"
                >
                  더보기
                </a>
              </div>
              <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
                {classicNotices.map((notice) => (
                  <li key={notice.title}>
                    <a
                      href="https://www.5060do.or.kr/board/lifeNotice"
                      className="flex min-h-16 flex-col justify-center gap-1 py-3 transition-colors hover:text-[#0f3b66] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <span className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 rounded bg-[#eef3f9] px-2 py-0.5 text-[13px] font-bold text-[#0f3b66]">
                          {notice.tag}
                        </span>
                        <span className="text-[17px] font-semibold leading-snug text-slate-800">
                          {notice.title}
                        </span>
                      </span>
                      <span className="shrink-0 pl-12 text-[15px] text-slate-400 sm:pl-0">
                        {notice.date}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-bold text-slate-900">일자리정보</h2>
                <a
                  href="https://www.5060do.or.kr/board/lifeFindJob"
                  className="text-[15px] font-bold text-[#0f3b66] hover:underline"
                >
                  더보기
                </a>
              </div>
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {classicJobs.map((job) => (
                  <li key={job.href}>
                    <a
                      href={job.href}
                      className="flex min-h-20 flex-col justify-between gap-2 rounded-xl bg-[#f4f6f9] p-4 transition-colors hover:bg-[#eef3f9]"
                    >
                      <span className="text-[17px] font-bold text-slate-800">
                        {job.label}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#0f3b66]">
                        게시판 바로가기
                        <ArrowRight aria-hidden className="size-4" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="classic-shortcut-heading"
          className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6"
        >
          <h2
            id="classic-shortcut-heading"
            className="text-2xl font-bold text-slate-900"
          >
            바로가기
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {classicShortcuts.map((shortcut) => (
              <li key={shortcut.label}>
                <a
                  href={shortcut.href}
                  target={shortcut.href.startsWith("http") ? "_blank" : undefined}
                  rel={
                    shortcut.href.startsWith("http") ? "noreferrer" : undefined
                  }
                  className="flex h-full flex-col justify-between gap-6 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-[#0f3b66]/40 hover:shadow-md"
                >
                  <span className="text-[17px] font-bold text-slate-900">
                    {shortcut.label}
                  </span>
                  <span className="inline-flex items-center justify-between gap-2 text-[14px] font-semibold text-slate-500">
                    {shortcut.description}
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 shrink-0 text-[#0f3b66]"
                    />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-[#0f3b66] text-white">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:px-6 lg:grid-cols-[1.6fr_1fr]">
            <div>
              <h2 className="text-2xl font-bold text-white">층별 시설안내</h2>
              <p className="mt-2 text-[15px] text-sky-200">
                교육과 상담, 창업 활동이 한 건물에서 이어집니다.
              </p>
              <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {classicFacilities.map((facility) => (
                  <li
                    key={facility.name}
                    className="rounded-xl border border-white/15 bg-white/5 p-4"
                  >
                    <span className="inline-flex rounded bg-[#f0b429] px-2 py-0.5 text-[13px] font-black text-[#0b2c4d]">
                      {facility.floor}
                    </span>
                    <h3 className="mt-2 text-[17px] font-bold text-white">
                      {facility.name}
                    </h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-sky-100">
                      {facility.description}
                    </p>
                  </li>
                ))}
              </ul>
              <a
                href={CLASSIC_CENTER.facilityHref}
                className="mt-4 inline-flex items-center gap-1 text-[15px] font-bold text-[#f0b429] hover:underline"
              >
                시설 둘러보기
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
            </div>

            <div className="rounded-2xl bg-white p-6 text-slate-900">
              <h2 className="text-xl font-bold text-[#0f3b66]">상담문의</h2>
              <a
                href={`tel:${CLASSIC_CENTER.phone.replace(/-/g, "")}`}
                className="mt-3 flex items-center gap-2 text-3xl font-black tracking-tight text-[#0f3b66] hover:underline"
              >
                <Phone aria-hidden className="size-7 shrink-0" />
                {CLASSIC_CENTER.phone}
              </a>
              <dl className="mt-5 grid gap-3 text-[15px]">
                <div className="flex items-start gap-2">
                  <Clock
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-[#0f3b66]"
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
                    className="mt-0.5 size-4 shrink-0 text-[#0f3b66]"
                  />
                  <dt className="sr-only">오시는 길</dt>
                  <dd>
                    <a
                      href="https://www.5060do.or.kr/subLifeTwist/location"
                      className="font-bold text-[#0f3b66] underline underline-offset-4"
                    >
                      오시는 길 안내 보기
                    </a>
                  </dd>
                </div>
              </dl>
              <a
                href="https://www.5060do.or.kr/subLifeTwist/lifePlanAssay"
                className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#0f3b66] text-[17px] font-bold text-white transition-colors hover:bg-[#0b2c4d]"
              >
                상담 신청하기
                <ArrowRight aria-hidden className="size-5" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-[#0b2239] text-sky-100">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 md:px-6">
          <Image
            src={withBasePath("/assets/logo_footer.png")}
            alt="오륙도인생후반전지원센터"
            width={194}
            height={36}
            className="h-9 w-auto self-start"
          />
          <p className="text-lg font-bold text-white">{CLASSIC_CENTER.name}</p>
          <p className="text-[15px]">
            대표전화 {CLASSIC_CENTER.phone} · {CLASSIC_CENTER.hours}
          </p>
          <p className="text-[14px] text-sky-200/80">
            본 화면은 원본 사이트의 메뉴 구조를 보존한 반응형 시안입니다. 각
            메뉴는 원본 사이트의 해당 페이지로 연결됩니다.
          </p>
          <p className="text-[13px] text-sky-200/60">
            © 2026 오륙도인생후반전지원센터
          </p>
        </div>
      </footer>

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
                className="text-xl font-bold text-[#0f3b66]"
              >
                전체 메뉴
              </h2>
              <button
                ref={drawerCloseRef}
                type="button"
                data-testid="classic-drawer-close"
                onClick={() => setMobileOpen(false)}
                aria-label="전체 메뉴 닫기"
                className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              <div className="flex items-center gap-2 text-[15px] font-bold text-slate-600">
                <a href={CLASSIC_CENTER.mainHref} className="hover:text-[#0f3b66]">
                  로그인
                </a>
                <span aria-hidden className="text-slate-300">
                  |
                </span>
                <a href={CLASSIC_CENTER.mainHref} className="hover:text-[#0f3b66]">
                  회원가입
                </a>
                <a
                  href={CLASSIC_CENTER.mainHref}
                  className="ml-auto rounded-md bg-[#eef3f9] px-2.5 py-1 text-[#0f3b66]"
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
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[16px] focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="통합검색"
                  className="flex size-9 items-center justify-center rounded-md bg-[#0f3b66] text-white"
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
                        <span className="text-[17px] font-bold text-slate-800">
                          {group.label}
                        </span>
                        <ChevronDown
                          aria-hidden
                          className={`size-5 shrink-0 text-slate-400 transition-transform ${
                            isOpen ? "rotate-180 text-[#0f3b66]" : ""
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
                                className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-[16px] font-medium text-slate-600 transition-colors hover:bg-[#eef3f9] hover:text-[#0f3b66]"
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

              <dl className="mt-4 rounded-xl bg-[#f4f6f9] p-4 text-[15px]">
                <div className="flex items-center gap-2">
                  <Phone aria-hidden className="size-4 text-[#0f3b66]" />
                  <dt className="w-16 shrink-0 font-semibold text-slate-500">
                    상담전화
                  </dt>
                  <dd>
                    <a
                      href={`tel:${CLASSIC_CENTER.phone.replace(/-/g, "")}`}
                      className="font-bold text-[#0f3b66] underline underline-offset-4"
                    >
                      {CLASSIC_CENTER.phone}
                    </a>
                  </dd>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Clock aria-hidden className="size-4 text-[#0f3b66]" />
                  <dt className="w-16 shrink-0 font-semibold text-slate-500">
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

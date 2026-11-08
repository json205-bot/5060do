"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GraduationCap,
  Home as HomeIcon,
  LayoutGrid,
  List,
  MapPin,
  Megaphone,
  Menu,
  Phone,
  Search,
  Users,
  Wallet,
  X,
} from "lucide-react";
import VersionSwitcher from "@/components/version-switcher";
import ChatbotWidget from "@/components/ChatbotWidget";
import { useJobs } from "@/hooks/useJobs";
import { usePrograms } from "@/hooks/usePrograms";
import { withBasePath } from "@/lib/basePath";
import {
  JOB_BOARD_TYPES,
  JOB_REGIONS,
  type Job,
  type JobBoardFilter,
  type JobRegionFilter,
} from "@/lib/jobs";
import {
  programPageSize,
  programStatuses,
  type Program,
  type ProgramStatus,
  type StatusFilter,
} from "@/lib/programs";

type Applicant = {
  name: string;
  phone: string;
};

type ModalStage = "detail" | "form" | "done";

type ViewMode = "card" | "list";

const statusStyles: Record<
  ProgramStatus,
  { dot: string; active: string; badge: string; bar: string }
> = {
  접수중: {
    dot: "bg-status-open",
    active: "border-emerald-700 bg-emerald-700 text-white",
    badge: "bg-status-open-soft text-emerald-900",
    bar: "bg-status-open",
  },
  접수예정: {
    dot: "bg-status-ready",
    active: "border-sky-700 bg-sky-700 text-white",
    badge: "bg-status-ready-soft text-sky-900",
    bar: "bg-status-ready",
  },
  대기접수: {
    dot: "bg-status-wait",
    active: "border-amber-700 bg-amber-700 text-white",
    badge: "bg-status-wait-soft text-amber-900",
    bar: "bg-status-wait",
  },
  마감: {
    dot: "bg-status-closed",
    active: "border-slate-700 bg-slate-700 text-white",
    badge: "bg-status-closed-soft text-slate-800",
    bar: "bg-status-closed",
  },
};

const actionLabels: Record<ProgramStatus, string> = {
  접수중: "수강신청",
  접수예정: "접수예정",
  대기접수: "대기신청",
  마감: "모집 마감",
};

const remainingSeats = (program: Program) =>
  Math.max(0, program.capacity - (program.enrolled ?? 0));
const isApplicable = (status: ProgramStatus) =>
  status === "접수중" || status === "대기접수";

const navItems = [
  { label: "교육신청", href: "#programs" },
  { label: "채용정보", href: "#jobs" },
  { label: "공지사항", href: "#notice" },
];

const sectionIds = ["programs", "jobs", "notice"] as const;

const bottomTabs = [
  { key: "home", label: "홈", icon: HomeIcon },
  { key: "programs", label: "교육신청", icon: GraduationCap },
  { key: "jobs", label: "채용정보", icon: Briefcase },
  { key: "notice", label: "공지사항", icon: Megaphone },
  { key: "menu", label: "전체", icon: Menu },
] as const;

type BottomTabKey = (typeof bottomTabs)[number]["key"];

const centerMenuLinks = [
  { label: "센터 소개·인사말", href: "https://www.5060do.or.kr" },
  { label: "신청 방법 안내", href: "https://www.5060do.or.kr/education/lifeEduWay" },
  { label: "채용정보 게시판", href: "https://www.5060do.or.kr/board/lifeFindJob" },
  { label: "공지사항 게시판", href: "https://www.5060do.or.kr/board/lifeNotice" },
];

const notices = [
  {
    id: 1,
    title: "2026년 겨울학기 교육 프로그램 수강생 모집 안내",
    date: "2026-11-05",
    tag: "모집",
  },
  {
    id: 2,
    title: "센터 이용자 대상 스마트폰 활용 무료 상담 운영",
    date: "2026-11-02",
    tag: "안내",
  },
  {
    id: 3,
    title: "주차장 공사에 따른 임시 주차 안내",
    date: "2026-10-28",
    tag: "안내",
  },
];

const formatFee = (fee: number) =>
  fee > 0 ? `${fee.toLocaleString("ko-KR")}원` : "무료";

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};

export default function Home() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("전체");
  const {
    programs,
    overview,
    activePrograms,
    loadActivePrograms,
    counts,
    source: programsSource,
    total,
    hasMore,
    loading,
    loadingMore,
    loadMore,
  } = usePrograms(statusFilter);
  const [jobBoardFilter, setJobBoardFilter] = useState<JobBoardFilter>("전체");
  const [jobRegionFilter, setJobRegionFilter] = useState<JobRegionFilter>("전체");
  const [jobQuery, setJobQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const {
    jobs,
    counts: jobCounts,
    source: jobsSource,
    total: jobTotal,
    hasMore: jobsHasMore,
    loading: jobsLoading,
    loadingMore: jobsLoadingMore,
    loadMore: loadMoreJobs,
  } = useJobs({
    boardType: jobBoardFilter,
    region: jobRegionFilter,
    query: jobQuery,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stage, setStage] = useState<ModalStage>("detail");
  const [applicant, setApplicant] = useState<Applicant>({ name: "", phone: "" });
  const [errors, setErrors] = useState<Partial<Applicant>>({});
  const [receipt, setReceipt] = useState<string | null>(null);
  const [approvedAmount, setApprovedAmount] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<string>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalPanelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastFocusedRef = useRef<Element | null>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const menuLastFocusedRef = useRef<Element | null>(null);
  const pendingScrollRef = useRef<string | null>(null);

  const selected = useMemo(
    () => programs.find((program) => program.id === selectedId) ?? null,
    [programs, selectedId],
  );

  const selectedJob = useMemo<Job | null>(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const remainingCount = Math.max(0, total - programs.length);
  const jobRemainingCount = Math.max(0, jobTotal - jobs.length);

  const handleStatusFilter = (status: StatusFilter) => {
    setStatusFilter(status);
  };

  const closeModal = useCallback(() => {
    setSelectedId(null);
    setStage("detail");
    setApplicant({ name: "", phone: "" });
    setErrors({});
    setReceipt(null);
    setApprovedAmount(null);
    if (lastFocusedRef.current instanceof HTMLElement) {
      lastFocusedRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    lastFocusedRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selected, closeModal]);

  useEffect(() => {
    if (!selected) return;
    modalPanelRef.current?.scrollTo({ top: 0 });
    if (stage === "form") nameInputRef.current?.focus();
  }, [selected, stage]);

  useEffect(() => {
    if (!selectedJob) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedJobId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedJob]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = 140;
      let next = "home";
      for (const id of sectionIds) {
        const element = document.getElementById(id);
        if (!element) continue;
        if (element.getBoundingClientRect().top - offset <= 0) next = id;
      }
      setActiveSection((current) => (current === next ? current : next));
    };
    const handleScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    menuLastFocusedRef.current = document.activeElement;
    menuCloseRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (menuLastFocusedRef.current instanceof HTMLElement) {
        menuLastFocusedRef.current.focus();
      }
    };
  }, [menuOpen]);

  const scrollToSection = useCallback((id: string) => {
    if (id === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setActiveSection("home");
      return;
    }
    const element = document.getElementById(id);
    if (!element) return;
    setActiveSection(id);
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (menuOpen) return;
    const pending = pendingScrollRef.current;
    if (!pending) return;
    pendingScrollRef.current = null;
    const frame = window.requestAnimationFrame(() => scrollToSection(pending));
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen, scrollToSection]);

  const handleTabClick = (key: BottomTabKey) => {
    if (key === "menu") {
      setMenuOpen(true);
      return;
    }
    scrollToSection(key);
  };

  const handleMenuShortcut = (id: string) => {
    pendingScrollRef.current = id;
    setMenuOpen(false);
  };

  const openProgram = (program: Program) => {
    setSelectedId(program.id);
    setStage("detail");
    setApplicant({ name: "", phone: "" });
    setErrors({});
    setReceipt(null);
    setApprovedAmount(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Partial<Applicant> = {};
    if (applicant.name.trim().length < 2) {
      nextErrors.name = "성명을 두 글자 이상 입력해 주세요.";
    }
    if (!/^0\d{1,2}-\d{3,4}-\d{4}$/.test(applicant.phone)) {
      nextErrors.phone = "연락처를 정확히 입력해 주세요. 예) 010-1234-5678";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setStage("form");
  };

  const handlePayment = () => {
    if (!selected) return;
    const newReceipt = `5060-${String(Date.now()).slice(-8)}`;
    const approved = selected.fee;
    const message =
      approved > 0
        ? `테스트 결제 승인 완료\n\n${selected.title}\n결제 금액 ${formatFee(approved)}\n(실제 결제가 이루어지지 않는 프로토타입입니다.)`
        : `테스트 결제 승인 완료\n\n${selected.title}\n무료 강좌로 결제 금액은 0원입니다.`;

    console.log("[prototype] fake payment approved", {
      programId: selected.id,
      programTitle: selected.title,
      applicant: applicant.name,
      phone: applicant.phone,
      amount: approved,
      receipt: newReceipt,
    });

    window.alert(message);
    setReceipt(newReceipt);
    setApprovedAmount(approved);
    setStage("done");
  };

  return (
    <div className="flex min-h-screen flex-col pb-20 md:pb-0">
      <VersionSwitcher current="modern" />
      <header className="sticky top-0 z-40 h-[72px] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-2 px-4 py-2 md:flex-row md:items-center md:justify-between md:gap-6 md:px-6">
          <a
            href="#top"
            className="flex touch-target items-center gap-3"
            aria-label="오륙도인생후반전지원센터 홈으로 이동"
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
          <nav aria-label="주요 메뉴" className="hidden w-full md:block md:w-auto">
            <ul className="grid grid-cols-3 gap-1 md:flex md:items-center md:gap-2">
              {navItems.map((item, index) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={index === 0 ? "page" : undefined}
                    className={`flex min-h-[52px] items-center justify-center rounded-xl px-2 text-base font-semibold transition-colors md:px-4 ${
                      index === 0
                        ? "bg-brand-50 text-brand-800"
                        : "text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="top" className="flex-1">
        <section className="border-b border-brand-100 bg-brand-800 text-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6 md:py-16">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">
              <Megaphone aria-hidden className="size-4" />
              2026 겨울학기 수강생 모집 중
            </p>
            <h1 className="mt-5 text-3xl font-bold leading-snug md:text-4xl">
              배움으로 다시 시작하는
              <br />
              인생 후반전
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-brand-50">
              50~60대 신중년을 위한 교육 프로그램을 한눈에 확인하고, 큰 글씨와
              큰 버튼으로 간편하게 신청하세요.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#programs"
                className="flex cta-primary items-center justify-center gap-2 rounded-2xl bg-accent-500 px-6 text-lg font-bold text-brand-900 transition-colors hover:bg-accent-600"
              >
                지금 수강신청 하기
                <ChevronRight aria-hidden className="size-5" />
              </a>
              <a
                href="https://www.5060do.or.kr/education/lifeEduWay"
                target="_blank"
                rel="noreferrer"
                className="flex cta-primary items-center justify-center gap-2 rounded-2xl border-2 border-white/40 px-6 text-lg font-semibold text-white transition-colors hover:bg-white/10"
              >
                신청 방법 안내
                <ArrowUpRight aria-hidden className="size-5" />
              </a>
            </div>
          </div>
        </section>

        <section aria-label="센터 이용 안내" className="bg-white">
          <div className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-6 sm:grid-cols-3 md:px-6">
            {[
              { icon: Phone, label: "상담전화", value: "051-000-0000 (예시)" },
              { icon: Clock, label: "운영시간", value: "평일 09:00 ~ 18:00" },
              { icon: MapPin, label: "위치", value: "부산 남구 오륙도 일대 (예시)" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-2xl bg-canvas px-4 py-4"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-800">
                  <item.icon aria-hidden className="size-5" />
                </span>
                <p className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-900">
                    {item.label}
                  </span>
                  <span className="text-base font-semibold text-slate-800">
                    {item.value}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="programs"
          aria-labelledby="programs-heading"
          data-programs-source={programsSource}
          className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-base font-semibold text-brand-700">
                교육 프로그램
              </p>
              <h2
                id="programs-heading"
                className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl"
              >
                지금 신청할 수 있는 강좌
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:justify-end">
              <p
                role="status"
                aria-live="polite"
                data-testid="program-result-count"
                className="text-base text-slate-900"
              >
                {statusFilter === "전체" ? "전체" : statusFilter}{" "}
                <span className="font-bold text-brand-700">
                  {total}개
                </span>{" "}
                강좌
              </p>
              <div
                role="group"
                aria-label="보기 방식"
                className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1"
              >
                <button
                  type="button"
                  data-testid="view-toggle-card"
                  aria-pressed={viewMode === "card"}
                  onClick={() => setViewMode("card")}
                  className={`flex touch-target items-center gap-2 rounded-xl px-4 text-base font-bold transition-colors ${
                    viewMode === "card"
                      ? "bg-white text-brand-800 shadow-sm"
                      : "text-slate-900 hover:text-slate-900"
                  }`}
                >
                  <LayoutGrid aria-hidden className="size-5" />
                  카드형
                </button>
                <button
                  type="button"
                  data-testid="view-toggle-list"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                  className={`flex touch-target items-center gap-2 rounded-xl px-4 text-base font-bold transition-colors ${
                    viewMode === "list"
                      ? "bg-white text-brand-800 shadow-sm"
                      : "text-slate-900 hover:text-slate-900"
                  }`}
                >
                  <List aria-hidden className="size-5" />
                  목록형
                </button>
              </div>
            </div>
          </div>

          <div
            role="group"
            aria-label="접수 상태 필터"
            data-testid="status-chips"
            className="mt-6 flex flex-wrap items-center gap-2"
          >
            {(["전체", ...programStatuses] as const).map((status) => {
              const active = statusFilter === status;
              const style = status === "전체" ? null : statusStyles[status];
              return (
                <button
                  key={status}
                  type="button"
                  data-testid={`status-chip-${status}`}
                  aria-pressed={active}
                  onClick={() => handleStatusFilter(status)}
                  className={`inline-flex min-h-[52px] items-center gap-2 rounded-full border-2 px-4 text-base font-bold transition-colors ${
                    active
                      ? style
                        ? style.active
                        : "border-brand-700 bg-brand-700 text-white"
                      : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {style && (
                    <span
                      aria-hidden
                      className={`size-2.5 rounded-full ${
                        active ? "bg-white" : style.dot
                      }`}
                    />
                  )}
                  <span>{status}</span>
                  <span
                    className={`text-sm font-bold ${
                      active ? "text-white" : "text-slate-900"
                    }`}
                  >
                    [{counts[status]}]
                  </span>
                </button>
              );
            })}
          </div>

          {total === 0 && !loading ? (
            <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-lg font-semibold text-slate-900">
              해당 상태의 강좌가 없습니다.
            </p>
          ) : programs.length === 0 ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-lg font-semibold text-slate-900"
            >
              강좌를 불러오는 중입니다.
            </p>
          ) : viewMode === "card" ? (
            <ul
              data-testid="program-grid"
              className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
            >
              {programs.map((program) => {
                const style = statusStyles[program.status];
                const applicable = isApplicable(program.status);
                const waiting = program.status === "대기접수";
                const seatTotal =
                  program.enrolled === undefined
                    ? program.capacity
                    : Math.max(program.capacity, program.enrolled);
                const rate =
                  program.enrolled === undefined || seatTotal <= 0
                    ? 0
                    : Math.min(
                        100,
                        Math.round((program.enrolled / seatTotal) * 100),
                      );
                return (
                  <li key={program.id} className="flex">
                    <button
                      type="button"
                      data-testid="program-card"
                      data-status={program.status}
                      onClick={() => openProgram(program)}
                      aria-haspopup="dialog"
                      className="group flex w-full flex-col rounded-card border border-slate-200 bg-white p-[24px] text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-800">
                          {program.category}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-bold ${style.badge}`}
                        >
                          {program.status}
                        </span>
                      </div>
                      <h3 className="mt-4 text-xl font-bold leading-snug text-slate-900">
                        {program.title}
                      </h3>
                      {program.summary && (
                        <p className="mt-2 line-clamp-2 text-base leading-relaxed text-slate-900">
                          {program.summary}
                        </p>
                      )}

                      <dl className="mt-4 space-y-2 text-base text-slate-900">
                        <div className="flex items-start gap-2">
                          <CalendarDays
                            aria-hidden
                            className="mt-0.5 size-5 shrink-0 text-brand-600"
                          />
                          <dt className="sr-only">교육기간</dt>
                          <dd>{program.eduPeriod}</dd>
                        </div>
                        <div className="flex items-start gap-2">
                          <MapPin
                            aria-hidden
                            className="mt-0.5 size-5 shrink-0 text-brand-600"
                          />
                          <dt className="sr-only">교육장소</dt>
                          <dd>{program.location}</dd>
                        </div>
                        <div className="flex items-start gap-2">
                          <Wallet
                            aria-hidden
                            className="mt-0.5 size-5 shrink-0 text-brand-600"
                          />
                          <dt className="sr-only">수강료</dt>
                          <dd className="font-semibold text-slate-900">
                            {formatFee(program.fee)}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-5">
                        {program.enrolled === undefined ? (
                          <p className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                            <Users aria-hidden className="size-4" />
                            정원 {program.capacity}명
                          </p>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
                              <span className="inline-flex items-center gap-1">
                                <Users aria-hidden className="size-4" />
                                {waiting ? "대기" : "신청"} {program.enrolled}명 /
                                정원 {program.capacity}명
                              </span>
                              <span
                                className={
                                  remainingSeats(program) === 0 && !waiting
                                    ? "font-bold text-red-700"
                                    : "font-bold text-brand-800"
                                }
                              >
                                {waiting
                                  ? `대기 ${program.enrolled}명 접수중`
                                  : `잔여 ${remainingSeats(program)}석`}
                              </span>
                            </div>
                            <div
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={seatTotal}
                              aria-valuenow={Math.min(
                                program.enrolled,
                                seatTotal,
                              )}
                              aria-label={`${program.title} ${waiting ? "대기" : "신청"} 현황`}
                              className="mt-2 h-[10px] w-full overflow-hidden rounded-full bg-slate-200"
                            >
                              <div
                                className={`h-full rounded-full ${style.bar}`}
                                style={{ width: `${rate}%` }}
                              />
                            </div>
                          </>
                        )}
                      </div>

                      <span
                        className={`mt-5 flex cta-primary items-center justify-center gap-1 rounded-2xl text-lg font-bold ${
                          applicable
                            ? "bg-brand-700 text-white group-hover:bg-brand-800"
                            : "bg-slate-200 text-slate-800"
                        }`}
                      >
                        {program.status === "마감"
                          ? "모집 마감"
                          : program.status === "접수예정"
                            ? "접수예정"
                            : "상세보기"}
                        {applicable && (
                          <ChevronRight aria-hidden className="size-5" />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <div
                data-testid="program-table"
                className="mt-6 hidden overflow-hidden rounded-3xl border border-slate-200 bg-white lg:block"
              >
                <table className="w-full table-fixed border-collapse text-left">
                  <caption className="sr-only">교육 프로그램 목록</caption>
                  <thead>
                    <tr className="bg-brand-50 text-sm font-bold text-brand-900">
                      <th scope="col" className="w-[8%] px-3 py-3">
                        상태
                      </th>
                      <th scope="col" className="w-[8%] px-3 py-3">
                        분야
                      </th>
                      <th scope="col" className="px-3 py-3">
                        강좌명
                      </th>
                      <th scope="col" className="w-[15%] px-3 py-3">
                        교육기간/일시
                      </th>
                      <th scope="col" className="w-[14%] px-3 py-3">
                        장소
                      </th>
                      <th scope="col" className="w-[10%] px-3 py-3">
                        정원(잔여)
                      </th>
                      <th scope="col" className="w-[8%] px-3 py-3">
                        수강료
                      </th>
                      <th scope="col" className="w-[10%] px-3 py-3">
                        신청
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {programs.map((program) => (
                      <tr
                        key={program.id}
                        data-testid="program-row"
                        data-status={program.status}
                        className="align-top transition-colors hover:bg-brand-50/60"
                      >
                        <td className="px-3 py-4">
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-bold ${statusStyles[program.status].badge}`}
                          >
                            {program.status}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-slate-900">
                          {program.category}
                        </td>
                        <td className="px-3 py-4">
                          <button
                            type="button"
                            onClick={() => openProgram(program)}
                            className="text-left text-lg font-bold leading-snug text-slate-900 underline-offset-4 hover:text-brand-700 hover:underline"
                          >
                            {program.title}
                          </button>
                        </td>
                        <td className="px-3 py-4 text-slate-900">
                          {program.eduPeriod}
                        </td>
                        <td className="px-3 py-4 text-slate-900">
                          {program.location}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-slate-900">
                          {program.enrolled === undefined
                            ? `${program.capacity}명`
                            : program.status === "대기접수"
                              ? `${program.capacity}명 (대기 ${program.enrolled}명)`
                              : `${program.capacity}명 (${remainingSeats(program)}석)`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 font-semibold text-slate-900">
                          {formatFee(program.fee)}
                        </td>
                        <td className="px-3 py-4">
                          <button
                            type="button"
                            onClick={() => openProgram(program)}
                            className={`flex touch-target w-full items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm font-bold transition-colors ${
                              isApplicable(program.status)
                                ? "bg-brand-700 text-white hover:bg-brand-800"
                                : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                            }`}
                          >
                            {actionLabels[program.status]}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul
                data-testid="program-list-mobile"
                className="mt-6 grid gap-3 lg:hidden"
              >
                {programs.map((program) => (
                  <li key={program.id}>
                    <button
                      type="button"
                      data-testid="program-row-mobile"
                      data-status={program.status}
                      onClick={() => openProgram(program)}
                      aria-haspopup="dialog"
                      className="flex w-full flex-col gap-2.5 rounded-[20px] border border-slate-200 bg-white p-[18px] text-left shadow-sm transition hover:border-brand-300 hover:shadow-md"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-sm font-bold ${statusStyles[program.status].badge}`}
                        >
                          {program.status}
                        </span>
                        <span className="text-sm font-semibold text-slate-900">
                          {program.category}
                        </span>
                      </span>
                      <span className="text-lg font-bold leading-snug text-slate-900">
                        {program.title}
                      </span>
                      <span className="flex flex-wrap gap-x-3 gap-y-1 text-base text-slate-900">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays
                            aria-hidden
                            className="size-4 text-brand-600"
                          />
                          {program.eduPeriod}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin
                            aria-hidden
                            className="size-4 text-brand-600"
                          />
                          {program.location}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2 text-base">
                        <span className="font-semibold text-slate-900">
                          {program.enrolled === undefined
                            ? `정원 ${program.capacity}명`
                            : program.status === "대기접수"
                              ? `정원 ${program.capacity}명 · 대기 ${program.enrolled}명 접수중`
                              : `정원 ${program.capacity}명 · 잔여 ${remainingSeats(program)}석`}
                        </span>
                        <span className="font-bold text-slate-900">
                          {formatFee(program.fee)}
                        </span>
                      </span>
                      <span
                        className={`mt-1 flex min-h-[52px] items-center justify-center rounded-xl text-base font-bold ${
                          isApplicable(program.status)
                            ? "bg-brand-700 text-white"
                            : "bg-slate-200 text-slate-800"
                        }`}
                      >
                        {actionLabels[program.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!loading && total > 0 && hasMore && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                data-testid="load-more-programs"
                onClick={loadMore}
                disabled={loadingMore}
                aria-busy={loadingMore}
                className="flex cta-primary w-full max-w-md items-center justify-center gap-2 rounded-2xl border-2 border-brand-700 bg-white px-6 text-lg font-bold text-brand-800 transition-colors hover:bg-brand-50 disabled:cursor-wait disabled:border-slate-300 disabled:text-slate-700"
              >
                {loadingMore
                  ? "강좌를 불러오는 중입니다"
                  : `더 많은 강좌 보기 (+${Math.min(programPageSize, remainingCount)}개)`}
                <ChevronDown aria-hidden className="size-5" />
              </button>
              <p
                data-testid="programs-shown-count"
                className="text-base text-slate-900"
              >
                {programs.length}개 표시 중 · 남은 강좌 {remainingCount}개
              </p>
            </div>
          )}
        </section>

        <section
          id="jobs"
          aria-labelledby="jobs-heading"
          data-jobs-source={jobsSource}
          className="bg-brand-50"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="flex items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-white">
                  <Briefcase aria-hidden className="size-6" />
                </span>
                <div>
                  <p className="text-base font-semibold text-brand-700">
                    일자리 정보
                  </p>
                  <h2
                    id="jobs-heading"
                    className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl"
                  >
                    채용정보
                  </h2>
                  <p className="mt-1 text-base text-slate-900">
                    신중년 맞춤 구인·취업지원·창업·사회공헌 소식을 한곳에서
                    확인하세요.
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                <p
                  role="status"
                  aria-live="polite"
                  data-testid="job-result-count"
                  className="text-base text-slate-900"
                >
                  {jobBoardFilter === "전체" ? "전체" : jobBoardFilter}{" "}
                  <span className="font-bold text-brand-700">{jobTotal}건</span>
                </p>
                <a
                  href="https://www.5060do.or.kr/board/lifeFindJob"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex touch-target items-center gap-1 text-base font-bold text-brand-800 underline decoration-brand-300 underline-offset-4 hover:text-brand-900"
                >
                  원본 게시판
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
              </div>
            </div>

            <label className="mt-6 flex cta-primary items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 focus-within:border-brand-500">
              <Search aria-hidden className="size-5 shrink-0 text-brand-700" />
              <span className="sr-only">채용정보 검색</span>
              <input
                type="search"
                data-testid="job-search"
                value={jobQuery}
                onChange={(event) => setJobQuery(event.target.value)}
                placeholder="공고 제목이나 내용으로 검색"
                className="w-full bg-transparent py-3 text-base text-slate-900 outline-none placeholder:text-slate-500"
              />
            </label>

            <div
              role="group"
              aria-label="채용정보 분류"
              data-testid="job-board-chips"
              className="mt-4 flex flex-wrap items-center gap-2"
            >
              {(["전체", ...JOB_BOARD_TYPES] as const).map((boardType) => {
                const active = jobBoardFilter === boardType;
                return (
                  <button
                    key={boardType}
                    type="button"
                    data-testid={`job-board-chip-${boardType}`}
                    aria-pressed={active}
                    onClick={() => setJobBoardFilter(boardType)}
                    className={`inline-flex touch-target items-center gap-2 rounded-full border-2 px-4 text-base font-bold transition-colors ${
                      active
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span>{boardType}</span>
                    <span
                      className={`text-sm font-bold ${
                        active ? "text-white" : "text-slate-700"
                      }`}
                    >
                      [{jobCounts.board[boardType]}]
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              role="group"
              aria-label="지역 필터"
              data-testid="job-region-chips"
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              {(["전체", ...JOB_REGIONS] as const).map((region) => {
                const active = jobRegionFilter === region;
                return (
                  <button
                    key={region}
                    type="button"
                    data-testid={`job-region-chip-${region}`}
                    aria-pressed={active}
                    onClick={() => setJobRegionFilter(region)}
                    className={`inline-flex touch-target items-center gap-2 rounded-full border-2 px-4 text-base font-bold transition-colors ${
                      active
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span>{region === "기타" ? "기타 지역" : region}</span>
                    <span
                      className={`text-sm font-bold ${
                        active ? "text-white" : "text-slate-700"
                      }`}
                    >
                      [{jobCounts.region[region]}]
                    </span>
                  </button>
                );
              })}
            </div>

            {jobsLoading ? (
              <p
                role="status"
                aria-live="polite"
                className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-lg font-semibold text-slate-900"
              >
                채용정보를 불러오는 중입니다.
              </p>
            ) : jobs.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-lg font-semibold text-slate-900">
                조건에 맞는 채용정보가 없습니다.
              </p>
            ) : (
              <ul
                data-testid="job-list"
                className="mt-6 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white"
              >
                {jobs.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      data-testid="job-card"
                      data-region={job.region}
                      data-board-type={job.boardType}
                      aria-haspopup="dialog"
                      onClick={() => setSelectedJobId(job.id)}
                      className="flex w-full flex-col gap-2 px-4 py-4 text-left transition-colors hover:bg-brand-50 md:flex-row md:items-center md:justify-between md:px-6"
                    >
                      <span className="flex min-w-0 flex-col gap-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-brand-100 px-2.5 py-1 text-sm font-bold text-brand-800">
                            {job.boardType}
                          </span>
                          <span className="text-lg font-semibold text-slate-900">
                            {job.title}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-3 text-base text-slate-900">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays
                              aria-hidden
                              className="size-4 text-brand-600"
                            />
                            {job.date}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin
                              aria-hidden
                              className="size-4 text-brand-600"
                            />
                            {job.region === "부산" ? "부산" : "기타 지역"}
                          </span>
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden
                        className="size-5 shrink-0 text-slate-500"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!jobsLoading && jobsHasMore && (
              <div className="mt-6 flex flex-col items-center gap-3">
                <button
                  type="button"
                  data-testid="load-more-jobs"
                  onClick={loadMoreJobs}
                  disabled={jobsLoadingMore}
                  aria-busy={jobsLoadingMore}
                  className="flex cta-primary w-full max-w-md items-center justify-center gap-2 rounded-2xl border-2 border-brand-700 bg-white px-6 text-lg font-bold text-brand-800 transition-colors hover:bg-brand-50 disabled:cursor-wait disabled:border-slate-300 disabled:text-slate-700"
                >
                  {jobsLoadingMore
                    ? "채용정보를 불러오는 중입니다"
                    : `채용정보 더 보기 (+${Math.min(12, jobRemainingCount)}건)`}
                  <ChevronDown aria-hidden className="size-5" />
                </button>
                <p
                  data-testid="jobs-shown-count"
                  className="text-base text-slate-900"
                >
                  {jobs.length}건 표시 중 · 남은 채용정보 {jobRemainingCount}건
                </p>
              </div>
            )}
          </div>
        </section>

        <section
          id="notice"
          aria-labelledby="notice-heading"
          className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14"
        >
          <h2
            id="notice-heading"
            className="text-2xl font-bold text-slate-900 md:text-3xl"
          >
            공지사항
          </h2>
          <ul className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white">
            {notices.map((notice) => (
              <li key={notice.id}>
                <a
                  href="https://www.5060do.or.kr/board/lifeNotice"
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-16 flex-col justify-center gap-1 px-4 py-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between md:px-6"
                >
                  <span className="flex items-center gap-3">
                    <span className="rounded-lg bg-accent-100 px-2.5 py-1 text-sm font-bold text-accent-700">
                      {notice.tag}
                    </span>
                    <span className="text-lg font-semibold text-slate-800">
                      {notice.title}
                    </span>
                  </span>
                  <span className="text-base text-slate-900">
                    {notice.date}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-brand-900 text-brand-100">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 md:px-6">
          <Image
            src={withBasePath("/assets/logo_footer.png")}
            alt="오륙도인생후반전지원센터"
            width={194}
            height={36}
            className="h-9 w-auto self-start"
          />
          <p className="text-lg font-bold text-white">
            오륙도인생후반전지원센터
          </p>
          <p className="text-base">평일 09:00 ~ 18:00 · 점심시간 12:00 ~ 13:00</p>
          <p className="text-sm text-brand-200">
            본 화면은 수강신청 흐름 검증을 위한 프로토타입이며, 실제 결제는
            이루어지지 않습니다. 표시된 연락처와 위치는 예시입니다.
          </p>
        </div>
      </footer>

      <nav
        aria-label="모바일 하단 메뉴"
        data-testid="bottom-nav"
        className="fixed bottom-0 left-0 right-0 z-40 h-[64px] border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid h-full grid-cols-5">
          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive =
              tab.key === "menu" ? menuOpen : !menuOpen && activeSection === tab.key;
            return (
              <li key={tab.key}>
                <button
                  type="button"
                  data-testid={`bottom-tab-${tab.key}`}
                  aria-current={isActive ? "page" : undefined}
                  aria-expanded={tab.key === "menu" ? menuOpen : undefined}
                  aria-haspopup={tab.key === "menu" ? "dialog" : undefined}
                  onClick={() => handleTabClick(tab.key)}
                  className={`relative flex h-full touch-target min-w-[48px] w-full flex-col items-center justify-center gap-1 transition-colors ${
                    isActive
                      ? "text-brand-700"
                      : "text-slate-900 hover:text-brand-700"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`absolute inset-x-3 top-0 h-1 rounded-b-full ${
                      isActive ? "bg-brand-700" : "bg-transparent"
                    }`}
                  />
                  <Icon
                    aria-hidden
                    className="size-6"
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  <span
                    data-tab-label=""
                      className="text-xs font-bold leading-none"
                  >
                    {tab.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {menuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 md:hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) setMenuOpen(false);
          }}
        >
          <div
            ref={menuPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-drawer-title"
            data-testid="menu-drawer"
            className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="menu-drawer-title"
                className="text-2xl font-bold text-slate-900"
              >
                전체 메뉴
              </h2>
              <button
                ref={menuCloseRef}
                type="button"
                data-testid="menu-drawer-close"
                onClick={() => setMenuOpen(false)}
                aria-label="전체 메뉴 닫기"
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-900 transition-colors hover:bg-slate-200"
              >
                <X aria-hidden className="size-6" />
              </button>
            </div>

            <p className="mt-4 text-base font-bold text-slate-900">바로가기</p>
            <div className="mt-2 grid gap-2">
              {[
                { id: "programs", label: "교육신청", icon: GraduationCap },
                { id: "jobs", label: "채용정보", icon: Briefcase },
                { id: "notice", label: "공지사항", icon: Megaphone },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`menu-shortcut-${item.id}`}
                  onClick={() => handleMenuShortcut(item.id)}
                  className="flex cta-primary items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 text-lg font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                >
                  <span className="flex items-center gap-3">
                    <item.icon
                      aria-hidden
                      className="size-5 shrink-0 text-brand-700"
                    />
                    {item.label}
                  </span>
                  <ChevronRight aria-hidden className="size-5 text-slate-600" />
                </button>
              ))}
            </div>

            <p className="mt-5 text-base font-bold text-slate-900">
              센터 안내
            </p>
            <div className="mt-2 grid gap-2">
              {centerMenuLinks.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex cta-primary items-center justify-between gap-3 rounded-2xl bg-canvas px-4 text-lg font-semibold text-slate-800 transition-colors hover:bg-brand-50"
                >
                  {item.label}
                  <ArrowUpRight
                    aria-hidden
                    className="size-5 shrink-0 text-brand-700"
                  />
                </a>
              ))}
            </div>

            <p className="mt-5 text-base font-bold text-slate-900">
              상담·오시는 길
            </p>
            <dl className="mt-2 grid gap-2 rounded-2xl bg-canvas p-4 text-base">
              <div className="flex items-center gap-3">
                <Phone aria-hidden className="size-5 shrink-0 text-brand-700" />
                <dt className="w-20 shrink-0 font-semibold text-slate-900">
                  상담전화
                </dt>
                <dd>
                  <a
                    href="tel:0510000000"
                    data-testid="menu-phone-link"
                    className="inline-flex touch-target items-center font-bold text-brand-700 underline underline-offset-4"
                  >
                    051-000-0000 (예시)
                  </a>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Clock aria-hidden className="size-5 shrink-0 text-brand-700" />
                <dt className="w-20 shrink-0 font-semibold text-slate-900">
                  운영시간
                </dt>
                <dd className="font-semibold text-slate-800">
                  평일 09:00 ~ 18:00
                </dd>
              </div>
              <div className="flex items-start gap-3">
                <MapPin
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-brand-700"
                />
                <dt className="w-20 shrink-0 font-semibold text-slate-900">
                  오시는 길
                </dt>
                <dd className="font-semibold text-slate-800">
                  부산 남구 오륙도 일대 (예시)
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div
            ref={modalPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="program-dialog-title"
            data-testid="detail-modal"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-800">
                    {selected.category}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-bold ${statusStyles[selected.status].badge}`}
                  >
                    {selected.status}
                  </span>
                </div>
                <h2
                  id="program-dialog-title"
                  className="mt-3 text-2xl font-bold leading-snug text-slate-900"
                >
                  {selected.title}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeModal}
                aria-label="상세 창 닫기"
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-900 transition-colors hover:bg-slate-200"
              >
                <X aria-hidden className="size-6" />
              </button>
            </div>

            {stage === "done" ? (
              <div data-testid="done-panel" className="py-6 text-center">
                <CheckCircle2
                  aria-hidden
                  className="mx-auto size-16 text-emerald-600"
                />
                <h3 className="mt-4 text-2xl font-bold text-slate-900">
                  신청이 완료되었습니다
                </h3>
                <p className="mt-2 text-lg text-slate-900">
                  {applicant.name}님, 접수번호는{" "}
                  <span className="font-bold text-brand-700">{receipt}</span>{" "}
                  입니다.
                </p>
                <dl className="mt-6 space-y-2 rounded-2xl bg-canvas p-4 text-left text-base">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-900">강좌명</dt>
                    <dd className="text-right font-semibold text-slate-900">
                      {selected.title}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-900">교육기간</dt>
                    <dd className="text-right font-semibold text-slate-900">
                      {selected.eduPeriod}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-900">결제 금액</dt>
                    <dd className="text-right font-semibold text-slate-900">
                      {formatFee(approvedAmount ?? selected.fee)}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={closeModal}
                  className="mt-6 flex cta-primary w-full items-center justify-center rounded-2xl bg-brand-700 text-lg font-bold text-white transition-colors hover:bg-brand-800"
                >
                  확인
                </button>
              </div>
            ) : (
              <>
                {stage === "detail" && (
                  <>
                <dl className="mt-5 grid grid-cols-1 gap-3 rounded-2xl bg-canvas p-4 text-base sm:grid-cols-2">
                  <div className="flex items-start gap-2">
                    <CalendarDays
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0 text-brand-600"
                    />
                    <div>
                      <dt className="text-sm font-semibold text-slate-900">
                        신청기간
                      </dt>
                      <dd className="font-semibold text-slate-800">
                        {selected.applyPeriod}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CalendarDays
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0 text-brand-600"
                    />
                    <div>
                      <dt className="text-sm font-semibold text-slate-900">
                        교육기간
                      </dt>
                      <dd className="font-semibold text-slate-800">
                        {selected.eduPeriod}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0 text-brand-600"
                    />
                    <div>
                      <dt className="text-sm font-semibold text-slate-900">
                        교육장소
                      </dt>
                      <dd className="font-semibold text-slate-800">
                        {selected.location}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0 text-brand-600"
                    />
                    <div>
                      <dt className="text-sm font-semibold text-slate-900">
                        정원 / 신청
                      </dt>
                      <dd className="font-semibold text-slate-800">
                        {selected.capacity}명 /{" "}
                        {selected.enrolled === undefined
                          ? "신청 현황 없음"
                          : selected.status === "대기접수"
                            ? `대기 ${selected.enrolled}명`
                            : `${selected.enrolled}명`}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0 text-brand-600"
                    />
                    <div>
                      <dt className="text-sm font-semibold text-slate-900">
                        신청 대상
                      </dt>
                      <dd className="font-semibold text-slate-800">
                        {selected.target}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Wallet
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0 text-brand-600"
                    />
                    <div>
                      <dt className="text-sm font-semibold text-slate-900">
                        수강료
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {formatFee(selected.fee)}
                      </dd>
                    </div>
                  </div>
                </dl>

                <p className="mt-4 text-base leading-relaxed text-slate-900">
                  {selected.summary}
                </p>
                  </>
                )}

                {stage === "form" && (
                  <dl className="mt-5 grid gap-2 rounded-2xl bg-canvas p-4 text-base">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 font-semibold text-slate-900">
                        교육기간
                      </dt>
                      <dd className="font-semibold text-slate-800">
                        {selected.eduPeriod}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 font-semibold text-slate-900">
                        교육장소
                      </dt>
                      <dd className="font-semibold text-slate-800">
                        {selected.location}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 font-semibold text-slate-900">
                        수강료
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {formatFee(selected.fee)}
                      </dd>
                    </div>
                  </dl>
                )}

                {stage === "detail" ? (
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setStage("form")}
                      disabled={!isApplicable(selected.status)}
                      className="flex cta-primary flex-1 items-center justify-center rounded-2xl bg-brand-700 text-lg font-bold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-900"
                    >
                      {actionLabels[selected.status]}
                    </button>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="flex cta-primary items-center justify-center rounded-2xl border-2 border-slate-300 px-6 text-lg font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                    >
                      닫기
                    </button>
                  </div>
                ) : (
                  <form
                    data-testid="apply-form"
                    onSubmit={handleSubmit}
                    noValidate
                    className="mt-6 flex flex-col gap-4"
                  >
                    <div>
                      <label
                        htmlFor="applicant-name"
                        className="text-base font-bold text-slate-800"
                      >
                        성명
                      </label>
                      <input
                        id="applicant-name"
                        name="name"
                        data-testid="apply-name"
                        ref={nameInputRef}
                        type="text"
                        autoComplete="name"
                        value={applicant.name}
                        onChange={(event) =>
                          setApplicant((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="신청자 성명"
                        aria-invalid={Boolean(errors.name)}
                        aria-describedby={errors.name ? "name-error" : undefined}
                        className="mt-2 min-h-[52px] w-full rounded-xl border-2 border-slate-300 px-4 text-base text-slate-900 placeholder:text-slate-600 focus:border-brand-600 focus:outline-none"
                      />
                      {errors.name && (
                        <p
                          id="name-error"
                          className="mt-2 text-base font-semibold text-red-700"
                        >
                          {errors.name}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor="applicant-phone"
                        className="text-base font-bold text-slate-800"
                      >
                        연락처
                      </label>
                      <input
                        id="applicant-phone"
                        name="phone"
                        data-testid="apply-phone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        value={applicant.phone}
                        onChange={(event) =>
                          setApplicant((current) => ({
                            ...current,
                            phone: formatPhone(event.target.value),
                          }))
                        }
                        placeholder="010-1234-5678"
                        aria-invalid={Boolean(errors.phone)}
                        aria-describedby={
                          errors.phone ? "phone-error" : undefined
                        }
                        className="mt-2 min-h-[52px] w-full rounded-xl border-2 border-slate-300 px-4 text-base text-slate-900 placeholder:text-slate-600 focus:border-brand-600 focus:outline-none"
                      />
                      {errors.phone && (
                        <p
                          id="phone-error"
                          className="mt-2 text-base font-semibold text-red-700"
                        >
                          {errors.phone}
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl bg-canvas p-4 text-base">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          결제 금액
                        </span>
                        <span className="text-xl font-bold text-slate-900">
                          {formatFee(selected.fee)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-900">
                        프로토타입 화면으로 실제 결제는 이루어지지 않습니다.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        data-testid="pay-button"
                        onClick={handlePayment}
                        className="flex cta-primary flex-1 items-center justify-center gap-2 rounded-2xl bg-accent-500 text-lg font-bold text-brand-900 transition-colors hover:bg-accent-600"
                      >
                        {selected.fee > 0 ? "결제하기" : "무료로 신청하기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStage("detail")}
                        className="flex cta-primary items-center justify-center rounded-2xl border-2 border-slate-300 px-6 text-lg font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                      >
                        이전
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
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
            aria-labelledby="job-dialog-title"
            data-testid="job-detail-modal"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-800">
                    {selectedJob.boardType}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-800">
                    {selectedJob.region === "부산" ? "부산" : "기타 지역"}
                  </span>
                </div>
                <h2
                  id="job-dialog-title"
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

            <dl className="mt-5 grid grid-cols-1 gap-3 rounded-2xl bg-canvas p-4 text-base sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <CalendarDays
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-brand-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-900">등록일</dt>
                  <dd className="font-semibold text-slate-800">
                    {selectedJob.date || "정보 없음"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-brand-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-900">지역</dt>
                  <dd className="font-semibold text-slate-800">
                    {selectedJob.region === "부산" ? "부산" : "기타 지역"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Users
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-brand-600"
                />
                <div>
                  <dt className="text-sm font-semibold text-slate-900">작성자</dt>
                  <dd className="font-semibold text-slate-800">
                    {selectedJob.author || "관리자"}
                  </dd>
                </div>
              </div>
            </dl>

            <div className="mt-5 rounded-2xl border border-slate-200 p-4">
              <h3 className="text-base font-bold text-slate-900">공고 내용</h3>
              <div className="mt-2 whitespace-pre-line text-base leading-relaxed text-slate-800">
                {selectedJob.content ||
                  "상세 내용은 원문 게시판에서 확인하세요."}
              </div>
            </div>

            <a
              href={selectedJob.sourceUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="job-source-link"
              className="mt-5 flex cta-primary items-center justify-center gap-2 rounded-2xl bg-brand-700 px-6 text-lg font-bold text-white transition-colors hover:bg-brand-800"
            >
              원문 게시판에서 보기
              <ArrowUpRight aria-hidden className="size-5" />
            </a>
          </div>
        </div>
      )}

      <ChatbotWidget
        programs={overview}
        activePrograms={activePrograms}
        counts={counts}
        onOpen={loadActivePrograms}
      />
    </div>
  );
}

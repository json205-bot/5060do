"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Phone, Send, X } from "lucide-react";
import knowledgeData from "@/data/center_knowledge.json";
import type { Program, ProgramCounts } from "@/lib/programs";

type KnowledgeEntry = {
  id: string;
  category?: string;
  title?: string;
  sourceUrl?: string;
  chunks?: string[];
};

type ChatData = {
  programs: Program[];
  activePrograms: Program[];
  counts: ProgramCounts;
};

type Message = {
  id: number;
  role: "user" | "bot";
  text: string;
  action?: { href: string; label: string; external?: boolean };
};

const QUICK_QUESTIONS = [
  { id: "free", label: "이달의 무료 강좌 안내" },
  { id: "apply", label: "수강신청 방법" },
  { id: "location", label: "주차장 및 센터 위치" },
  { id: "phone", label: "상담원 전화 연결" },
] as const;

const RECOMMEND_DELAY_MS = 700;

const knowledge = knowledgeData as KnowledgeEntry[];

const knowledgeById = (id: string) => knowledge.find((entry) => entry.id === id);

const locationChunk =
  knowledgeById("center-subLifeTwist-location")?.chunks?.join("\n") ?? "";
const address =
  locationChunk.match(/주소\s*\n?\s*([^\n]+)/)?.[1]?.trim() ??
  "부산광역시 남구 이기대공원로 18";
const phone =
  locationChunk.match(/연락처\s*\n?\s*([^\n]+)/)?.[1]?.trim() ?? "051-628-5060";
const phoneHref = `tel:${phone.replace(/[^0-9+]/g, "")}`;
const locationPageUrl =
  knowledgeById("center-subLifeTwist-location")?.sourceUrl ??
  "https://www.5060do.or.kr/subLifeTwist/location";
const applyGuideUrl = "https://www.5060do.or.kr/education/lifeEduWay";
const conventionPageUrl =
  knowledgeById("center-convention-index")?.sourceUrl ??
  "https://www.5060do.or.kr/convention/index";

const formatFee = (fee: number) =>
  fee > 0 ? `${fee.toLocaleString("ko-KR")}원` : "무료";

type Reply = Omit<Message, "id" | "role">;

function freeCourseReply({ activePrograms, counts }: ChatData): Reply {
  const openFree = activePrograms
    .filter(
      (program) =>
        program.fee === 0 &&
        ["접수중", "접수예정", "대기접수"].includes(program.status),
    )
    .slice(0, 3);
  const countLine = `전체 ${counts.전체}개 강좌 중 접수중 ${counts.접수중}개입니다.`;

  if (openFree.length === 0) {
    return {
      text: `지금 접수 중인 무료 강좌는 없습니다.\n\n${countLine} 궁금한 강좌 이름을 그대로 입력하셔도 안내해 드립니다.`,
    };
  }

  const lines = openFree.map(
    (program, index) =>
      `${index + 1}. ${program.title} (${program.status})\n   신청 ${program.applyPeriod} · 교육 ${program.eduPeriod}`,
  );

  return {
    text: `이달의 무료 강좌 ${openFree.length}개를 안내합니다.\n\n${lines.join(
      "\n\n",
    )}\n\n${countLine}\n무료 강좌는 수강료가 0원입니다. 화면의 '교육신청'에서 강좌 카드를 누르면 바로 신청하실 수 있습니다.`,
  };
}

function applyReply({ activePrograms, counts }: ChatData): Reply {
  const openPrograms = activePrograms.filter(
    (program) => program.status === "접수중",
  );
  const openCount = openPrograms.length > 0 ? openPrograms.length : counts.접수중;

  return {
    text: `수강신청은 이 화면에서 바로 하실 수 있습니다.\n\n1. '교육신청'에서 원하는 강좌를 누릅니다.\n2. 상세 내용을 확인하고 '수강신청'을 누릅니다.\n3. 성명과 연락처를 입력하고 결제 버튼을 누릅니다. 무료 강좌는 결제 없이 신청됩니다.\n\n지금 접수 중인 강좌는 ${openCount}개입니다.`,
    action: {
      href: applyGuideUrl,
      label: "신청 방법 안내 보기",
      external: true,
    },
  };
}

function locationReply(): Reply {
  return {
    text: `센터 주소는 ${address}입니다.\n\n건물 주차장을 이용하실 수 있습니다.\n1층은 56do 카페, 3층은 안내데스크와 56do 강당, 4층은 강의실, 5층은 공유사무실과 요리실로 쓰고 있습니다.\n\n전화 문의: ${phone}`,
    action: {
      href: locationPageUrl,
      label: "오시는 길 자세히 보기",
      external: true,
    },
  };
}

function phoneReply(): Reply {
  return {
    text: `상담원 연결 전화번호는 ${phone}입니다.\n운영시간은 평일 09:00 ~ 18:00, 점심시간은 12:00 ~ 13:00입니다.\n아래 버튼을 누르면 바로 전화가 연결됩니다.`,
    action: { href: phoneHref, label: `${phone} 전화 연결` },
  };
}

function facilityReply(): Reply {
  return {
    text: `센터 층별 안내입니다.\n\n1층: 56do 카페\n3층: 안내데스크, 사무실, 56do 강당\n4층: 강의실 1·2, 디지털강의실, 바리스타실, 소모임실, 해맞이 쉼터\n5층: 공유사무실, 담소마루, 실습실, 요리실\n\n장애인 화장실과 주차장도 마련되어 있습니다.`,
  };
}

function conventionReply(): Reply {
  return {
    text: `대관 공간과 이용료를 안내합니다.\n\n3층 56do 강당: 70명, 20,000원(1시간 기준), 빔프로젝트·음향설비·컴퓨터\n4층 강의실 1·2: 각 30명, 10,000원(1시간 기준)\n4층 소모임실: 10명, 10,000원(1시간 기준)\n\n대관 신청은 센터 홈페이지 '대관신청'에서 하실 수 있습니다.`,
    action: {
      href: conventionPageUrl,
      label: "대관신청 바로가기",
      external: true,
    },
  };
}

function visionReply(): Reply {
  return {
    text: `오륙도인생후반전지원센터의 미션은 '자발적 참여로 주도적 성장을 지원하는 기관'입니다.\n\n비전 1. 소통과 참여로 함께하는 지역공동체\n비전 2. 인생재설계 준비 기반 마련\n비전 3. 맞춤형 일자리 창출\n비전 4. 사회공헌, 재능 나눔 문화 조성\n\n핵심가치는 개방·소통·존중·성장·도전입니다.`,
  };
}

function greetingReply(): Reply {
  const greeting = knowledgeById("center-subLifeTwist-greeting");
  return {
    text: `오륙도인생후반전지원센터는 50~60대 신중년의 생애전환을 돕는 기관입니다. 교육, 사회참여, 커뮤니티, 일자리 지원 프로그램을 운영하고 있습니다.\n\n${address}에 있으며, 대표전화는 ${phone}입니다.`,
    action: greeting?.sourceUrl
      ? {
          href: greeting.sourceUrl,
          label: "인사말 보기",
          external: true,
        }
      : undefined,
  };
}

function programReply(program: Program, term: string): Reply {
  return {
    text: `'${term}' 관련 강좌를 찾았습니다.\n\n${program.title}\n분야: ${program.category}\n교육기간: ${program.eduPeriod}\n장소: ${program.location}\n수강료: ${formatFee(program.fee)}\n신청기간: ${program.applyPeriod}\n정원 ${program.capacity}명 · 신청 ${program.enrolled ?? 0}명 · 상태 ${program.status}\n\n'교육신청'에서 이 강좌를 누르면 상세 내용과 신청 버튼을 보실 수 있습니다.`,
    action: {
      href: program.sourceUrl,
      label: "센터 홈페이지에서 보기",
      external: true,
    },
  };
}

function findProgram(
  question: string,
  programs: Program[],
): { program: Program; term: string } | null {
  const tokens = question
    .split(/[\s,.;:!?]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  for (const token of tokens) {
    const found = programs.find((program) => program.title.includes(token));
    if (found) return { program: found, term: token };
  }
  return null;
}

function buildReply(question: string, data: ChatData): Reply {
  const normalized = question.replace(/\s+/g, " ").trim();
  const has = (...keys: string[]) =>
    keys.some((key) => normalized.includes(key));

  if (has("상담원", "전화", "연락", "연결")) return phoneReply();
  if (has("주차", "위치", "주소", "오시는", "찾아오", "찾아가는"))
    return locationReply();
  if (has("무료")) return freeCourseReply(data);
  if (has("수강신청", "신청 방법", "신청방법", "접수", "결제", "등록"))
    return applyReply(data);
  if (has("대관", "강당", "소모임실")) return conventionReply();
  if (has("시설", "층별", "층 안내", "강의실")) return facilityReply();
  if (has("비전", "미션", "핵심가치")) return visionReply();
  if (has("소개", "인사말", "환영")) return greetingReply();
  if (has("강좌", "강의", "프로그램", "교육"))
    return {
      text: `현재 센터에는 모두 ${data.counts.전체}개 강좌가 등록되어 있습니다.\n\n접수중 ${data.counts.접수중}개 · 접수예정 ${data.counts.접수예정}개 · 대기접수 ${data.counts.대기접수}개 · 마감 ${data.counts.마감}개입니다.\n\n'무료 강좌'를 물어보시면 이달의 무료 강좌를 안내해 드립니다.`,
    };

  const matched = findProgram(normalized, data.programs);
  if (matched) return programReply(matched.program, matched.term);

  return {
    text: `죄송합니다. 질문을 정확히 이해하지 못했습니다.\n\n'무료 강좌', '수강신청 방법', '센터 위치', '상담원 전화'처럼 짧게 물어보시거나, 아래 전화번호로 문의해 주세요.`,
    action: { href: phoneHref, label: `${phone} 전화 연결` },
  };
}

type ChatbotWidgetProps = {
  programs: Program[];
  activePrograms: Program[];
  counts: ProgramCounts;
  onOpen?: () => void;
};

export default function ChatbotWidget({
  programs,
  activePrograms,
  counts,
  onOpen,
}: ChatbotWidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "bot",
      text: "안녕하세요. 오륙도인생후반전지원센터 AI 상담 도우미입니다.\n궁금하신 내용을 아래에서 고르시거나 직접 적어 주세요.",
    },
  ]);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replyTimerRef = useRef<number | null>(null);
  const messageIdRef = useRef(1);

  const closePanel = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const ask = useCallback((question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    setInput("");
    setMessages((current) => [
      ...current,
      { id: messageIdRef.current++, role: "user", text: trimmed },
    ]);
    setTyping(true);

    if (replyTimerRef.current !== null) {
      window.clearTimeout(replyTimerRef.current);
    }

    replyTimerRef.current = window.setTimeout(() => {
      const reply = buildReply(trimmed, { programs, activePrograms, counts });
      setTyping(false);
      setMessages((current) => [
        ...current,
        { id: messageIdRef.current++, role: "bot", ...reply },
      ]);
      replyTimerRef.current = null;
    }, RECOMMEND_DELAY_MS);
  }, [activePrograms, counts, programs]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", handleKeyDown);

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, closePanel]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages, typing, open]);

  useEffect(
    () => () => {
      if (replyTimerRef.current !== null) {
        window.clearTimeout(replyTimerRef.current);
      }
    },
    [],
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask(input);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="chatbot-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="chatbot-panel"
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        className="fixed bottom-20 right-4 z-40 flex h-[60px] items-center gap-2 rounded-full bg-brand-700 px-5 text-white shadow-lg transition-colors hover:bg-brand-800 md:bottom-6 md:right-6"
      >
        <span className="relative flex items-center justify-center">
          <MessageCircle aria-hidden className="size-6" />
          <span
            aria-hidden
            className="absolute -right-1 -top-1 size-2.5 rounded-full bg-accent-500 ring-2 ring-white"
          />
        </span>
        <span className="text-base font-bold">AI 상담</span>
        <span className="sr-only">챗봇 열기</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 md:inset-auto md:bottom-6 md:right-6 md:block md:bg-transparent"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePanel();
          }}
        >
          <div
            id="chatbot-panel"
            data-testid="chatbot-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chatbot-title"
            className="flex h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:h-[580px] md:w-[400px] md:max-w-none md:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-3 bg-brand-800 px-4 py-3 text-white">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <MessageCircle aria-hidden className="size-5" />
                </span>
                <div>
                  <h2 id="chatbot-title" className="text-lg font-bold">
                    AI 상담 도우미
                  </h2>
                  <p className="text-sm text-brand-100">
                    오륙도인생후반전지원센터
                  </p>
                </div>
              </div>
              <button
                ref={closeRef}
                type="button"
                data-testid="chatbot-close"
                aria-label="AI 상담 닫기"
                onClick={closePanel}
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <X aria-hidden className="size-6" />
              </button>
            </div>

            <div
              ref={listRef}
              data-testid="chatbot-messages"
              role="log"
              aria-live="polite"
              aria-label="상담 대화 내용"
              className="flex-1 overflow-y-auto bg-canvas px-4 py-4"
            >
              <ul className="flex flex-col gap-3">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "flex justify-end"
                        : "flex justify-start"
                    }
                  >
                    <div
                      data-testid="chatbot-message"
                      data-role={message.role}
                      className={
                        message.role === "user"
                          ? "max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 px-4 py-3 text-white"
                          : "max-w-[90%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-[#1e293b] shadow-sm"
                      }
                    >
                      <p className="whitespace-pre-line text-base leading-relaxed">
                        {message.text}
                      </p>
                      {message.action && (
                        <a
                          href={message.action.href}
                          data-testid={
                            message.action.href.startsWith("tel:")
                              ? "chatbot-phone-link"
                              : "chatbot-link"
                          }
                          target={
                            message.action.external ? "_blank" : undefined
                          }
                          rel={
                            message.action.external ? "noreferrer" : undefined
                          }
                          className="mt-3 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-800"
                        >
                          {message.action.href.startsWith("tel:") && (
                            <Phone aria-hidden className="size-4" />
                          )}
                          {message.action.label}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
                {typing && (
                  <li
                    data-testid="chatbot-typing"
                    className="flex justify-start"
                  >
                    <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <span
                        aria-hidden
                        className="flex items-center gap-1"
                      >
                        {[0, 150, 300].map((delay) => (
                          <span
                            key={delay}
                            className="size-2 animate-bounce rounded-full bg-slate-500"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </span>
                      <span className="sr-only">
                        답변을 준비하고 있습니다.
                      </span>
                    </div>
                  </li>
                )}
              </ul>
            </div>

            <div className="border-t border-slate-200 bg-white px-4 pt-3">
              <p className="text-sm font-bold text-slate-900">
                자주 묻는 질문
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {QUICK_QUESTIONS.map((question) => (
                  <button
                    key={question.id}
                    type="button"
                    data-testid={`chatbot-chip-${question.id}`}
                    onClick={() => ask(question.label)}
                    className="flex min-h-[48px] items-center justify-center rounded-xl border-2 border-brand-200 bg-brand-50 px-2 text-center text-sm font-bold text-brand-800 transition-colors hover:border-brand-400 hover:bg-brand-100"
                  >
                    {question.label}
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
            >
              <label htmlFor="chatbot-input" className="sr-only">
                질문 입력
              </label>
              <input
                id="chatbot-input"
                ref={inputRef}
                data-testid="chatbot-input"
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="궁금한 내용을 적어 주세요"
                className="min-h-[52px] w-full min-w-0 flex-1 rounded-xl border-2 border-slate-300 px-4 text-[18px] text-[#1e293b] placeholder:text-slate-600 focus:border-brand-600 focus:outline-none"
              />
              <button
                type="submit"
                data-testid="chatbot-send"
                aria-label="질문 보내기"
                className="flex size-[52px] shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white transition-colors hover:bg-brand-800"
              >
                <Send aria-hidden className="size-5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

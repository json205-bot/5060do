"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  FoldHorizontal,
  Link2,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  Smartphone,
  Tablet,
} from "lucide-react";
import type { CSSProperties, FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { withBasePath } from "@/lib/basePath";

type SectionKey = "mobile" | "tablet" | "fold";
type Orientation = "portrait" | "landscape";
type Chassis = "phone" | "tablet" | "fold";

type DeviceSpec = {
  id: string;
  section: SectionKey;
  name: string;
  width: number;
  height: number;
  orientation: Orientation;
  chassis: Chassis;
  notch?: boolean;
  homeIndicator?: boolean;
};

type SectionSpec = {
  key: SectionKey;
  title: string;
  description: string;
  icon: LucideIcon;
};

const DEFAULT_SCALE = 60;

const SECTIONS: SectionSpec[] = [
  {
    key: "mobile",
    title: "스마트폰",
    description:
      "390 × 844 기준 세로·가로 화면에서 하단 내비게이션과 콘텐츠 압축을 검증합니다.",
    icon: Smartphone,
  },
  {
    key: "tablet",
    title: "태블릿",
    description:
      "820 × 1180 표준 비율로 데스크탑 직전의 넓은 화면 레이아웃을 검증합니다.",
    icon: Tablet,
  },
  {
    key: "fold",
    title: "갤럭시 폴드",
    description:
      "외부 커버와 내부 메인 화면의 4가지 뷰포트로 극단적 종횡비와 대화면을 검증합니다.",
    icon: FoldHorizontal,
  },
];

const DEVICES: DeviceSpec[] = [
  {
    id: "phone-portrait",
    section: "mobile",
    name: "스마트폰 세로",
    width: 390,
    height: 844,
    orientation: "portrait",
    chassis: "phone",
    notch: true,
    homeIndicator: true,
  },
  {
    id: "phone-landscape",
    section: "mobile",
    name: "스마트폰 가로",
    width: 844,
    height: 390,
    orientation: "landscape",
    chassis: "phone",
    homeIndicator: true,
  },
  {
    id: "tablet-portrait",
    section: "tablet",
    name: "태블릿 세로",
    width: 820,
    height: 1180,
    orientation: "portrait",
    chassis: "tablet",
  },
  {
    id: "tablet-landscape",
    section: "tablet",
    name: "태블릿 가로",
    width: 1180,
    height: 820,
    orientation: "landscape",
    chassis: "tablet",
  },
  {
    id: "fold-cover-portrait",
    section: "fold",
    name: "폴드 커버 세로",
    width: 416,
    height: 968,
    orientation: "portrait",
    chassis: "fold",
    homeIndicator: true,
  },
  {
    id: "fold-cover-landscape",
    section: "fold",
    name: "폴드 커버 가로",
    width: 968,
    height: 416,
    orientation: "landscape",
    chassis: "fold",
    homeIndicator: true,
  },
  {
    id: "fold-main-portrait",
    section: "fold",
    name: "폴드 메인 세로",
    width: 892,
    height: 1076,
    orientation: "portrait",
    chassis: "fold",
    homeIndicator: true,
  },
  {
    id: "fold-main-landscape",
    section: "fold",
    name: "폴드 메인 가로",
    width: 1076,
    height: 892,
    orientation: "landscape",
    chassis: "fold",
    homeIndicator: true,
  },
];

const CHASSIS: Record<
  Chassis,
  { padding: number; frameRadius: number; screenRadius: number }
> = {
  phone: { padding: 14, frameRadius: 56, screenRadius: 44 },
  tablet: { padding: 18, frameRadius: 40, screenRadius: 26 },
  fold: { padding: 12, frameRadius: 32, screenRadius: 22 },
};

function normalizeTarget(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return value;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(value)) {
    return `http://${value}`;
  }
  return `https://${value}`;
}

function resolveOriginKind(target: string): "same" | "cross" {
  try {
    const url = new URL(target, window.location.href);
    return url.origin === window.location.origin ? "same" : "cross";
  } catch {
    return "same";
  }
}

export default function ViewportTesterPage() {
  const defaultUrl = withBasePath("/");
  const [draftUrl, setDraftUrl] = useState(defaultUrl);
  const [appliedUrl, setAppliedUrl] = useState(defaultUrl);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [rotated, setRotated] = useState<Record<string, boolean>>({});
  const [originKind, setOriginKind] = useState<"same" | "cross">("same");

  const applyTarget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = normalizeTarget(draftUrl) || defaultUrl;
    setDraftUrl(next);
    setAppliedUrl(next);
    setOriginKind(resolveOriginKind(next));
    setReloadNonce((current) => current + 1);
  };

  const toggleRotation = (deviceId: string) => {
    setRotated((current) => ({ ...current, [deviceId]: !current[deviceId] }));
  };

  return (
    <div
      data-testid="viewport-tester"
      className="min-h-screen bg-canvas pb-16 text-ink"
    >
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-3 px-4 py-3 md:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-white">
                <SlidersHorizontal aria-hidden className="size-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  멀티 뷰포트 테스터
                </h1>
                <p
                  data-testid="viewport-count"
                  className="text-sm text-slate-600"
                >
                  스마트폰·태블릿·갤럭시 폴드 {DEVICES.length}개 뷰포트 동시 검증
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <nav
                aria-label="섹션 바로가기"
                data-testid="quick-nav"
                className="flex flex-wrap items-center gap-2"
              >
                {SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <a
                      key={section.key}
                      href={`#${section.key}`}
                      data-testid={`quick-nav-${section.key}`}
                      className="inline-flex touch-target items-center gap-2 rounded-full border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 transition-colors hover:border-brand-400 hover:bg-brand-50"
                    >
                      <Icon aria-hidden className="size-4 text-brand-700" />
                      {section.title}
                    </a>
                  );
                })}
              </nav>

              <label className="flex touch-target items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-3">
                <SlidersHorizontal
                  aria-hidden
                  className="size-4 shrink-0 text-brand-700"
                />
                <span className="text-sm font-bold text-slate-900">배율</span>
                <input
                  data-testid="scale-slider"
                  type="range"
                  min={40}
                  max={100}
                  step={5}
                  value={scale}
                  onChange={(event) => setScale(Number(event.target.value))}
                  aria-label="전체 배율"
                  className="w-32 accent-brand-700 sm:w-40"
                />
                <output
                  data-testid="scale-value"
                  className="w-12 text-right text-sm font-bold tabular-nums text-slate-900"
                >
                  {scale}%
                </output>
              </label>
            </div>
          </div>

          <form
            onSubmit={applyTarget}
            data-testid="target-form"
            className="flex flex-col gap-2 lg:flex-row lg:items-stretch"
          >
            <label className="flex min-h-[52px] flex-1 items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-4 focus-within:border-brand-500">
              <Link2 aria-hidden className="size-5 shrink-0 text-brand-700" />
              <span className="sr-only">검사할 URL</span>
              <input
                data-testid="target-url-input"
                type="text"
                value={draftUrl}
                onChange={(event) => setDraftUrl(event.target.value)}
                placeholder="https://example.com 또는 /5060do/"
                spellCheck={false}
                autoComplete="off"
                className="w-full bg-transparent py-3 text-base text-slate-900 outline-none placeholder:text-slate-500"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                data-testid="apply-url"
                className="flex touch-target flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-700 px-5 text-base font-bold text-white transition-colors hover:bg-brand-800 sm:flex-none"
              >
                <Link2 aria-hidden className="size-4" />
                적용
              </button>
              <button
                type="button"
                data-testid="refresh-all"
                onClick={() => setReloadNonce((current) => current + 1)}
                className="flex touch-target flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-900 transition-colors hover:bg-slate-50 sm:flex-none"
              >
                <RefreshCw aria-hidden className="size-4" />
                전체 새로고침
              </button>
              <a
                href={appliedUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="open-target"
                className="flex touch-target flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-900 transition-colors hover:bg-slate-50 sm:flex-none"
              >
                <ExternalLink aria-hidden className="size-4" />
                새 창
              </a>
            </div>
          </form>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <p
              data-testid="applied-url"
              className="truncate text-sm font-semibold text-slate-700"
            >
              적용 URL <span className="text-brand-800">{appliedUrl}</span>
            </p>
            {originKind === "cross" && (
              <p
                data-testid="origin-note"
                className="flex items-start gap-2 text-sm font-semibold text-amber-800"
              >
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0"
                />
                교차 출처 대상입니다. 대상 서버의 X-Frame-Options 또는 CSP
                frame-ancestors가 iframe 삽입을 허용해야 미리보기가 표시됩니다.
              </p>
            )}
            {originKind === "same" && (
              <p
                data-testid="origin-note"
                className="text-sm font-semibold text-emerald-800"
              >
                동일 출처 상대 경로 — 현재 사이트가 각 iframe 안에서 로드됩니다.
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-12 px-4 py-8 md:px-8">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const devices = DEVICES.filter(
            (device) => device.section === section.key,
          );
          return (
            <section
              key={section.key}
              id={section.key}
              aria-labelledby={`${section.key}-heading`}
              className="scroll-mt-16"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-800">
                  <Icon aria-hidden className="size-5" />
                </span>
                <div>
                  <h2
                    id={`${section.key}-heading`}
                    className="text-2xl font-bold text-slate-900"
                  >
                    {section.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-700">
                    {section.description}
                  </p>
                </div>
              </div>

              <div
                data-testid={`section-${section.key}`}
                className="mt-5 flex flex-wrap items-start gap-6"
              >
                {devices.map((device) => {
                  const isRotated = Boolean(rotated[device.id]);
                  const width = isRotated ? device.height : device.width;
                  const height = isRotated ? device.width : device.height;
                  const orientation: Orientation = isRotated
                    ? device.orientation === "portrait"
                      ? "landscape"
                      : "portrait"
                    : device.orientation;
                  const chassis = CHASSIS[device.chassis];
                  const outerWidth = width + chassis.padding * 2;
                  const outerHeight = height + chassis.padding * 2;
                  const scaleRatio = scale / 100;
                  const wrapperStyle: CSSProperties = {
                    width: Math.ceil(outerWidth * scaleRatio),
                    height: Math.ceil(outerHeight * scaleRatio),
                  };
                  const stageStyle: CSSProperties = {
                    width: outerWidth,
                    height: outerHeight,
                    borderRadius: chassis.frameRadius,
                    transform: `scale(${scaleRatio})`,
                    transformOrigin: "top left",
                  };
                  const screenStyle: CSSProperties = {
                    width,
                    height,
                    borderRadius: chassis.screenRadius,
                  };
                  const showNotch =
                    device.notch && orientation === "portrait";
                  const showHomeIndicator =
                    device.homeIndicator && orientation === "portrait";

                  return (
                    <article
                      key={device.id}
                      data-testid={`device-card-${device.id}`}
                      className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <header className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex size-8 items-center justify-center rounded-xl bg-slate-100 text-slate-800">
                            <Icon aria-hidden className="size-4" />
                          </span>
                          <h3 className="text-base font-bold text-slate-900">
                            {device.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            data-testid={`device-badge-${device.id}`}
                            className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold tabular-nums text-brand-800"
                          >
                            {width} × {height}
                          </span>
                          <button
                            type="button"
                            data-testid={`device-rotate-${device.id}`}
                            aria-pressed={isRotated}
                            aria-label={`${device.name} 화면 회전`}
                            onClick={() => toggleRotation(device.id)}
                            className="flex touch-target items-center justify-center gap-1 rounded-xl border-2 border-slate-200 px-3 text-sm font-bold text-slate-900 transition-colors hover:border-brand-400 hover:bg-brand-50"
                          >
                            <RotateCw aria-hidden className="size-4" />
                            회전
                          </button>
                          <a
                            href={appliedUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`${device.name} 새 창으로 열기`}
                            className="flex touch-target items-center justify-center rounded-xl border-2 border-slate-200 px-3 text-slate-900 transition-colors hover:border-brand-400 hover:bg-brand-50"
                          >
                            <ArrowUpRight aria-hidden className="size-4" />
                          </a>
                        </div>
                      </header>

                      <div
                        className="mt-4 overflow-hidden"
                        style={wrapperStyle}
                      >
                        <div
                          data-testid={`device-frame-${device.id}`}
                          data-width={width}
                          data-height={height}
                          data-orientation={orientation}
                          className="relative bg-slate-950 shadow-2xl ring-1 ring-slate-800"
                          style={stageStyle}
                        >
                          <div
                            className="relative overflow-hidden bg-white"
                            style={screenStyle}
                          >
                            <iframe
                              key={`${device.id}-${reloadNonce}`}
                              src={appliedUrl}
                              title={`${device.name} ${width}×${height} 미리보기`}
                              width={width}
                              height={height}
                              className="block border-0 bg-white"
                            />
                            {showNotch && (
                              <span
                                aria-hidden
                                className="pointer-events-none absolute left-1/2 top-2 h-6 w-28 -translate-x-1/2 rounded-full bg-slate-950"
                              />
                            )}
                            {showHomeIndicator && (
                              <span
                                aria-hidden
                                className="pointer-events-none absolute bottom-2 left-1/2 h-1.5 w-24 -translate-x-1/2 rounded-full bg-slate-900/70"
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        <section
          aria-labelledby="viewport-notes-heading"
          className="rounded-3xl border border-amber-300 bg-amber-50 p-5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden
              className="mt-1 size-5 shrink-0 text-amber-700"
            />
            <div className="text-sm text-amber-950">
              <h2
                id="viewport-notes-heading"
                className="text-base font-bold text-amber-950"
              >
                iframe 제약 안내
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  대상 서버가 <code>X-Frame-Options: DENY</code> 또는{" "}
                  <code>SAMEORIGIN</code>, <code>Content-Security-Policy</code>의{" "}
                  <code>frame-ancestors</code>로 삽입을 막으면 iframe이 빈
                  화면으로 표시됩니다. 이때는 대상 서버 설정을 완화하거나 새 창
                  보기를 사용하세요.
                </li>
                <li>
                  동일 출처 상대 경로(예: <code>/5060do/</code>)는 현재 사이트
                  기준으로 로드되므로 로컬 개발 서버에서도 그대로 검증할 수
                  있습니다.
                </li>
                <li>
                  외부 <code>https</code> 사이트는 대상 서버가 iframe 삽입을
                  허용해야 하며, 교차 출처라면 내부 DOM 검사·스크롤 동기화는
                  브라우저 보안 정책상 불가능합니다.
                </li>
                <li>
                  배율 슬라이더는 각 기기 프레임을 시각적으로 축소·확대할 뿐,
                  iframe의 실제 CSS 뷰포트 크기는 바꾸지 않습니다.
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

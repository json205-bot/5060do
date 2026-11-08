import type { ReactNode } from "react";
import { withBasePath } from "@/lib/basePath";

type VersionSwitcherProps = {
  current: "modern" | "classic";
};

// Paths come from the build-time NEXT_PUBLIC_BASE_PATH so a full page load
// keeps working on both the NAS sub-path and the Vercel root deployment.
const versionPaths = {
  classic: withBasePath("/classic/"),
  modern: withBasePath("/"),
} as const;

const options: { key: keyof typeof versionPaths; label: string; suffix: ReactNode }[] = [
  { key: "classic", label: "원본 메뉴형", suffix: " 보기" },
  { key: "modern", label: "축소 모던형", suffix: " 보기" },
];

export default function VersionSwitcher({ current }: VersionSwitcherProps) {
  return (
    <div
      data-testid="version-switcher"
      className="border-b border-slate-700 bg-slate-900 text-white"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between md:px-6">
        <p className="font-semibold text-slate-200">
          버전 전환 · 두 화면을 비교해 보세요
        </p>
        <nav aria-label="버전 전환" className="flex flex-wrap items-center gap-2">
          {options.map((option) => {
            const isCurrent = option.key === current;
            return (
              <a
                key={option.key}
                href={versionPaths[option.key]}
                data-testid={`switch-${option.key}`}
                aria-current={isCurrent ? "page" : undefined}
                className={`flex touch-target items-center gap-1 rounded-lg px-3 font-semibold transition-colors ${
                  isCurrent
                    ? "bg-white text-slate-900"
                    : "bg-slate-700 text-white hover:bg-slate-600"
                }`}
              >
                {option.label}
                {isCurrent ? " · 현재" : option.suffix}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

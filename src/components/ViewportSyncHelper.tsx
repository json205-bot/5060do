"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Client half of the Gojigi responsive viewport tester protocol
// (5060DO-20261110-1430 / GOJIGI-20261110-1330). It only runs inside an iframe:
// a normal visitor pays nothing beyond one boolean check.
const FRAME_SOURCE = "gojigi-viewport-frame";
const PARENT_SOURCE = "gojigi-viewport-sync";
const NAV_PROBE_EVENT = "gojigi-viewport:navigation";
// A programmatic scroll keeps echoing scroll events for a few frames. Ignore
// them so the parent's update is not relayed back as a new frame:scroll.
const SCROLL_SUPPRESS_MS = 300;
const RATIO_EPSILON = 0.002;

function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function scrollingRoot(): Element {
  return document.scrollingElement ?? document.documentElement;
}

function currentScrollRatio(): number {
  const root = scrollingRoot();
  const max = root.scrollHeight - root.clientHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, root.scrollTop / max));
}

function postToParent(payload: Record<string, unknown>): void {
  try {
    window.parent.postMessage({ source: FRAME_SOURCE, ...payload }, "*");
  } catch {
    // The parent went away between the check and the post.
  }
}

function reportReady(): void {
  postToParent({ type: "frame:ready", href: window.location.href });
}

function reportNavigate(): void {
  const href = window.location.href;
  // frame:ready matches the 1430 spec; frame:navigate is the type the Gojigi
  // 1330 engine actually listens to for cross-origin route updates.
  postToParent({ type: "frame:ready", href });
  postToParent({ type: "frame:navigate", url: href });
}

function installHistoryProbe(): () => void {
  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const emit = () => window.dispatchEvent(new Event(NAV_PROBE_EVENT));

  history.pushState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalPush.call(history, data, unused, url);
    emit();
  };
  history.replaceState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalReplace.call(history, data, unused, url);
    emit();
  };

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
  };
}

export default function ViewportSyncHelper() {
  const pathname = usePathname();
  const suppressUntilRef = useRef(0);
  const reportedHrefRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isEmbedded()) return;

    reportedHrefRef.current = window.location.href;
    reportReady();

    // The parent may attach its message listener after the iframe starts
    // loading, so repeat the handshake once the load event settles.
    const announce = () => {
      if (document.visibilityState === "hidden") return;
      reportReady();
    };
    if (document.readyState === "complete") {
      const timer = window.setTimeout(announce, 100);
      window.addEventListener("load", announce);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("load", announce);
      };
    }
    window.addEventListener("load", announce);
    return () => window.removeEventListener("load", announce);
  }, []);

  useEffect(() => {
    if (!isEmbedded()) return;
    if (reportedHrefRef.current === null) return;
    const href = window.location.href;
    if (href === reportedHrefRef.current) return;
    reportedHrefRef.current = href;
    reportNavigate();
  }, [pathname]);

  useEffect(() => {
    if (!isEmbedded()) return;

    let ratioFrame = 0;
    let lastSentRatio = -1;

    const flushScroll = () => {
      ratioFrame = 0;
      if (performance.now() < suppressUntilRef.current) return;
      const ratio = currentScrollRatio();
      if (Math.abs(ratio - lastSentRatio) < RATIO_EPSILON) return;
      lastSentRatio = ratio;
      postToParent({ type: "frame:scroll", scroll: ratio });
    };

    const onScroll = () => {
      if (ratioFrame !== 0) return;
      ratioFrame = window.requestAnimationFrame(flushScroll);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { source?: string; type?: string; scroll?: number }
        | null;
      if (
        !data ||
        data.source !== PARENT_SOURCE ||
        data.type !== "parent:scroll" ||
        typeof data.scroll !== "number"
      ) {
        return;
      }
      if (event.source !== window.parent) return;

      const root = scrollingRoot();
      const max = root.scrollHeight - root.clientHeight;
      if (max <= 0) return;

      const ratio = Math.min(1, Math.max(0, data.scroll));
      const target = Math.round(ratio * max);
      suppressUntilRef.current = performance.now() + SCROLL_SUPPRESS_MS;
      lastSentRatio = ratio;
      // "instant" overrides the site-wide `scroll-behavior: smooth`; otherwise
      // the synced frame animates, keeps emitting scroll events, and relays
      // itself back to the parent for half a second.
      root.scrollTop = target;
      window.scrollTo({ top: target, behavior: "instant" });
    };

    const onNavigation = () => {
      const href = window.location.href;
      if (href === reportedHrefRef.current) return;
      reportedHrefRef.current = href;
      reportNavigate();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("message", onMessage);
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
    window.addEventListener(NAV_PROBE_EVENT, onNavigation);
    const removeHistoryProbe = installHistoryProbe();

    return () => {
      if (ratioFrame !== 0) window.cancelAnimationFrame(ratioFrame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("popstate", onNavigation);
      window.removeEventListener("hashchange", onNavigation);
      window.removeEventListener(NAV_PROBE_EVENT, onNavigation);
      removeHistoryProbe();
    };
  }, []);

  return null;
}

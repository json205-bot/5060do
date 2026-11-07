"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import localProgramData from "@/data/programs.json";
import {
  comparePrograms,
  defaultProgramCounts,
  fetchProgramCounts,
  fetchProgramPage,
  mergeProgramPage,
  orderOpenProgramsByImminence,
  programPageSize,
  type Program,
  type ProgramCounts,
  type ProgramSource,
  type StatusFilter,
} from "@/lib/programs";
import { getSupabaseClient } from "@/lib/supabase";

const localPrograms = localProgramData as Program[];

type ServerState = "probing" | "ready" | "failed";

type ProgramPage = {
  filter: StatusFilter;
  items: Program[];
  pages: number;
};

const countLocalPrograms = (): ProgramCounts => {
  const counts: ProgramCounts = {
    전체: localPrograms.length,
    접수중: 0,
    접수예정: 0,
    대기접수: 0,
    마감: 0,
  };
  for (const program of localPrograms) {
    counts[program.status] += 1;
  }
  return counts;
};

const selectLocalPrograms = (
  statusFilter: StatusFilter,
  limit: number,
): Program[] => {
  const filtered =
    statusFilter === "전체"
      ? localPrograms
      : localPrograms.filter((program) => program.status === statusFilter);
  return [...filtered].sort(comparePrograms).slice(0, limit);
};

export type UseProgramsResult = {
  programs: Program[];
  overview: Program[];
  counts: ProgramCounts;
  source: ProgramSource;
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => void;
};

export function usePrograms(statusFilter: StatusFilter): UseProgramsResult {
  const client = useMemo(() => getSupabaseClient(), []);
  const [serverState, setServerState] = useState<ServerState>(() =>
    client ? "probing" : "failed",
  );
  const [counts, setCounts] = useState<ProgramCounts>(() =>
    client ? { ...defaultProgramCounts } : countLocalPrograms(),
  );
  const [page, setPage] = useState<ProgramPage>(() =>
    client
      ? { filter: statusFilter, items: [], pages: 0 }
      : {
          filter: statusFilter,
          items: selectLocalPrograms(statusFilter, programPageSize),
          pages: 1,
        },
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  // The chatbot needs a status-agnostic snapshot of the first page so its
  // answers stay identical to the main list even after the user filters it.
  const [overview, setOverview] = useState<Program[]>(() =>
    selectLocalPrograms("전체", programPageSize),
  );

  useEffect(() => {
    if (!client) return;

    let cancelled = false;
    fetchProgramCounts(client)
      .then((serverCounts) => {
        if (cancelled) return;
        setCounts(serverCounts);
        setServerState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn(
          "[programs] failed to load program counts from Supabase. Keeping local program data.",
          error,
        );
        setCounts(countLocalPrograms());
        setOverview(selectLocalPrograms("전체", programPageSize));
        setServerState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (serverState !== "ready" || !client) return;

    let cancelled = false;
    fetchProgramPage(client, {
      status: statusFilter === "전체" ? null : statusFilter,
      offset: 0,
      limit: programPageSize,
    })
      .then((rows) => {
        if (cancelled) return;
        const ordered = orderOpenProgramsByImminence(rows);
        setPage({
          filter: statusFilter,
          // Only the first page needs the imminent-seat reorder: later pages
          // are merged into the open group by mergeProgramPage.
          items: ordered,
          pages: 1,
        });
        if (statusFilter === "전체") setOverview(ordered);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn(
          "[programs] failed to load live programs from Supabase. Keeping local program data.",
          error,
        );
        setCounts(countLocalPrograms());
        setOverview(selectLocalPrograms("전체", programPageSize));
        setServerState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [client, serverState, statusFilter]);

  const serverMode = serverState === "ready" && client !== null;
  const isCurrentFilter = page.filter === statusFilter;
  const localPages = isCurrentFilter ? page.pages : 1;

  const programs = serverMode
    ? isCurrentFilter
      ? page.items
      : []
    : selectLocalPrograms(statusFilter, localPages * programPageSize);
  const source: ProgramSource = serverMode ? "supabase" : "local";
  const total = counts[statusFilter];
  const hasMore = programs.length < total;
  const loading =
    serverState === "probing" ||
    (serverMode && (!isCurrentFilter || page.pages === 0));

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || loading || programs.length >= total) return;

    if (!serverMode || !client) {
      setPage((current) => {
        const pages = (current.filter === statusFilter ? current.pages : 1) + 1;
        return {
          filter: statusFilter,
          items: selectLocalPrograms(
            statusFilter,
            pages * programPageSize,
          ),
          pages,
        };
      });
      return;
    }

    const offset = (isCurrentFilter ? page.pages : 0) * programPageSize;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    fetchProgramPage(client, {
      status: statusFilter === "전체" ? null : statusFilter,
      offset,
      limit: programPageSize,
    })
      .then((rows) => {
        setPage((current) => {
          if (current.filter !== statusFilter) return current;
          return {
            filter: statusFilter,
            items: mergeProgramPage(current.items, rows),
            pages: current.pages + 1,
          };
        });
      })
      .catch((error: unknown) => {
        console.warn("[programs] failed to load the next program page.", error);
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [
    client,
    isCurrentFilter,
    loading,
    page.pages,
    programs.length,
    serverMode,
    statusFilter,
    total,
  ]);

  return {
    programs,
    overview,
    counts,
    source,
    total,
    hasMore,
    loading,
    loadingMore,
    loadMore,
  };
}

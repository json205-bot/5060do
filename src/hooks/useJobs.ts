"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  countLocalJobs,
  defaultJobCounts,
  fetchJobCounts,
  fetchJobPage,
  jobPageSize,
  mapLocalJob,
  selectLocalJobPage,
  sortJobs,
  type Job,
  type JobBoardFilter,
  type JobCounts,
  type JobRegionFilter,
  type JobSource,
  type JobSourceRow,
} from "@/lib/jobs";
import { getSupabaseClient } from "@/lib/supabase";

type ServerState = "probing" | "ready" | "failed";

export type JobsFilter = {
  boardType: JobBoardFilter;
  region: JobRegionFilter;
  query: string;
};

type LocalJobsState = {
  rows: Job[];
  counts: JobCounts;
};

// The 2,034-row dataset is ~1.7MB, so it is a lazy chunk that is only fetched
// when Supabase is unavailable. The main bundle stays small.
let localJobsPromise: Promise<LocalJobsState> | null = null;

function loadLocalJobs(): Promise<LocalJobsState> {
  if (!localJobsPromise) {
    localJobsPromise = import("@/data/jobs_all.json").then((module) => {
      const rows = (module.default as JobSourceRow[])
        .filter((row) => row && Number.isFinite(Number(row.id)))
        .map(mapLocalJob)
        .sort(sortJobs);
      return { rows, counts: countLocalJobs(rows) };
    });
  }
  return localJobsPromise;
}

export type UseJobsResult = {
  jobs: Job[];
  counts: JobCounts;
  source: JobSource;
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => void;
};

export function useJobs(filter: JobsFilter): UseJobsResult {
  const client = useMemo(() => getSupabaseClient(), []);
  const [serverState, setServerState] = useState<ServerState>(() =>
    client ? "probing" : "failed",
  );
  const [counts, setCounts] = useState<JobCounts>(defaultJobCounts);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(defaultJobCounts.전체);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [localJobs, setLocalJobs] = useState<LocalJobsState | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(filter.query);
  const filterKey = `${filter.boardType}|${filter.region}|${debouncedQuery}`;
  // Derived instead of set inside the effect: the active filter has no loaded
  // page yet, so the section shows its loading state until that page arrives.
  const loading = serverState === "probing" || loadedKey !== filterKey;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(filter.query), 300);
    return () => clearTimeout(timer);
  }, [filter.query]);

  useEffect(() => {
    if (!client) return;

    let cancelled = false;
    fetchJobCounts(client)
      .then((serverCounts) => {
        if (cancelled) return;
        setCounts(serverCounts);
        setServerState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn(
          "[jobs] failed to load job counts from Supabase. Using the bundled dataset.",
          error,
        );
        setServerState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;

    if (serverState === "probing") {
      return () => {
        cancelled = true;
      };
    }

    if (serverState === "ready" && client) {
      fetchJobPage(client, {
        boardType: filter.boardType,
        region: filter.region,
        query: debouncedQuery,
        offset: 0,
        limit: jobPageSize,
      })
        .then(({ rows, total: matched }) => {
          if (cancelled) return;
          setJobs(rows);
          setTotal(matched);
          setLoadedKey(filterKey);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.warn(
            "[jobs] failed to load live jobs from Supabase. Using the bundled dataset.",
            error,
          );
          setServerState("failed");
        });

      return () => {
        cancelled = true;
      };
    }

    loadLocalJobs()
      .then((local) => {
        if (cancelled) return;
        const page = selectLocalJobPage(
          local.rows,
          {
            boardType: filter.boardType,
            region: filter.region,
            query: debouncedQuery,
          },
          jobPageSize,
        );
        setLocalJobs(local);
        setCounts(local.counts);
        setJobs(page.rows);
        setTotal(page.total);
        setLoadedKey(filterKey);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[jobs] failed to load the bundled dataset.", error);
        setJobs([]);
        setTotal(0);
        setLoadedKey(filterKey);
      });

    return () => {
      cancelled = true;
    };
  }, [
    client,
    serverState,
    filter.boardType,
    filter.region,
    debouncedQuery,
    filterKey,
  ]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || jobs.length >= total) return;

    if (serverState === "ready" && client) {
      setLoadingMore(true);
      fetchJobPage(client, {
        boardType: filter.boardType,
        region: filter.region,
        query: debouncedQuery,
        offset: jobs.length,
        limit: jobPageSize,
      })
        .then(({ rows }) => {
          setJobs((current) => {
            const seen = new Set(current.map((job) => job.id));
            return [
              ...current,
              ...rows.filter((job) => !seen.has(job.id)),
            ];
          });
        })
        .catch((error: unknown) => {
          console.warn("[jobs] failed to load the next job page.", error);
        })
        .finally(() => setLoadingMore(false));
      return;
    }

    if (!localJobs) return;
    const nextLimit =
      Math.ceil((jobs.length + jobPageSize) / jobPageSize) * jobPageSize;
    const page = selectLocalJobPage(
      localJobs.rows,
      {
        boardType: filter.boardType,
        region: filter.region,
        query: debouncedQuery,
      },
      nextLimit,
    );
    setJobs(page.rows);
    setTotal(page.total);
  }, [
    client,
    debouncedQuery,
    filter.boardType,
    filter.region,
    jobs.length,
    loading,
    loadingMore,
    localJobs,
    serverState,
    total,
  ]);

  const serverMode = serverState === "ready" && client !== null;

  return {
    jobs,
    counts,
    source: serverMode ? "supabase" : "local",
    total,
    hasMore: jobs.length < total,
    loading,
    loadingMore,
    loadMore,
  };
}

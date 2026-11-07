"use client";

import { useEffect, useState } from "react";
import localProgramData from "@/data/programs.json";
import {
  fetchProgramsFromSupabase,
  type Program,
  type ProgramSource,
} from "@/lib/programs";
import { getSupabaseClient } from "@/lib/supabase";

const localPrograms = localProgramData as Program[];

export function usePrograms(): {
  programs: Program[];
  source: ProgramSource;
} {
  const [programs, setPrograms] = useState<Program[]>(localPrograms);
  const [source, setSource] = useState<ProgramSource>("local");

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;

    let cancelled = false;

    fetchProgramsFromSupabase(client)
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setPrograms(rows);
        setSource("supabase");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn(
          "[programs] failed to load live programs from Supabase. Keeping local program data.",
          error,
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { programs, source };
}

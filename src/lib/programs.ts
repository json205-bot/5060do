import type { SupabaseClient } from "@supabase/supabase-js";

export const programStatuses = ["접수중", "접수예정", "대기접수", "마감"] as const;

export type ProgramStatus = (typeof programStatuses)[number];

export type Program = {
  id: number;
  title: string;
  category: string;
  summary: string;
  capacity: number;
  enrolled?: number;
  location: string;
  fee: number;
  target: string;
  applyPeriod: string;
  eduPeriod: string;
  status: ProgramStatus;
  sourceUrl: string;
};

export type ProgramSource = "local" | "supabase";

export type SupabaseProgramRow = {
  id: string | number | null;
  title: string | null;
  category: string | null;
  target: string | null;
  capacity: string | number | null;
  fee: string | number | null;
  edu_period: string | null;
  apply_period: string | null;
  location: string | null;
  status: string | null;
  summary: string | null;
  content: string | null;
  created_at: string | null;
};

const parseAmount = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toProgramStatus = (value: unknown): ProgramStatus =>
  programStatuses.includes(value as ProgramStatus)
    ? (value as ProgramStatus)
    : "마감";

export function mapSupabaseProgram(
  row: SupabaseProgramRow,
  index: number,
): Program {
  const numericId = Number(row.id);
  return {
    id: Number.isFinite(numericId) ? numericId : -(index + 1),
    title: row.title ?? "",
    category: row.category ?? "",
    summary: row.summary ?? "",
    capacity: parseAmount(row.capacity),
    location: row.location ?? "",
    fee: parseAmount(row.fee),
    target: row.target ?? "",
    applyPeriod: row.apply_period ?? "",
    eduPeriod: row.edu_period ?? "",
    status: toProgramStatus(row.status),
    sourceUrl: "",
  };
}

export async function fetchProgramsFromSupabase(
  client: SupabaseClient,
): Promise<Program[]> {
  const { data, error } = await client
    .from("programs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];

  return (data as SupabaseProgramRow[]).map(mapSupabaseProgram);
}

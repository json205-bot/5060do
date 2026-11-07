import type { SupabaseClient } from "@supabase/supabase-js";

export const programStatuses = ["접수중", "접수예정", "대기접수", "마감"] as const;

export type ProgramStatus = (typeof programStatuses)[number];

export type StatusFilter = "전체" | ProgramStatus;

export type ProgramCounts = Record<StatusFilter, number>;

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

export const programPageSize = 30;

export const defaultProgramCounts: ProgramCounts = {
  전체: 667,
  접수중: 7,
  접수예정: 1,
  대기접수: 7,
  마감: 652,
};

export const programListColumns = [
  "id",
  "title",
  "category",
  "target",
  "capacity",
  "enrolled",
  "fee",
  "edu_period",
  "apply_period",
  "location",
  "status",
  "status_order",
  "summary",
  "created_at",
].join(", ");

export type SupabaseProgramRow = {
  id: string | number | null;
  title: string | null;
  category: string | null;
  target: string | null;
  capacity: string | number | null;
  enrolled: string | number | null;
  fee: string | number | null;
  edu_period: string | null;
  apply_period: string | null;
  location: string | null;
  status: string | null;
  status_order?: string | number | null;
  summary: string | null;
  content?: string | null;
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

const parseEnrolled = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  return parseAmount(value);
};

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
    enrolled: parseEnrolled(row.enrolled),
    location: row.location ?? "",
    fee: parseAmount(row.fee),
    target: row.target ?? "",
    applyPeriod: row.apply_period ?? "",
    eduPeriod: row.edu_period ?? "",
    status: toProgramStatus(row.status),
    sourceUrl: "",
  };
}

const statusRank: Record<ProgramStatus, number> = {
  접수중: 0,
  접수예정: 1,
  대기접수: 2,
  마감: 3,
};

const remainingRatio = (program: Program) =>
  program.capacity > 0
    ? Math.max(0, program.capacity - (program.enrolled ?? 0)) / program.capacity
    : 1;

const parseApplyStart = (period: string) => (period.split("~")[0] ?? "").trim();
const parseApplyEnd = (period: string) => {
  const end = (period.split("~")[1] ?? "").trim();
  return end || parseApplyStart(period);
};

export function comparePrograms(a: Program, b: Program) {
  const rank = statusRank[a.status] - statusRank[b.status];
  if (rank !== 0) return rank;
  switch (a.status) {
    case "접수중":
      return (
        remainingRatio(a) - remainingRatio(b) ||
        parseApplyEnd(a.applyPeriod).localeCompare(parseApplyEnd(b.applyPeriod))
      );
    case "접수예정":
      return parseApplyStart(a.applyPeriod).localeCompare(
        parseApplyStart(b.applyPeriod),
      );
    case "대기접수":
      return (
        (b.enrolled ?? 0) - (a.enrolled ?? 0) ||
        parseApplyEnd(a.applyPeriod).localeCompare(parseApplyEnd(b.applyPeriod))
      );
    default:
      return parseApplyEnd(b.applyPeriod).localeCompare(
        parseApplyEnd(a.applyPeriod),
      );
  }
}

async function countPrograms(
  client: SupabaseClient,
  status: ProgramStatus | null,
): Promise<number> {
  let query = client
    .from("programs")
    .select("id", { count: "exact", head: true });
  if (status) query = query.eq("status", status);

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchProgramCounts(
  client: SupabaseClient,
): Promise<ProgramCounts> {
  const [total, ...byStatus] = await Promise.all([
    countPrograms(client, null),
    ...programStatuses.map((status) => countPrograms(client, status)),
  ]);

  return {
    전체: total,
    접수중: byStatus[0],
    접수예정: byStatus[1],
    대기접수: byStatus[2],
    마감: byStatus[3],
  };
}

export type ProgramPageParams = {
  status: ProgramStatus | null;
  offset: number;
  limit?: number;
};

export async function fetchProgramPage(
  client: SupabaseClient,
  { status, offset, limit = programPageSize }: ProgramPageParams,
): Promise<Program[]> {
  let query = client.from("programs").select(programListColumns);
  if (status) query = query.eq("status", status);

  // status_order is maintained by the seed script so server paging already
  // yields the senior-facing order (접수중 → 접수예정 → 대기접수 → 마감).
  // id is only a deterministic tie-breaker for stable range paging.
  const { data, error } = await query
    .order("status_order", { ascending: true })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];

  return (data as unknown as SupabaseProgramRow[]).map(mapSupabaseProgram);
}

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

// A stalled Supabase call must not block the first paint, so every request is
// aborted after this window and the hook falls back to the local dataset.
export const programRequestTimeoutMs = 5000;

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
  signal: AbortSignal,
): Promise<number> {
  let query = client
    .from("programs")
    .select("id", { count: "exact", head: true });
  if (status) query = query.eq("status", status);

  const { count, error } = await query.abortSignal(signal);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const withRequestTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), programRequestTimeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Supabase request aborted after ${programRequestTimeoutMs}ms timeout`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export async function fetchProgramCounts(
  client: SupabaseClient,
): Promise<ProgramCounts> {
  return withRequestTimeout(async (signal) => {
    const [total, ...byStatus] = await Promise.all([
      countPrograms(client, null, signal),
      ...programStatuses.map((status) => countPrograms(client, status, signal)),
    ]);

    return {
      전체: total,
      접수중: byStatus[0],
      접수예정: byStatus[1],
      대기접수: byStatus[2],
      마감: byStatus[3],
    };
  });
}

export const activeProgramColumns = [
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
].join(", ");

// status_order < 4 means 접수중, 접수예정, 대기접수. 마감(4) courses are never
// helpful to the chatbot and are skipped server-side.
export const activeStatusOrderLimit = 4;

export type ProgramPageParams = {
  status: ProgramStatus | null;
  offset: number;
  limit?: number;
};

export async function fetchProgramPage(
  client: SupabaseClient,
  { status, offset, limit = programPageSize }: ProgramPageParams,
): Promise<Program[]> {
  return withRequestTimeout(async (signal) => {
    let query = client.from("programs").select(programListColumns);
    if (status) query = query.eq("status", status);

    // status_order is maintained by the seed script so server paging already
    // yields the senior-facing order (접수중 → 접수예정 → 대기접수 → 마감).
    // id is only a deterministic tie-breaker for stable range paging.
    const { data, error } = await query
      .order("status_order", { ascending: true })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1)
      .abortSignal(signal);

    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) return [];

    return (data as unknown as SupabaseProgramRow[]).map(mapSupabaseProgram);
  });
}

// The main list fetches 30 rows at a time, so the chatbot cannot rely on it to
// know every open course. This dedicated query returns only active courses with
// the lightweight columns the chatbot answers need, independent of paging.
export async function fetchActivePrograms(
  client: SupabaseClient,
): Promise<Program[]> {
  return withRequestTimeout(async (signal) => {
    const { data, error } = await client
      .from("programs")
      .select(activeProgramColumns)
      .lt("status_order", activeStatusOrderLimit)
      .order("status_order", { ascending: true })
      .order("id", { ascending: false })
      .range(0, 999)
      .abortSignal(signal);

    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) return [];

    return (data as unknown as SupabaseProgramRow[]).map(mapSupabaseProgram);
  });
}

// Server paging only knows status_order, so open courses arrive as
// "newest first". Reorder the 접수중 group of a page by remaining seats so the
// classes closest to closing are shown first; other groups keep server order
// and blob the appended [더보기] pages untouched.
export function orderOpenProgramsByImminence(programs: Program[]): Program[] {
  const open = programs.filter((program) => program.status === "접수중");
  if (open.length < 2) return programs;

  const ordered = [...open].sort(
    (a, b) =>
      remainingRatio(a) - remainingRatio(b) ||
      parseApplyEnd(a.applyPeriod).localeCompare(parseApplyEnd(b.applyPeriod)) ||
      b.id - a.id,
  );

  let cursor = 0;
  return programs.map((program) =>
    program.status === "접수중" ? ordered[cursor++] : program,
  );
}

// [더보기] appends a server page that is already ordered by status_order. When
// the new rows contain another 접수중 course, the visible open group must be
// re-sorted as a whole so the closest-to-full class stays first across pages.
// Non-접수중 groups are left in their original sequence.
export function mergeProgramPage(
  current: Program[],
  incoming: Program[],
): Program[] {
  const seen = new Set(current.map((program) => program.id));
  const additions = incoming.filter((program) => !seen.has(program.id));
  if (additions.length === 0) return current;

  const merged = [...current, ...additions];
  if (!additions.some((program) => program.status === "접수중")) return merged;

  return orderOpenProgramsByImminence(merged);
}

import type { SupabaseClient } from "@supabase/supabase-js";

export const JOB_BOARD_TYPES = ["일자리", "취업지원", "창업", "사회공헌"] as const;
export type JobBoardType = (typeof JOB_BOARD_TYPES)[number];
export type JobBoardFilter = "전체" | JobBoardType;

export const JOB_REGIONS = ["부산", "기타"] as const;
export type JobRegion = (typeof JOB_REGIONS)[number];
export type JobRegionFilter = "전체" | JobRegion;

export type JobSource = "local" | "supabase";

export type Job = {
  id: number;
  boardType: string;
  title: string;
  date: string;
  company: string;
  author: string;
  content: string;
  region: JobRegion;
  sourceUrl: string;
};

// Raw shape of src/data/jobs_all.json, which is produced by the board crawl.
export type JobSourceRow = {
  id: number;
  boardType: string;
  title: string;
  date: string;
  company: string;
  author: string;
  content: string;
  sourceUrl: string;
};

export type SupabaseJobRow = {
  id: string | number | null;
  board_type: string | null;
  title: string | null;
  date: string | null;
  company: string | null;
  author: string | null;
  content: string | null;
  region: string | null;
  source_url: string | null;
};

export type JobCounts = {
  전체: number;
  board: Record<JobBoardFilter, number>;
  region: Record<JobRegionFilter, number>;
};

export const jobPageSize = 12;
// A stalled Supabase call must not block the section, so every request is
// aborted after this window and the hook falls back to the bundled dataset.
export const jobRequestTimeoutMs = 5000;

// Counts verified by `npm run data:jobs` against the 2026-11-08 source file.
// They are only the pre-hydration placeholders shown in the static HTML.
export const defaultJobCounts: JobCounts = {
  전체: 2034,
  board: { 전체: 2034, 일자리: 1406, 취업지원: 459, 창업: 121, 사회공헌: 48 },
  region: { 전체: 2034, 부산: 2011, 기타: 23 },
};

export const jobListColumns = [
  "id",
  "board_type",
  "title",
  "date",
  "company",
  "author",
  "content",
  "region",
  "source_url",
].join(", ");

// The jobs board is run by the Busan center, so a row with no location word is
// still a Busan posting. A row that names another city is filed under 기타 so
// the region filter never hides an out-of-town event.
const BUSAN_DISTRICTS = [
  "해운대구",
  "수영구",
  "남구",
  "부산진구",
  "동래구",
  "금정구",
  "북구",
  "사상구",
  "사하구",
  "서구",
  "중구",
  "동구",
  "영도구",
  "기장군",
  "연제구",
];

const OTHER_REGIONS = [
  "서울",
  "경기",
  "인천",
  "대구",
  "대전",
  "광주",
  "울산",
  "세종",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
  "창원",
  "김해",
  "양산",
  "포항",
  "구미",
  "거제",
  "통영",
  "진주",
  "마산",
];

export function deriveJobRegion(title: string, content: string): JobRegion {
  const text = `${title} ${content}`;
  if (text.includes("부산")) return "부산";
  if (OTHER_REGIONS.some((region) => text.includes(region))) return "기타";
  if (BUSAN_DISTRICTS.some((district) => text.includes(district))) return "부산";
  return "부산";
}

const toJobRegion = (value: unknown): JobRegion =>
  value === "기타" ? "기타" : "부산";

const parseJobId = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function mapLocalJob(row: JobSourceRow): Job {
  const content = row.content ?? "";
  return {
    id: parseJobId(row.id, 0),
    boardType: row.boardType ?? "",
    title: row.title ?? "",
    date: row.date ?? "",
    company: row.company ?? "",
    author: row.author ?? "",
    content,
    region: deriveJobRegion(row.title ?? "", content),
    sourceUrl: row.sourceUrl ?? "",
  };
}

export function mapSupabaseJob(row: SupabaseJobRow, index: number): Job {
  return {
    id: parseJobId(row.id, -(index + 1)),
    boardType: row.board_type ?? "",
    title: row.title ?? "",
    date: row.date ?? "",
    company: row.company ?? "",
    author: row.author ?? "",
    content: row.content ?? "",
    region: toJobRegion(row.region),
    sourceUrl: row.source_url ?? "",
  };
}

// Shared by the seed script so the database copy and the bundled copy always
// derive the same region value.
export function toSupabaseJobRow(row: JobSourceRow) {
  const content = row.content ?? "";
  return {
    id: row.id,
    board_type: row.boardType ?? "",
    title: row.title ?? "",
    date: row.date ?? null,
    company: row.company ?? "",
    author: row.author ?? "",
    content,
    region: deriveJobRegion(row.title ?? "", content),
    source_url: row.sourceUrl ?? "",
  };
}

export function sortJobs(left: Job, right: Job): number {
  return (
    right.date.localeCompare(left.date) || right.id - left.id
  );
}

function matchesQuery(job: Job, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    job.title.toLowerCase().includes(needle) ||
    job.content.toLowerCase().includes(needle)
  );
}

export function filterLocalJobs(
  jobs: Job[],
  filter: { boardType: JobBoardFilter; region: JobRegionFilter; query: string },
): Job[] {
  const needle = filter.query.trim().toLowerCase();
  return jobs.filter(
    (job) =>
      (filter.boardType === "전체" || job.boardType === filter.boardType) &&
      (filter.region === "전체" || job.region === filter.region) &&
      matchesQuery(job, needle),
  );
}

export function countLocalJobs(jobs: Job[]): JobCounts {
  const board: Record<JobBoardFilter, number> = {
    전체: jobs.length,
    일자리: 0,
    취업지원: 0,
    창업: 0,
    사회공헌: 0,
  };
  const region: Record<JobRegionFilter, number> = {
    전체: jobs.length,
    부산: 0,
    기타: 0,
  };
  for (const job of jobs) {
    if (job.boardType in board && job.boardType !== "전체") {
      board[job.boardType as JobBoardType] += 1;
    }
    region[job.region] += 1;
  }
  return { 전체: jobs.length, board, region };
}

export function selectLocalJobPage(
  jobs: Job[],
  filter: { boardType: JobBoardFilter; region: JobRegionFilter; query: string },
  limit: number,
): { rows: Job[]; total: number } {
  const filtered = filterLocalJobs(jobs, filter).sort(sortJobs);
  return { rows: filtered.slice(0, limit), total: filtered.length };
}

const withRequestTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), jobRequestTimeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Supabase request aborted after ${jobRequestTimeoutMs}ms timeout`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

type JobCountFilter =
  | { column: "board_type"; value: string }
  | { column: "region"; value: string };

async function countJobs(
  client: SupabaseClient,
  filter: JobCountFilter | null,
  signal: AbortSignal,
): Promise<number> {
  let query = client.from("jobs").select("id", { count: "exact", head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query.abortSignal(signal);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchJobCounts(client: SupabaseClient): Promise<JobCounts> {
  return withRequestTimeout(async (signal) => {
    const [total, 일자리, 취업지원, 창업, 사회공헌, 부산, 기타] =
      await Promise.all([
        countJobs(client, null, signal),
        countJobs(client, { column: "board_type", value: "일자리" }, signal),
        countJobs(client, { column: "board_type", value: "취업지원" }, signal),
        countJobs(client, { column: "board_type", value: "창업" }, signal),
        countJobs(client, { column: "board_type", value: "사회공헌" }, signal),
        countJobs(client, { column: "region", value: "부산" }, signal),
        countJobs(client, { column: "region", value: "기타" }, signal),
      ]);

    return {
      전체: total,
      board: { 전체: total, 일자리, 취업지원, 창업, 사회공헌 },
      region: { 전체: total, 부산, 기타 },
    };
  });
}

// Commas and parentheses are PostgREST `or` separators, so they cannot be part
// of a search term. Everything else is URL-encoded by the client.
const sanitizeSearchTerm = (value: string) =>
  value.replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim();

export type JobPageParams = {
  boardType: JobBoardFilter;
  region: JobRegionFilter;
  query: string;
  offset: number;
  limit?: number;
};

export async function fetchJobPage(
  client: SupabaseClient,
  { boardType, region, query, offset, limit = jobPageSize }: JobPageParams,
): Promise<{ rows: Job[]; total: number }> {
  return withRequestTimeout(async (signal) => {
    let request = client.from("jobs").select(jobListColumns, { count: "exact" });
    if (boardType !== "전체") request = request.eq("board_type", boardType);
    if (region !== "전체") request = request.eq("region", region);

    const term = sanitizeSearchTerm(query);
    if (term) {
      request = request.or(
        `title.ilike.%${term}%,content.ilike.%${term}%`,
      );
    }

    const { data, error, count } = await request
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1)
      .abortSignal(signal);

    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) return { rows: [], total: 0 };

    return {
      rows: (data as unknown as SupabaseJobRow[]).map(mapSupabaseJob),
      total: count ?? data.length,
    };
  });
}

-- 5060do jobs board archive
-- Target: Supabase project aljizecqcdlqmjnkelah, schema public
-- Run once in the Supabase SQL editor (or via psql). The migration is idempotent.
--
-- The table stores the 2,034 crawled board posts from src/data/jobs_all.json.
-- `region` is derived by scripts/seed-supabase-jobs.mjs so the jobs section can
-- filter Busan vs. out-of-town postings without scanning the body text.

create table if not exists public.jobs (
  id bigint primary key,
  board_type text not null default '',
  title text not null,
  date date,
  company text,
  author text,
  content text,
  region text not null default '부산',
  source_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_jobs_date
  on public.jobs (date desc, id desc);

create index if not exists idx_jobs_board_type
  on public.jobs (board_type, date desc, id desc);

create index if not exists idx_jobs_region
  on public.jobs (region, date desc, id desc);

alter table public.jobs enable row level security;

drop policy if exists "Allow public read access on jobs" on public.jobs;
create policy "Allow public read access on jobs"
  on public.jobs
  for select
  using (true);

grant select on public.jobs to anon, authenticated;
grant all on public.jobs to service_role;

-- Sanity check after seeding:
-- select count(*) as total,
--        count(*) filter (where region = '부산') as busan,
--        count(*) filter (where region = '기타') as other
-- from public.jobs;

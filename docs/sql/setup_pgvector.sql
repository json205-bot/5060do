-- 5060do center knowledge RAG store (pgvector)
-- Target: Supabase project aljizecqcdlqmjnkelah, schema public
-- Run once in the Supabase SQL editor. The migration is idempotent.
--
-- The `public.documents.embedding` column already exists as vector(768) on the
-- live project (verified 2026-11-08). This file records the canonical schema and
-- adds the similarity-search function used by the RAG pipeline.

create extension if not exists vector;

alter table public.documents
  add column if not exists embedding vector(768);

alter table public.documents
  add column if not exists embedding_model text;

alter table public.documents
  add column if not exists embedded_at timestamptz;

-- HNSW works on pgvector >= 0.5. Swap for `ivfflat` if the extension is older.
create index if not exists idx_documents_embedding_hnsw
  on public.documents
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_documents(
  query_embedding vector(768),
  match_count integer default 3,
  min_similarity double precision default 0.0
)
returns table (
  id bigint,
  title text,
  category text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    d.id,
    d.title,
    d.category,
    d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.embedding is not null
    and 1 - (d.embedding <=> query_embedding) >= min_similarity
  order by d.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

grant execute on function public.match_documents(vector, integer, double precision)
  to anon, authenticated;

-- Sanity check: every seeded document should have a 768-dim vector.
-- select count(*) filter (where embedding is null) as missing,
--        count(*) as total
-- from public.documents;

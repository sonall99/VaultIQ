-- ============================================================
-- VaultIQ - Supabase Schema (Python RAG backend)
-- Run this in your Supabase SQL Editor
-- ============================================================

create extension if not exists vector;

-- Document Chunks (core RAG table)
create table if not exists document_chunks (
  id          uuid primary key default gen_random_uuid(),
  doc_id      text not null,
  doc_title   text not null,
  chunk_index int not null,
  text        text not null,
  embedding   vector(768),
  created_at  timestamptz default now()
);

create index if not exists chunks_embedding_idx
  on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create index if not exists chunks_doc_id_idx
  on document_chunks (doc_id);

create or replace function match_chunks(
  query_embedding      vector(768),
  match_count          int     default 5,
  similarity_threshold float   default 0.3
)
returns table (id uuid, doc_id text, doc_title text, text text, similarity float)
language sql stable as $$
  select dc.id, dc.doc_id, dc.doc_title, dc.text,
         1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where 1 - (dc.embedding <=> query_embedding) > similarity_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- User profiles
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  created_at timestamptz default now()
);

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Questionnaires
create table if not exists questionnaires (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id),
  name       text not null,
  raw_text   text not null,
  status     text default 'pending',
  created_at timestamptz default now()
);

-- Runs (version history)
create table if not exists runs (
  id               uuid primary key default gen_random_uuid(),
  questionnaire_id uuid references questionnaires(id),
  user_id          uuid references auth.users(id),
  label            text not null,
  total_questions  int default 0,
  answered_count   int default 0,
  avg_confidence   float default 0,
  created_at       timestamptz default now()
);

-- Answers
create table if not exists answers (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid references runs(id) on delete cascade,
  question_num       int not null,
  question_text      text not null,
  answer_text        text,
  citations          text[] default '{}',
  evidence           text,
  confidence         float default 0,
  hallucination_risk text default 'low',
  edited_by_user     boolean default false,
  edited_at          timestamptz,
  created_at         timestamptz default now()
);

-- Analytics
create table if not exists analytics_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id),
  event_type text not null,
  metadata   jsonb default '{}',
  created_at timestamptz default now()
);

-- Row Level Security
alter table questionnaires enable row level security;
alter table runs enable row level security;
alter table answers enable row level security;

create policy "Users see own questionnaires"
  on questionnaires for all using (user_id = auth.uid());

create policy "Users see own runs"
  on runs for all using (user_id = auth.uid());

create policy "Users see own answers"
  on answers for all using (
    run_id in (select id from runs where user_id = auth.uid())
  );

-- document_chunks: no RLS - accessed only by Python backend
-- using the service key (bypasses RLS by design)

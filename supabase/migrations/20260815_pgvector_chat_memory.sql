-- Apply in the Supabase SQL editor before deploying the Node RAG service.
create extension if not exists vector with schema extensions;

create table if not exists public.chat_memory_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null,
  message_key text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  chunk_index integer not null check (chunk_index >= 0),
  embedding extensions.vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (chat_id, message_key, chunk_index)
);

create index if not exists chat_memory_chunks_user_chat_idx
  on public.chat_memory_chunks (user_id, chat_id, created_at desc);
create index if not exists chat_memory_chunks_embedding_idx
  on public.chat_memory_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.chat_memory_chunks enable row level security;
drop policy if exists "Users manage their own chat memory" on public.chat_memory_chunks;
create policy "Users manage their own chat memory" on public.chat_memory_chunks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.match_chat_memory(
  query_embedding extensions.vector(1536),
  filter_user_id uuid,
  filter_chat_ids uuid[],
  match_count integer default 6
)
returns table (id uuid, chat_id uuid, role text, content text, metadata jsonb, similarity double precision)
language sql stable
as $$
  select id, chat_id, role, content, metadata, 1 - (embedding <=> query_embedding) as similarity
  from public.chat_memory_chunks
  where user_id = filter_user_id and chat_id = any(filter_chat_ids)
  order by embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

create or replace function public.copy_chat_memory(
  target_chat_id uuid,
  source_chat_ids uuid[],
  owner_user_id uuid
)
returns void
language plpgsql
as $$
begin
  if coalesce(array_length(source_chat_ids, 1), 0) < 2 then
    raise exception 'At least two source chats are required';
  end if;

  insert into public.chat_memory_chunks
    (user_id, chat_id, message_key, role, content, chunk_index, embedding, metadata, created_at)
  select user_id, target_chat_id, message_key, role, content, chunk_index, embedding, metadata, created_at
  from public.chat_memory_chunks
  where user_id = owner_user_id and chat_id = any(source_chat_ids)
  on conflict (chat_id, message_key, chunk_index) do nothing;
end;
$$;

-- Free-tier migration: replace paid vector embeddings with PostgreSQL full-text search.
-- Run this after 20260815_pgvector_chat_memory.sql if that migration was already applied.

drop index if exists public.chat_memory_chunks_embedding_idx;
alter table public.chat_memory_chunks drop column if exists embedding;
alter table public.chat_memory_chunks
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple'::regconfig, coalesce(content, ''))) stored;

create index if not exists chat_memory_chunks_search_idx
  on public.chat_memory_chunks using gin (search_vector);

-- The old function refers to the removed embedding column.
drop function if exists public.match_chat_memory(extensions.vector, uuid, uuid[], integer);

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
    (user_id, chat_id, message_key, role, content, chunk_index, metadata, created_at)
  select user_id, target_chat_id, message_key, role, content, chunk_index, metadata, created_at
  from public.chat_memory_chunks
  where user_id = owner_user_id and chat_id = any(source_chat_ids)
  on conflict (chat_id, message_key, chunk_index) do nothing;
end;
$$;

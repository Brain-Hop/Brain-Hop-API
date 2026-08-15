# Free text-search RAG migration

## What changes

The deployed runtime becomes one Node API service. It stores message chunks in
Supabase Postgres, retrieves matching chunks with full-text search, and calls
OpenRouter's free router for the answer. The old Flask, Chroma, and local HuggingFace model
are not started in production.

The frontend routes stay the same: `/api/rag/chat`, `/api/rag/merge_chats`,
and `/api/rag/close_chat`.

## Before you deploy

1. Rotate any Supabase service-role or OpenRouter keys that were ever exposed.
2. In Supabase SQL Editor, run `supabase/migrations/20260815_pgvector_chat_memory.sql`.
3. Then run `supabase/migrations/20260816_free_text_chat_memory.sql`.
4. Confirm `chat_memory_chunks` has a `search_vector` column and `copy_chat_memory`.
5. Set the Render variables below. Do not add any of them as `VITE_*` values.

```text
SUPABASE_URL=<project URL>
SUPABASE_KEY=<service role key>
OPENROUTER_API_KEY=<existing completion key>
FREE_MODEL=openrouter/free
FRONTEND_URL=https://<your-vercel-site>.vercel.app
CORS_ALLOWED_ORIGINS=https://<custom-domain-if-any>
```

`openrouter/free` is zero-cost but rate-limited. The API ignores paid model
names supplied by the frontend and falls back to `FREE_MODEL`.

## Existing memory migration

Existing Chroma ZIP vectors are not used. Leave ZIP artifacts in Supabase
Storage untouched.

The supported backfill reads message history from `chats.chat` and creates
searchable text rows. First run a dry run:

```text
npm run backfill:memory
```

After inspecting the output, run:

```text
npm run backfill:memory -- --apply
```

Chats with no `chats.chat` message array need a one-time local Chroma export;
they must not be deleted until that export has been verified.

## Rollout and rollback

1. Apply database migration.
2. Deploy the Node service with the new environment variables.
3. Run the UAT checklist in `docs/FREE_TIER_UAT.md` using a test account.
4. Backfill existing messages and verify sampled old chats.
5. Retire the Flask Render service only after successful UAT.

If the new API fails, restore the previous Node deployment and retain the
Flask service. The SQL migration and old ZIP files are non-destructive.

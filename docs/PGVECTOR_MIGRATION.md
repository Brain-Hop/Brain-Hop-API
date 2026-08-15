# pgvector RAG migration

## What changes

The deployed runtime becomes one Node API service. It stores message chunks in
Supabase pgvector, retrieves the relevant chunks for each question, and calls
OpenRouter for the answer. The old Flask, Chroma, and local HuggingFace model
are not started in production.

The frontend routes stay the same: `/api/rag/chat`, `/api/rag/merge_chats`,
and `/api/rag/close_chat`.

## Before you deploy

1. Rotate any Supabase service-role or OpenRouter keys that were ever exposed.
2. Create an OpenAI API key for embeddings. It must be a backend-only secret.
3. In Supabase SQL Editor, run `supabase/migrations/20260815_pgvector_chat_memory.sql`.
4. Confirm the migration created `chat_memory_chunks`, `match_chat_memory`, and
   `copy_chat_memory`.
5. Set the Render variables below. Do not add any of them as `VITE_*` values.

```text
SUPABASE_URL=<project URL>
SUPABASE_KEY=<service role key>
OPENROUTER_API_KEY=<existing completion key>
OPENAI_API_KEY=<embedding key>
FRONTEND_URL=https://<your-vercel-site>.vercel.app
CORS_ALLOWED_ORIGINS=https://<custom-domain-if-any>
```

## Existing memory migration

Existing Chroma ZIP vectors cannot be reused because they were generated with a
different embedding model. Leave ZIP artifacts in Supabase Storage untouched.

The supported backfill reads message history from `chats.chat` and creates new
embeddings. First run a dry run:

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

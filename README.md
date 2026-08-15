# Brain Hop API

The Brain Hop backend provides authenticated AI conversations, searchable chat
memory, image context, and chat merging.

This branch replaces the deployment-time Flask/Chroma/HuggingFace runtime with:

- Google Gemini `gemini-embedding-001` free-tier embeddings for multilingual semantic memory.
- Supabase Postgres + pgvector for persistent semantic memory.
- OpenRouter for answers using the exact model selected in the frontend.
- Render Free for the Node API and Vercel for the React frontend.

The legacy `chatbot/` directory is rollback material only; it is not part of
the Node-only deployment.

## Data-flow diagram

```mermaid
flowchart LR
  U["User browser"] --> V["Vercel: React frontend"]
  V -->|"Bearer token + HTTPS"| A["Render: Node/Express API"]
  A --> AUTH["Supabase Auth: verify user"]
  A -->|"embed message/query"| E["Gemini free embeddings"]
  A -->|"store + semantic search"| DB["Supabase Postgres + pgvector"]
  A -->|"upload/download images"| S["Supabase Storage"]
  A -->|"answer + image description"| L["OpenRouter"]
  A --> V
```

## What is stored where

| Data | Location | Purpose |
| --- | --- | --- |
| Login/session | Supabase Auth | Identifies the current user. |
| Chat metadata and UI history | `chats` table | Restores sidebar and message history. |
| Searchable message chunks | `chat_memory_chunks` | Semantic retrieval with pgvector. |
| Uploaded images | `chat_vectors` Storage bucket | Image context, owned by the authenticated user. |
| Gemini and OpenRouter API keys | Render environment | Never sent to the browser. |

## Prerequisites

- Node.js 20 or later.
- A Supabase project with Auth and the existing `chats` table/bucket.
- An OpenRouter API key for chat generation.
- A free-tier Google AI Studio API key for Gemini embeddings.
- A Vercel deployment of the `Brain-Hop` frontend.

## Local setup

1. In `Brain-Hop-API`, copy `.env.example` to `.env`.

2. Fill in the values. `SUPABASE_KEY` is a server-only service-role key; do
   not use it in Vercel or in any `VITE_*` variable.

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_service_role_key
OPENROUTER_API_KEY=your_openrouter_key
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
PORT=3001
FRONTEND_URL=http://localhost:5173
CORS_ALLOWED_ORIGINS=http://localhost:8080
```

3. Install and start the API.

```powershell
npm ci
npm start
```

4. Verify the health check:

```text
http://localhost:3001/api/health
```

## Database migration

Before using chat memory, open Supabase Dashboard → SQL Editor and run:

```text
supabase/migrations/20260815_pgvector_chat_memory.sql
```

The migration enables pgvector, creates `chat_memory_chunks`, enables RLS, and
adds memory-match/copy functions. It does not delete old Chroma ZIP artifacts.

## Existing chat backfill

Old Chroma vectors use a different embedding model and cannot be reused. The
backfill rebuilds vectors from persisted `chats.chat` JSON history.

```powershell
# Preview only
npm run backfill:memory

# Apply after reviewing preview output
npm run backfill:memory -- --apply
```

Keep old ZIP artifacts until sampled old chats pass UAT.

## Docker

Create `.env`, then run:

```powershell
docker compose up --build
```

The Node API runs on port `3001`. Docker Compose intentionally does not start
the legacy Python RAG service.

## Production deployment

### Render API

Deploy this repository using `render.yaml` or a Docker Web Service. Set the
variables above, with your Vercel production URL:

```text
FRONTEND_URL=https://your-project.vercel.app
CORS_ALLOWED_ORIGINS=https://app.yourdomain.com
```

Set the health-check path to `/api/health`. The API needs `GEMINI_API_KEY`, not
`OPENAI_API_KEY`. The chat endpoint forwards the model selected in the frontend
unchanged for both replies and image descriptions.

### Vercel frontend

Set these Vercel variables in the `Brain-Hop` frontend project:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_BASE_URL=https://your-render-api.onrender.com
```

Only the Supabase anon key belongs in Vercel. Never expose service-role, Gemini,
or OpenRouter keys in frontend variables.

## Verification

```powershell
npm test
node --check server.js
```

For end-to-end validation, use [docs/FREE_TIER_UAT.md](docs/FREE_TIER_UAT.md).
For rollout, rollback, and backfill detail, use
[docs/PGVECTOR_MIGRATION.md](docs/PGVECTOR_MIGRATION.md).

## Security controls

- Protected routes verify the Supabase Bearer token and derive ownership from it.
- CORS accepts only configured exact frontend origins.
- Uploaded images have type and 5 MB limits.
- Chat rows, vectors, and image paths are scoped to the authenticated user.
- API credentials are runtime environment variables only.

## Free-tier note

Render Free can sleep after inactivity, so the first request after idle may be
slow. The API no longer loads PyTorch, Chroma, or a local embedding model, which
removes the prior memory failure. Gemini free-tier embeddings and OpenRouter free
models have quotas and availability limits; this is suitable for personal use and demos. 
One expected limitation: if a user uploads an image while choosing a text-only model, that selected provider model may reject image input. The backend will not substitute another model.

# Brain Hop deployment: Vercel + Render free tier

Deploy one Node API service on Render. The retired Flask, Chroma, and local
HuggingFace runtime are not deployed.

```text
Browser (Vercel) -> Node API (Render) -> Supabase pgvector + Gemini embeddings
                                      -> OpenRouter selected model
```

Render Free is appropriate for a personal project or demo. It sleeps after
inactivity, so the first request can take roughly a minute.

## 1. Apply the Supabase migration

In Supabase SQL Editor, run:

```text
supabase/migrations/20260815_pgvector_chat_memory.sql
```

## 2. Deploy the Node API on Render

Create one Render **Web Service** from this repository:

- Root directory: `.`
- Runtime: Docker
- Dockerfile path: `./Dockerfile`
- Instance type: Free
- Health check path: `/api/health`

Set these backend-only variables:

```env
SUPABASE_URL=<your Supabase project URL>
SUPABASE_KEY=<your Supabase service-role key>
OPENROUTER_API_KEY=<your OpenRouter key>
GEMINI_API_KEY=<your Google AI Studio key>
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
IMAGE_DESCRIPTION_MODEL=nvidia/nemotron-nano-12b-v2-vl:free
FRONTEND_URL=https://<your-vercel-project>.vercel.app
CORS_ALLOWED_ORIGINS=https://<your-vercel-project>.vercel.app
```

The API forwards the exact model chosen in the frontend to OpenRouter. The
image-description model is separate because only vision-capable models can
caption uploaded images.

## 3. Configure the Vercel frontend

Set these variables in the `Brain-Hop` Vercel project and redeploy:

```env
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon key>
VITE_API_BASE_URL=https://<your-api-service>.onrender.com
```

Never expose the Supabase service-role key, Gemini key, or OpenRouter key in a
`VITE_*` variable. Add the Vercel production URL to Supabase Auth redirect URLs
if you use email-link authentication or OAuth.

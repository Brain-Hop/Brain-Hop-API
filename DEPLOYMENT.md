# Brain Hop deployment: Vercel + Render free tier

Use Vercel for the React frontend and Render for both backend services. This is
appropriate for a portfolio/demo: free Render services sleep after 15 minutes,
so the first request can take roughly a minute. Do not use this setup where
always-on chat is required.

```
Browser (Vercel) -> Express API (Render) -> Flask RAG (Render)
                              |                 |
                           Supabase          OpenRouter
```

The browser talks only to the Express API. The RAG service is public on the
free tier because free Render services cannot receive private-network traffic,
but it rejects all chat operations unless the request has the shared
`RAG_INTERNAL_TOKEN`. Never put that token in Vercel or browser code.

## 1. Deploy the RAG service first

Create a Render **Web Service** from this repository:

- Root directory: `chatbot`
- Runtime: Docker
- Dockerfile path: `./Dockerfile`
- Instance type: Free
- Health check path: `/health`

Set these Render environment variables:

```
SUPABASE_URL=<your Supabase project URL>
SUPABASE_KEY=<your Supabase service-role key>
OPENROUTER_API_KEY=<your OpenRouter key>
RAG_INTERNAL_TOKEN=<a long random secret>
PYTHONUNBUFFERED=1
```

Copy its public URL, for example `https://brain-hop-chatbot.onrender.com`.

## 2. Deploy the Express API

Create another Render **Web Service** from the repository root:

- Root directory: `.`
- Runtime: Docker
- Dockerfile path: `./Dockerfile`
- Instance type: Free
- Health check path: `/api/health`

Set:

```
SUPABASE_URL=<same project URL>
SUPABASE_KEY=<same service-role key>
RAG_BASE_URL=https://<your-rag-service>.onrender.com
RAG_INTERNAL_TOKEN=<exactly the same secret used by RAG>
FRONTEND_URL=https://<your-vercel-project>.vercel.app
```

For a custom domain or another approved frontend, use
`CORS_ALLOWED_ORIGINS` with comma-separated, exact origins, for example:

```
CORS_ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com
```

Wildcards are intentionally unsupported. This prevents arbitrary websites from
calling the API from a browser. CORS is not authentication: protected API
routes still verify the user's Supabase Bearer token.

## 3. Deploy the frontend on Vercel

Import the `Brain-Hop` folder/repository in Vercel. Its `vercel.json` already
supports direct React Router URLs. Add these Vercel environment variables, then
redeploy:

```
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon key>
VITE_API_BASE_URL=https://<your-api-service>.onrender.com
```

Only the Supabase anon key is allowed in `VITE_*` variables. Add the Vercel
production URL to Supabase Auth's allowed redirect URLs if authentication uses
email links or OAuth.

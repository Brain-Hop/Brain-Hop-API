# Free-tier deployment UAT

Run this after deploying the Node-only Render service and before removing the
legacy Flask service.

## Setup

- Use two different Supabase users: User A and User B.
- Confirm Render has `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, Supabase server
  credentials, `IMAGE_DESCRIPTION_MODEL` set to a free vision model, and the exact
  Vercel origin in `FRONTEND_URL`.
- Confirm `GET /api/health` returns `200`.

## Test flow

1. User A signs in, creates a chat, and asks a fact-containing question.
   Expected: an answer appears; Render logs show no Python, Torch, or Chroma startup.
2. In the same chat, ask a related follow-up that relies on the first message.
   Expected: the answer uses relevant earlier context.
3. Upload a PNG or JPG and ask a question about it.
   Expected: upload succeeds, an answer appears, and later related questions can use its description.
4. Create two chats for User A, add distinct facts, merge them, then ask about
   both facts in the merged chat.
   Expected: memory from both source chats is available.
5. Delete one chat.
   Expected: it disappears from the UI and its `chat_memory_chunks` rows are removed.
6. Sign in as User B and ask a question matching User A's private fact.
   Expected: User A's content is never returned.
7. Reload the Vercel app and verify User A's persisted chats reload.
8. Leave Render idle until its free service sleeps, then send another message.
   Expected: the first request may be slow while waking, but it succeeds without an out-of-memory restart.

## Failure evidence to capture

For any failure record the endpoint, HTTP status, Render request ID/log time,
and whether it happened before or after an idle wake-up. Do not paste tokens,
Supabase keys, or authorization headers into issues.

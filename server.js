
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mime = require('mime-types');

// Shared Supabase client (single source of truth)
const { supabase } = require('./src/utils/supabase');
const { requireAuth, assertRequestedUser } = require('./src/middleware/auth');

// -------------------- CONFIG --------------------
const app = express();
const port = Number(process.env.PORT || 3001);

// Point this to your Flask MULTI-CHAT RAG service
const RAG_BASE_URL = process.env.RAG_BASE_URL || (process.env.RAG_HOSTPORT ? `http://${process.env.RAG_HOSTPORT}` : 'http://localhost:5001');
const RAG_TIMEOUT_MS = Number(process.env.RAG_TIMEOUT_MS || 90_000);
const RAG_INTERNAL_TOKEN = process.env.RAG_INTERNAL_TOKEN;

if (!RAG_INTERNAL_TOKEN) {
  throw new Error('RAG_INTERNAL_TOKEN must be configured');
}

// JSON body limits (allow some headroom if questions get long)
function parseOrigins(...values) {
  return values
    .flatMap((value) => String(value || '').split(','))
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

const allowedOrigins = new Set(
  parseOrigins(
    process.env.FRONTEND_URL,
    process.env.CORS_ALLOWED_ORIGINS,
    'http://localhost:8080',
    'http://localhost:5173'
  )
);
app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = String(origin || '').replace(/\/$/, '');
    if (!origin || allowedOrigins.has(normalizedOrigin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  maxAge: 86_400,
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '10mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const requestBuckets = new Map();
app.use('/api', (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = requestBuckets.get(key) || { startedAt: now, count: 0 };
  if (now - bucket.startedAt > 60_000) {
    bucket.startedAt = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  requestBuckets.set(key, bucket);
  if (bucket.count > 120) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  return next();
});

// Middleware to log every incoming request
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health/test endpoint
app.get('/api/test', (_req, res) => {
  res.json({ message: 'Hello from the backend!' });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'brain-hop-api', timestamp: new Date().toISOString() });
});

// -------------------- AUTH ENDPOINTS --------------------
const loginHandler = require('./src/routes/auth_login');
app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await loginHandler(req);
    const status = result?.status || 200;
    const { status: _s, ...payload } = result || {};

    return res.status(status).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

const signupHandler = require('./src/routes/auth_signup');
app.post('/api/auth/signup', async (req, res) => {
  try {
    const result = await signupHandler(req);
    const status = result?.status || 201;
    const { status: _s, ...payload } = result || {};
    return res.status(status).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

const sessionHandler = require('./src/routes/auth_session');
app.post('/api/auth/session', async (req, res) => {
  try {
    const result = await sessionHandler(req);
    const status = result?.status || 200;
    const { status: _s, ...payload } = result || {};
    return res.status(status).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

const logoutHandler = require('./src/routes/auth_logout');
app.post('/api/auth/logout', async (req, res) => {
  try {
    const result = await logoutHandler(req);
    const status = result?.status || 200;
    const { status: _s, ...payload } = result || {};
    return res.status(status).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

// -------------------- UTIL: FILENAME SANITIZER --------------------
function sanitizeFilename(name) {
  return String(name || 'upload').replace(/[^\w.\-]+/g, '_');
}

// -------------------- IMAGE UPLOAD (Supabase) --------------------
// Accepts multipart/form-data: fields => user_id, chat_id; file => image
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    callback(null, allowed.has(file.mimetype));
  },
});

/**
 * POST /api/rag/image
 * form-data:
 *  - user_id (required)
 *  - chat_id (required)
 *  - image   (file, required)
 *
 * Returns: { image_name: string }
 *   image_name is the exact key stored in Supabase bucket 'chat_vectors'
 *   Your Flask will download it via:
 *     supabase.storage.from_("chat_vectors").download(image_name)
 */
app.post('/api/rag/image', requireAuth, uploadMemory.single('image'), async (req, res) => {
  try {
    const { user_id, chat_id } = req.body || {};
    const file = req.file;

    if (!assertRequestedUser(req, user_id) || !chat_id) {
      return res.status(400).json({ error: 'A valid chat_id is required' });
    }
    if (!file) {
      return res.status(400).json({ error: 'image file is required (field name: image)' });
    }

    const original = sanitizeFilename(file.originalname || 'upload');
    const ext = mime.extension(file.mimetype) || original.split('.').pop() || 'bin';
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    // ensure single dot between base and extension
    const base = original.replace(/\.[^/.]+$/, '');
    const filename = `${base}.${ext}`;

    const storagePath = `images/${req.user.id}/${chat_id}/${stamp}-${rand}-${filename}`.replace(/\.+\./g, '.');

    const { error } = await supabase.storage
      .from('chat_vectors')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: true,
      });

    if (error) {
      console.error('[UPLOAD] Supabase error:', error);
      return res.status(500).json({ error: 'Failed to upload image to storage' });
    }

    console.log(`[UPLOAD] Saved to Supabase: ${storagePath}`);
    return res.status(201).json({ image_name: storagePath, image_type: file.mimetype });
  } catch (e) {
    console.error('[UPLOAD] /api/rag/image error:', e?.message || e);
    return res.status(500).json({ error: 'Image upload failed' });
  }
});

// -------------------- RAG ENDPOINTS (Flask Integration) --------------------

/**
 * POST /api/rag/chat
 * Body:
 *  - user_id (required)
 *  - chat_id (required)
 *  - model_name (required)
 *  - question (required)
 *  - image_name (optional)  -> if provided, we set has_image=true automatically
 *  - has_image (optional)   -> overrides auto-detect if provided as true
 */
app.post('/api/rag/chat', requireAuth, async (req, res) => {
  try {
    const { user_id, chat_id, model_name, question, image_name, has_image } = req.body || {};
    if (!assertRequestedUser(req, user_id) || !chat_id || !model_name || !question || typeof question !== 'string' || question.length > 20_000) {
      return res.status(400).json({ error: 'A valid chat_id, model_name, and question (up to 20,000 characters) are required' });
    }

    // Auto determine has_image if not explicitly provided
    const willSendHasImage =
      typeof has_image !== 'undefined'
        ? String(has_image).toLowerCase() === 'true' || has_image === true
        : Boolean(image_name);

    const payload = {
      user_id: req.user.id,
      chat_id,
      model_name,
      question,
      has_image: willSendHasImage ? 'true' : 'false', // Flask checks lowercased string
      image_name: image_name || 'false',              // Flask treats "false" as no image
    };

    console.log(`[RAG] → /chat chat:${chat_id} model:${model_name} has_image:${payload.has_image}`);
    const ragStartedAt = Date.now();

    const response = await axios.post(`${RAG_BASE_URL}/chat`, payload, {
      timeout: RAG_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { 'X-Internal-Token': RAG_INTERNAL_TOKEN },
    });

    const short =
      typeof response.data === 'string'
        ? response.data.slice(0, 300)
        : JSON.stringify(response.data).slice(0, 300);

    console.log(`[RAG] ← /chat [${response.status}] ${Date.now() - ragStartedAt}ms ${short}`);

    if (response.status >= 200 && response.status < 300) {
      return res.status(response.status).json(response.data);
    }

    return res.status(response.status).json({
      error: 'RAG upstream error',
      detail: short,
    });
  } catch (err) {
    console.error('[RAG] /chat error:', err?.message || err);
    return res.status(500).json({ error: 'RAG chat request failed' });
  }
});

/**
 * POST /api/rag/close_chat
 * Body: { user_id, chat_id }
 */
app.post('/api/rag/close_chat', requireAuth, async (req, res) => {
  try {
    const { user_id, chat_id } = req.body || {};
    if (!assertRequestedUser(req, user_id) || !chat_id) {
      return res.status(400).json({ error: 'A valid chat_id is required' });
    }

    console.log(`[RAG] → /close_chat user:${user_id} chat:${chat_id}`);

    const response = await axios.post(`${RAG_BASE_URL}/close_chat`, { user_id: req.user.id, chat_id }, {
      timeout: 25000,
      headers: { 'X-Internal-Token': RAG_INTERNAL_TOKEN },
    });

    console.log(`[RAG] ← /close_chat [${response.status}]`);
    return res.status(response.status).json(response.data);
  } catch (err) {
    console.error('[RAG] /close_chat error:', err?.message || err);
    const status = err.response?.status || 500;
    return res.status(status).json({ error: 'RAG close_chat request failed' });
  }
});

/**
 * POST /api/rag/merge_chats
 * Body: { user_id, new_chat_id, merge_chat_ids: string[] }
 */
app.post('/api/rag/merge_chats', requireAuth, async (req, res) => {
  try {
    const { user_id, new_chat_id, merge_chat_ids } = req.body || {};
    if (!assertRequestedUser(req, user_id) || !new_chat_id || !Array.isArray(merge_chat_ids) || merge_chat_ids.length < 2) {
      return res.status(400).json({
        error: 'user_id, new_chat_id and merge_chat_ids (>=2) are required'
      });
    }

    console.log(`[RAG] → /merge_chats user:${user_id} new_chat:${new_chat_id} from:[${merge_chat_ids.join(', ')}]`);

    const response = await axios.post(
      `${RAG_BASE_URL}/merge_chats`,
      { user_id: req.user.id, new_chat_id, merge_chat_ids },
      { timeout: 120000, validateStatus: () => true, headers: { 'X-Internal-Token': RAG_INTERNAL_TOKEN } }
    );

    const short =
      typeof response.data === 'string'
        ? response.data.slice(0, 300)
        : JSON.stringify(response.data).slice(0, 300);

    console.log(`[RAG] ← /merge_chats [${response.status}] ${short}`);

    if (response.status >= 200 && response.status < 300) {
      return res.status(response.status).json(response.data);
    }

    return res.status(response.status).json({
      error: 'RAG merge_chats upstream error',
      detail: short,
    });
  } catch (err) {
    console.error('[RAG] /merge_chats error:', err?.message || err);
    return res.status(500).json({ error: 'RAG merge_chats request failed' });
  }
});

/**
 * POST /api/chats/save
 * Body: { user_id, chat_id?, title, zip_file_url?, vector_count?, chat? }
 * Creates or updates a chat in the chats table
 */
app.post('/api/chats/save', requireAuth, async (req, res) => {
  try {
    const { user_id, chat_id, title, zip_file_url, vector_count, chat } = req.body || {};
    
    if (!assertRequestedUser(req, user_id)) {
      return res.status(403).json({ error: 'You can only save your own chats' });
    }

    const { upsertChat } = require('./src/utils/chat_helpers');
    const result = await upsertChat(supabase, req.user.id, chat_id, {
      title: title || 'New Conversation',
      zip_file_url: zip_file_url || '',
      vector_count: vector_count || 0,
      chat: chat || null,
    });

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json({
      chat_id: result.chat_id,
      chat: result.data 
    });
  } catch (err) {
    console.error('[CHAT] /api/chats/save error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save chat' });
  }
});

/**
 * GET /api/chats
 * query: user_id
 * Returns list of chats for the user
 */
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!assertRequestedUser(req, user_id)) {
      return res.status(403).json({ error: 'You can only access your own chats' });
    }

    const { getChats } = require('./src/utils/chat_helpers');
    const result = await getChats(supabase, req.user.id);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json({ chats: result.data });
  } catch (err) {
    console.error('[CHAT] GET /api/chats error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

/**
 * POST /api/chats/sync
 * Body: { chats: Array<chatRecord> }
 * Batch syncs multiple chats to Supabase (upsert for each)
 */
app.post('/api/chats/sync', requireAuth, async (req, res) => {
  try {
    const { chats } = req.body || {};
    
    if (!Array.isArray(chats)) {
      return res.status(400).json({ error: 'chats must be an array' });
    }

    if (chats.length === 0) {
      return res.status(200).json({ message: 'No chats to sync', synced: 0 });
    }

    console.log(`[CHAT SYNC] Syncing ${chats.length} chats to Supabase...`);

    const { upsertChat } = require('./src/utils/chat_helpers');
    const results = [];
    const errors = [];

    // Process each chat
    for (const chatRecord of chats) {
      const { chat_id, title, zip_file_url, vector_count, chat } = chatRecord;
      
      if (!chat_id) {
        errors.push({ chat_id: 'unknown', error: 'Missing chat_id' });
        continue;
      }

      const result = await upsertChat(supabase, req.user.id, chat_id, {
        title: title || 'New Conversation',
        zip_file_url: zip_file_url || '',
        vector_count: vector_count || 0,
        chat: chat || null,
      });

      if (result.error) {
        errors.push({ chat_id, error: result.error });
      } else {
        results.push({ chat_id, success: true });
      }
    }

    const synced = results.length;
    const failed = errors.length;

    console.log(`[CHAT SYNC] Completed: ${synced} synced, ${failed} failed`);

    if (failed > 0) {
      console.error('[CHAT SYNC] Errors:', errors);
    }

    return res.status(200).json({
      message: `Synced ${synced} chats${failed > 0 ? `, ${failed} failed` : ''}`,
      synced,
      failed,
      errors: failed > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[CHAT SYNC] /api/chats/sync error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to sync chats' });
  }
});

/**
 * DELETE /api/chats/:chatId
 * Deletes the persisted chat and the RAG artifacts owned by the authenticated user.
 */
app.delete('/api/chats/:chatId', requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(chatId)) return res.status(400).json({ error: 'Invalid chat id' });

  try {
    const { error } = await supabase.from('chats').delete().eq('chat_id', chatId).eq('user_id', req.user.id);
    if (error) throw error;

    const vectorPath = `${req.user.id}_${chatId}_chat_memory.zip`;
    const imagePrefix = `images/${req.user.id}/${chatId}`;
    const { data: images, error: listError } = await supabase.storage.from('chat_vectors').list(imagePrefix);
    if (listError) console.warn('[CHAT DELETE] Could not list images:', listError.message);

    const paths = [vectorPath, ...(images || []).map((image) => `${imagePrefix}/${image.name}`)];
    const { error: storageError } = await supabase.storage.from('chat_vectors').remove(paths);
    if (storageError) console.warn('[CHAT DELETE] Storage cleanup warning:', storageError.message);

    console.log(`[CHAT DELETE] Deleted chat ${chatId} and ${paths.length} stored artifacts`);
    return res.status(200).json({ deleted: true });
  } catch (error) {
    console.error('[CHAT DELETE] Failed:', error.message || error);
    return res.status(500).json({ error: 'Unable to delete this chat. Please try again.' });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload rejected: ${error.message}` });
  }
  if (error?.message === 'Origin is not allowed by CORS') {
    return res.status(403).json({ error: 'Origin is not allowed' });
  }
  console.error('[API] Unhandled request error:', error?.message || error);
  return res.status(500).json({ error: 'Unexpected server error' });
});

// -------------------- PRIVACY & TERMS --------------------
app.get('/privacy', require('./src/routes/privacy'));
app.get('/terms', require('./src/routes/terms'));
app.get('/api/stats', require('./src/routes/stats'));

// -------------------- START SERVER --------------------
app.listen(port, () => {
  console.log(`✅ Server is running on http://localhost:${port}`);
  console.log(`[RAG] Base URL: ${RAG_BASE_URL}`);
});

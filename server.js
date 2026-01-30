
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mime = require('mime-types');

// Shared Supabase client (single source of truth)
const { supabase } = require('./supabase');

// -------------------- CONFIG --------------------
const app = express();
const port = 3001;

// Point this to your Flask MULTI-CHAT RAG service (NOT the ngrok inspector page!)
const RAG_BASE_URL ='https://wholistic-felicidad-crankily.ngrok-free.dev';

// JSON body limits (allow some headroom if questions get long)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware to log every incoming request
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health/test endpoint
app.get('/api/test', (_req, res) => {
  res.json({ message: 'Hello from the backend!' });
});

// -------------------- AUTH ENDPOINTS --------------------
const loginHandler = require('./auth_login');
app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await loginHandler(req);
    const status = result?.status || 200;
    const { status: _s, ...payload } = result || {};

    if (payload?.token) {
      console.log(`[AUTH] Access token (truncated): ${String(payload.token).slice(0, 12)}...`);
    }
    return res.status(status).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

const signupHandler = require('./auth_signup');
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

const sessionHandler = require('./auth_session');
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

const logoutHandler = require('./auth_logout');
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
const uploadMemory = multer({ storage: multer.memoryStorage() });

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
app.post('/api/rag/image', uploadMemory.single('image'), async (req, res) => {
  try {
    const { user_id, chat_id } = req.body || {};
    const file = req.file;

    if (!user_id || !chat_id) {
      return res.status(400).json({ error: 'user_id and chat_id are required' });
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

    const storagePath = `images/${user_id}/${chat_id}/${stamp}-${rand}-${filename}`.replace(/\.+\./g, '.');

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
    return res.status(201).json({ image_name: storagePath });
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
app.post('/api/rag/chat', async (req, res) => {
  try {
    const { user_id, chat_id, model_name, question, image_name, has_image } = req.body || {};
    if (!user_id || !chat_id || !model_name || !question) {
      return res.status(400).json({ error: 'user_id, chat_id, model_name, and question are required' });
    }

    // Auto determine has_image if not explicitly provided
    const willSendHasImage =
      typeof has_image !== 'undefined'
        ? String(has_image).toLowerCase() === 'true' || has_image === true
        : Boolean(image_name);

    const payload = {
      user_id,
      chat_id,
      model_name,
      question,
      has_image: willSendHasImage ? 'true' : 'false', // Flask checks lowercased string
      image_name: image_name || 'false',              // Flask treats "false" as no image
    };

    console.log(
      `[RAG] → /chat user:${user_id} chat:${chat_id} model:${model_name} has_image:${payload.has_image} image_name:${payload.image_name}`
    );

    const response = await axios.post(`${RAG_BASE_URL}/chat`, payload, {
      timeout: 30000,
      validateStatus: () => true,
    });

    const short =
      typeof response.data === 'string'
        ? response.data.slice(0, 300)
        : JSON.stringify(response.data).slice(0, 300);

    console.log(`[RAG] ← /chat [${response.status}] ${short}`);

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
app.post('/api/rag/close_chat', async (req, res) => {
  try {
    const { user_id, chat_id } = req.body || {};
    if (!user_id || !chat_id) {
      return res.status(400).json({ error: 'user_id and chat_id are required' });
    }

    console.log(`[RAG] → /close_chat user:${user_id} chat:${chat_id}`);

    const response = await axios.post(`${RAG_BASE_URL}/close_chat`, { user_id, chat_id }, {
      timeout: 25000,
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
app.post('/api/rag/merge_chats', async (req, res) => {
  try {
    const { user_id, new_chat_id, merge_chat_ids } = req.body || {};
    if (!user_id || !new_chat_id || !Array.isArray(merge_chat_ids) || merge_chat_ids.length < 2) {
      return res.status(400).json({
        error: 'user_id, new_chat_id and merge_chat_ids (>=2) are required'
      });
    }

    console.log(`[RAG] → /merge_chats user:${user_id} new_chat:${new_chat_id} from:[${merge_chat_ids.join(', ')}]`);

    const response = await axios.post(
      `${RAG_BASE_URL}/merge_chats`,
      { user_id, new_chat_id, merge_chat_ids },
      { timeout: 30000, validateStatus: () => true }
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
app.post('/api/chats/save', async (req, res) => {
  try {
    const { user_id, chat_id, title, zip_file_url, vector_count, chat } = req.body || {};
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { upsertChat } = require('./chat_helpers');
    const result = await upsertChat(supabase, user_id, chat_id, {
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
 * POST /api/chats/sync
 * Body: { chats: Array<chatRecord> }
 * Batch syncs multiple chats to Supabase (upsert for each)
 */
app.post('/api/chats/sync', async (req, res) => {
  try {
    const { chats } = req.body || {};
    
    if (!Array.isArray(chats)) {
      return res.status(400).json({ error: 'chats must be an array' });
    }

    if (chats.length === 0) {
      return res.status(200).json({ message: 'No chats to sync', synced: 0 });
    }

    console.log(`[CHAT SYNC] Syncing ${chats.length} chats to Supabase...`);

    const { upsertChat } = require('./chat_helpers');
    const results = [];
    const errors = [];

    // Process each chat
    for (const chatRecord of chats) {
      const { chat_id, user_id, title, zip_file_url, vector_count, chat } = chatRecord;
      
      if (!user_id || !chat_id) {
        errors.push({ chat_id: chat_id || 'unknown', error: 'Missing user_id or chat_id' });
        continue;
      }

      const result = await upsertChat(supabase, user_id, chat_id, {
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

// -------------------- START SERVER --------------------
app.listen(port, () => {
  console.log(`✅ Server is running on http://localhost:${port}`);
  console.log(`[RAG] Base URL: ${RAG_BASE_URL}`);
});

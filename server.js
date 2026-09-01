const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mime = require('mime-types');
const { supabase } = require('./src/utils/supabase');
const { requireAuth, assertRequestedUser } = require('./src/middleware/auth');
const { answerChat, deleteChatMemory, mergeChatMemory } = require('./src/services/ragService');
const { getChats, upsertChat } = require('./src/utils/chat_helpers');

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = new Set([
  ...String(process.env.FRONTEND_URL || '').split(','),
  ...String(process.env.CORS_ALLOWED_ORIGINS || '').split(','),
  'http://localhost:5173',
  'http://localhost:8080',
].map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean));

app.use(cors({
  origin(origin, callback) {
    const normalized = String(origin || '').replace(/\/$/, '');
    if (!origin || allowedOrigins.has(normalized)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86_400,
}));
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const buckets = new Map();
app.use('/api', (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = buckets.get(key) || { started: now, count: 0 };
  if (now - bucket.started > 60_000) Object.assign(bucket, { started: now, count: 0 });
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > 120) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  return next();
});

app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await supabase.from('chats').select('chat_id').limit(1);
    if (error) {
      return res.status(200).json({ status: 'ok', service: 'brain-hop-api', db: 'degraded', error: error.message });
    }
    return res.json({ status: 'ok', service: 'brain-hop-api', db: 'connected' });
  } catch (err) {
    return res.status(200).json({ status: 'ok', service: 'brain-hop-api', db: 'error', error: err.message || String(err) });
  }
});
app.get('/api/test', (_req, res) => res.json({ message: 'Hello from the backend!' }));

function authRoute(handler, fallbackStatus) {
  return async (req, res) => {
    try {
      const result = await handler(req);
      const status = result?.status || fallbackStatus;
      const { status: _status, ...body } = result || {};
      return res.status(status).json(body);
    } catch (error) {
      return res.status(500).json({ error: error.message || String(error) });
    }
  };
}

app.post('/api/auth/login', authRoute(require('./src/routes/auth_login'), 200));
app.post('/api/auth/signup', authRoute(require('./src/routes/auth_signup'), 201));
app.post('/api/auth/session', authRoute(require('./src/routes/auth_session'), 200));
app.post('/api/auth/logout', authRoute(require('./src/routes/auth_logout'), 200));

function sanitizeFilename(name) {
  return String(name || 'upload').replace(/[^\w.\-]+/g, '_');
}

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']).has(file.mimetype)),
});

app.post('/api/rag/image', requireAuth, uploadMemory.single('image'), async (req, res) => {
  try {
    const { user_id, chat_id } = req.body || {};
    if (!assertRequestedUser(req, user_id) || !chat_id) return res.status(400).json({ error: 'A valid chat_id is required' });
    if (!req.file) return res.status(400).json({ error: 'image file is required (field name: image)' });
    const original = sanitizeFilename(req.file.originalname);
    const ext = mime.extension(req.file.mimetype) || original.split('.').pop() || 'bin';
    const base = original.replace(/\.[^/.]+$/, '');
    const storagePath = `images/${req.user.id}/${chat_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${ext}`;
    const { error } = await supabase.storage.from('chat_vectors').upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype, upsert: false,
    });
    if (error) throw error;
    return res.status(201).json({ image_name: storagePath, image_type: req.file.mimetype });
  } catch (error) {
    console.error('[UPLOAD] Failed:', error.message || error);
    return res.status(500).json({ error: 'Image upload failed' });
  }
});

app.post('/api/rag/chat', requireAuth, async (req, res) => {
  try {
    const { user_id, chat_id, model_name, question, image_name } = req.body || {};
    if (!assertRequestedUser(req, user_id) || !chat_id || !model_name || typeof question !== 'string' || !question.trim() || question.length > 20_000) {
      return res.status(400).json({ error: 'A valid chat_id, model_name, and question (up to 20,000 characters) are required' });
    }
    const result = await answerChat(supabase, {
      userId: req.user.id, chatId: chat_id, modelName: model_name, question: question.trim(), imageName: image_name || null,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[RAG] Chat failed:', error.message || error);
    return res.status(502).json({ error: 'RAG chat request failed' });
  }
});

app.post('/api/rag/merge_chats', requireAuth, async (req, res) => {
  try {
    const { user_id, new_chat_id, merge_chat_ids } = req.body || {};
    if (!assertRequestedUser(req, user_id) || !new_chat_id || !Array.isArray(merge_chat_ids) || merge_chat_ids.length < 2) {
      return res.status(400).json({ error: 'A valid new_chat_id and at least two source chats are required' });
    }
    await mergeChatMemory(supabase, { userId: req.user.id, newChatId: new_chat_id, sourceChatIds: merge_chat_ids });
    return res.status(200).json({ status: 'merged', new_chat_id });
  } catch (error) {
    console.error('[RAG] Merge failed:', error.message || error);
    return res.status(500).json({ error: 'RAG merge request failed' });
  }
});

// Memory is written immediately. Kept so existing frontend shutdown hooks remain compatible.
app.post('/api/rag/close_chat', requireAuth, async (req, res) => {
  const { user_id, chat_id } = req.body || {};
  if (!assertRequestedUser(req, user_id) || !chat_id) return res.status(400).json({ error: 'A valid chat_id is required' });
  return res.json({ status: 'persisted' });
});

app.post('/api/chats/save', requireAuth, async (req, res) => {
  try {
    const { user_id, chat_id, title, zip_file_url, vector_count, chat } = req.body || {};
    if (!assertRequestedUser(req, user_id)) return res.status(403).json({ error: 'You can only save your own chats' });
    const result = await upsertChat(supabase, req.user.id, chat_id, { title, zip_file_url, vector_count, chat });
    if (result.error) return res.status(500).json({ error: result.error });
    return res.status(200).json({ chat_id: result.chat_id, chat: result.data });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save chat' });
  }
});

app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    if (!assertRequestedUser(req, req.query.user_id)) return res.status(403).json({ error: 'You can only access your own chats' });
    const result = await getChats(supabase, req.user.id);
    if (result.error) return res.status(500).json({ error: result.error });
    return res.json({ chats: result.data });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.post('/api/chats/sync', requireAuth, async (req, res) => {
  const { chats } = req.body || {};
  if (!Array.isArray(chats)) return res.status(400).json({ error: 'chats must be an array' });
  const results = await Promise.all(chats.map((record) => upsertChat(supabase, req.user.id, record.chat_id, {
    title: record.title, zip_file_url: record.zip_file_url, vector_count: record.vector_count, chat: record.chat,
  })));
  const errors = results.filter((result) => result.error).map((result) => result.error);
  return res.status(errors.length ? 502 : 200).json({ synced: results.length - errors.length, failed: errors.length, errors });
});

app.delete('/api/chats/:chatId', requireAuth, async (req, res) => {
  const { chatId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) return res.status(400).json({ error: 'Invalid chat id' });
  try {
    await deleteChatMemory(supabase, { userId: req.user.id, chatId });
    const { error } = await supabase.from('chats').delete().eq('chat_id', chatId).eq('user_id', req.user.id);
    if (error) throw error;
    const imagePrefix = `images/${req.user.id}/${chatId}`;
    const { data: images, error: listError } = await supabase.storage.from('chat_vectors').list(imagePrefix);
    if (listError) console.warn('[CHAT DELETE] Unable to list stored images:', listError.message);
    if (images?.length) {
      const { error: removeError } = await supabase.storage.from('chat_vectors')
        .remove(images.map((image) => `${imagePrefix}/${image.name}`));
      if (removeError) console.warn('[CHAT DELETE] Unable to remove stored images:', removeError.message);
    }
    return res.json({ deleted: true });
  } catch (error) {
    console.error('[CHAT DELETE] Failed:', error.message || error);
    return res.status(500).json({ error: 'Unable to delete this chat. Please try again.' });
  }
});

app.get('/privacy', require('./src/routes/privacy'));
app.get('/terms', require('./src/routes/terms'));
app.get('/api/stats', require('./src/routes/stats'));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: `Upload rejected: ${error.message}` });
  if (error?.message === 'Origin is not allowed by CORS') return res.status(403).json({ error: 'Origin is not allowed' });
  console.error('[API] Unhandled error:', error.message || error);
  return res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(port, () => console.log(`Brain Hop API listening on port ${port}`));

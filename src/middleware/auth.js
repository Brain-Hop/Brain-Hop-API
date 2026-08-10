const { supabase } = require('../utils/supabase');

/**
 * Resolves the Supabase user represented by a bearer token. Route handlers
 * must use req.user.id, never a user_id supplied by the browser.
 */
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data?.user?.id) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = data.user;
    return next();
  } catch (error) {
    console.error('[AUTH] Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function assertRequestedUser(req, requestedUserId) {
  return !requestedUserId || requestedUserId === req.user?.id;
}

module.exports = { requireAuth, assertRequestedUser };

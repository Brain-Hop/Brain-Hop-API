/**
 * Login using the shared Supabase client
 * Expects POST body: { email, password } or { provider: 'github'|'google' }
 * 
 * curl.exe -i -X POST "http://localhost:3001/api/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"rajputsomesh78@gmail.com\",\"password\":\"asdqwe123\"}"
 */
module.exports = async function login(req) {
  const body = req && req.body ? req.body : {};
  const { email, password } = body;
  const provider = body.provider;

  // If no provider is specified we require email+password. For OAuth flows the
  // provider alone is sufficient.
  if (!provider && (!email || !password)) {
    return { status: 400, error: 'email and password are required' };
  }
  try {
    const { supabase } = require('./supabase');

    // If a provider is present, start OAuth flow (GitHub / Google)
    if (provider) {
      const allowed = ['google'];
      if (!allowed.includes(provider)) {
        return { status: 400, error: `unsupported provider: ${provider}` };
      }

      // Optional redirect URL after OAuth completes. Can be set in env or omitted.
      const redirectTo = process.env.SUPABASE_OAUTH_REDIRECT || process.env.FRONTEND_URL || undefined;

      // Try v2-style call first; fallback to v1 signature if it errors.
      let oauthResult;
      try {
        // v2: signInWithOAuth({ provider, options: { redirectTo }})
        oauthResult = await supabase.auth.signInWithOAuth({ provider, options: redirectTo ? { redirectTo } : undefined });
      } catch (v2err) {
        // v1 fallback: signInWithOAuth({ provider }, { redirectTo })
        oauthResult = await supabase.auth.signInWithOAuth({ provider }, redirectTo ? { redirectTo } : undefined);
      }

      const { data: oauthData, error: oauthError } = oauthResult || {};
      if (oauthError) {
        return { status: 500, error: oauthError.message || String(oauthError) };
      }

      // supabase returns a URL the client should be redirected to
      const url = oauthData?.url || oauthData?.provider_url || null;
      console.log(`[AUTH] OAuth login initiated for provider ${provider}`);
      return { status: 200, provider, url };
    }

    // Password sign-in flow (default)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { status: 401, error: error.message || String(error) };
    }

    const user = data?.user || null;
    const session = data?.session || null;

    const safeUser = user
      ? {
          id: user.id || null,
          email: user.email || null,
          name: (user.user_metadata && user.user_metadata.name) || null,
        }
      : null;

    const token = session?.access_token || session?.provider_token || null;

    if (safeUser) {
      console.log(`[AUTH] Password login successful for ${safeUser.email || safeUser.id || 'unknown user'}`);
      
      // Create or update profile entry in profiles table
      const { upsertProfile } = require('./profile_helpers');
      if (safeUser.id) {
        const profileResult = await upsertProfile(supabase, safeUser.id, {
          email: user.email,
          name: user.user_metadata?.name || null,
          avatar_url: user.user_metadata?.avatar_url || null,
          user_metadata: user.user_metadata,
        });
        if (profileResult.error) {
          console.warn('[AUTH] Profile update warning:', profileResult.error);
          // Don't fail login if profile update fails, but log it
        }
      }
    }

    return { status: 200, user: safeUser, token, session: session ? { expires_at: session.expires_at } : null };
  } catch (err) {
    return { status: 500, error: (err && err.message) || String(err) };
  }
};

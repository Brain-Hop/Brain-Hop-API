module.exports = async function logout(req) {
  // POST /api/auth/logout
  // Expected input: optional auth token in headers (Bearer <token>)
  // Contract: call Supabase signOut and return result
  // curl.exe -i -X POST "http://localhost:3001/api/auth/logout" -H "Content-Type: application/json" -d "{}"

  try {
    const { supabase } = require('./supabase');

    // Call supabase signOut. On the server this will clear the client's session
    // if it has one. For stateless JWTs the client should also remove the token.
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { status: 500, error: error.message || String(error) };
    }

    console.log('[AUTH] User logged out successfully');
    return { status: 200, message: 'signed out' };
  } catch (err) {
    return { status: 500, error: (err && err.message) || String(err) };
  }
};

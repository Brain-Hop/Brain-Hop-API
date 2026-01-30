module.exports = async function getPrivacyPolicy(req) {
  // GET /api/privacy
  // Contract: return privacy policy text or URL
  return { status: 200, privacy: 'Privacy policy text (stub)' };
};

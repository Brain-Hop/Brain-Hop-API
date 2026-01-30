module.exports = async function getStats(req) {
  // GET /api/stats
  // Contract: return system or user stats depending on auth/role
  // Stub: return sample counts
  return { status: 200, stats: { users: 1, conversations: 1, messages: 1 } };
};

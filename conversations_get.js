module.exports = async function getConversation(req) {
  // GET /api/conversations/:id
  // Expected input: { params: { id } }
  // Contract: return conversation metadata and optionally messages (or separate messages endpoint)

  const params = req && req.params ? req.params : {};
  const { id } = params;
  if (!id) return { status: 400, error: 'conversation id is required' };

  // Stub: return sample conversation and an empty messages array
  return {
    status: 200,
    conversation: { id, title: 'Stub conversation', createdAt: new Date().toISOString(), messages: [] },
  };
};

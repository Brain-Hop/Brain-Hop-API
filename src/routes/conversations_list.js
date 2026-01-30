module.exports = async function listConversations(req) {
  // GET /api/conversations
  // Expected input: auth token -> return list of conversations for user
  // Contract: support pagination/filters in query (not implemented in stub)

  // Stub: return sample conversation list
  const conversations = [
    { id: 'conv_stub_1', title: 'Chat with AI', updatedAt: new Date().toISOString() },
  ];

  return { status: 200, conversations };
};

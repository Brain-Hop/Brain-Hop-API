module.exports = async function listMessages(req) {
  // GET /api/conversations/:id/messages
  // Expected input: { params: { id }, query: { limit?, cursor? } }
  // Contract: returns an array of messages for given conversation

  const params = req && req.params ? req.params : {};
  const { id } = params;
  if (!id) return { status: 400, error: 'conversation id required' };

  // Stub: return sample messages
  const messages = [
    { id: 'msg_stub_1', role: 'user', content: 'Hello', createdAt: new Date().toISOString() },
  ];

  return { status: 200, messages };
};

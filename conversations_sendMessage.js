module.exports = async function sendMessage(req) {
  // POST /api/conversations/:id/messages
  // Expected input: { params: { id }, body: { role: 'user'|'assistant'|'system', content } }
  // Contract: append message to conversation, trigger AI model if role === 'user' and return message

  const params = req && req.params ? req.params : {};
  const body = req && req.body ? req.body : {};
  const { id } = params;
  const { role, content } = body;

  if (!id) return { status: 400, error: 'conversation id required' };
  if (!role || !content) return { status: 400, error: 'role and content are required' };

  // Stub: in real impl persist message, possibly call AI model, stream response
  const message = { id: 'msg_stub_1', conversationId: id, role, content, createdAt: new Date().toISOString() };

  return { status: 201, message };
};

module.exports = async function createConversation(req) {
  // POST /api/conversations
  // Expected input: { body: { title?, initialMessage? } }
  // Contract: create a conversation resource, return conversation meta

  const body = req && req.body ? req.body : {};
  const { title, initialMessage } = body;

  // Stub: persist conversation in DB and optionally add initial message
  const conversation = {
    id: 'conv_stub_1',
    title: title || 'New conversation',
    createdAt: new Date().toISOString(),
    lastMessage: initialMessage || null,
  };

  return { status: 201, conversation };
};

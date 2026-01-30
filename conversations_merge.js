module.exports = async function mergeConversations(req) {
  // POST /api/conversations/:id/merge
  // Expected input: { params: { id }, body: { otherConversationId } }
  // Contract: merge messages from otherConversationId into id, return merged conversation meta

  const params = req && req.params ? req.params : {};
  const body = req && req.body ? req.body : {};
  const { id } = params;
  const { otherConversationId } = body;
  if (!id || !otherConversationId) return { status: 400, error: 'both conversation ids required' };

  // Stub: in real impl move messages and update metadata
  return { status: 200, message: `merged ${otherConversationId} into ${id} (stub)` };
};

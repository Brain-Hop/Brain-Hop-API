module.exports = async function deleteConversation(req) {
  // DELETE /api/conversations/:id
  // Expected input: { params: { id } }
  const params = req && req.params ? req.params : {};
  const { id } = params;
  if (!id) return { status: 400, error: 'conversation id is required' };

  // Stub: in real impl soft-delete or remove conversation
  return { status: 200, message: `conversation ${id} deleted (stub)` };
};

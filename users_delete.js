module.exports = async function deleteUser(req) {
  // DELETE /api/users/:id
  // Expected input: { params: { id } }
  // Contract: validate id and delete user (soft delete preferred), return success

  const params = req && req.params ? req.params : {};
  const { id } = params;
  if (!id) return { status: 400, error: 'user id is required' };

  // Stub: in real impl verify auth and perform deletion in DB
  return { status: 200, message: `user ${id} deleted (stub)` };
};

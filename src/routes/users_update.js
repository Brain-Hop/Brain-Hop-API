module.exports = async function updateUser(req) {
  // PUT /api/users/:id
  // Expected input: { params: { id }, body: { fields to update } }
  // Contract: validate id, validate allowed fields, return updated user

  const params = req && req.params ? req.params : {};
  const body = req && req.body ? req.body : {};
  const { id } = params;
  if (!id) return { status: 400, error: 'user id is required' };

  // Stub: in real impl check authorization, apply updates in DB
  const updated = Object.assign({ id, email: 'demo@example.com', name: 'Demo User' }, body);

  return { status: 200, user: updated };
};

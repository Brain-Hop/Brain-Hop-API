module.exports = async function deleteFile(req) {
  // DELETE /api/files/:id
  // Expected input: { params: { id } }
  const params = req && req.params ? req.params : {};
  const { id } = params;
  if (!id) return { status: 400, error: 'file id required' };

  // Stub: in real impl remove from storage and DB
  return { status: 200, message: `file ${id} deleted (stub)` };
};

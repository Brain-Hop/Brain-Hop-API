module.exports = async function getFile(req) {
  // GET /api/files/:id
  // Expected input: { params: { id } }
  // Contract: return file stream or signed download URL

  const params = req && req.params ? req.params : {};
  const { id } = params;
  if (!id) return { status: 400, error: 'file id required' };

  // Stub: would locate file and stream; here return metadata and a fake url
  return { status: 200, file: { id, name: 'stub.txt', url: `/files/${id}`, size: 123 } };
};

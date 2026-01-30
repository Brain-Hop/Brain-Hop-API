module.exports = async function uploadFile(req) {
  // POST /api/files
  // Expected input: multipart/form-data with file, and optionally conversationId
  // Contract: store file, associate to conversation or user, return file metadata (id, url, name, size)

  // Stub: validate presence
  const file = req && req.file ? req.file : null;
  const body = req && req.body ? req.body : {};
  if (!file) return { status: 400, error: 'file is required (stub expects req.file)' };

  const metadata = {
    id: 'file_stub_1',
    name: file.originalname || 'uploaded.bin',
    size: file.size || null,
    url: `/files/file_stub_1`,
    uploadedAt: new Date().toISOString(),
    conversationId: body.conversationId || null,
  };

  return { status: 201, file: metadata };
};

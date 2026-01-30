module.exports = async function listModels(req) {
  // GET /api/models
  // Contract: return available AI models and their metadata (id, name, capabilities, cost)

  // Stub: return simple model list
  const models = [
    { id: 'gpt-stub-1', name: 'GPT-Stub', description: 'Test model', supportsStreaming: false },
  ];

  return { status: 200, models };
};

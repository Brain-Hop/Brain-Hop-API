module.exports = async function listNotifications(req) {
  // GET /api/notifications
  // Expected input: auth token; optional query params for unread/pagination
  // Contract: return array of notifications

  const notifications = [
    { id: 'notif_stub_1', type: 'message', text: 'New message in conversation', read: false, createdAt: new Date().toISOString() },
  ];

  return { status: 200, notifications };
};

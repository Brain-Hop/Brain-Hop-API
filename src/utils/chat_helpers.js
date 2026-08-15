const { randomUUID } = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateChatId() {
  return randomUUID();
}

async function upsertChat(supabase, userId, chatId, chatData = {}) {
  if (!userId) return { error: 'User ID is required' };
  const finalChatId = chatId || generateChatId();
  if (!UUID.test(finalChatId)) return { error: 'chat_id must be a valid UUID' };

  const now = new Date().toISOString();
  const record = {
    chat_id: finalChatId,
    user_id: userId,
    title: chatData.title || 'New Conversation',
    zip_file_url: chatData.zip_file_url || '',
    vector_count: Number(chatData.vector_count || 0),
    chat: chatData.chat || null,
    updated_at: now,
  };

  const { data: existing, error: existingError } = await supabase
    .from('chats').select('chat_id').eq('chat_id', finalChatId).eq('user_id', userId).maybeSingle();
  if (existingError) return { error: existingError.message || 'Failed to look up chat' };

  if (existing) {
    const { data, error } = await supabase.from('chats').update(record)
      .eq('chat_id', finalChatId).eq('user_id', userId).select().single();
    if (error) return { error: error.message || 'Failed to update chat' };
    return { data, chat_id: finalChatId };
  }

  const { data, error } = await supabase.from('chats').insert({ ...record, created_at: now }).select().single();
  if (error) return { error: error.message || 'Failed to create chat' };
  return { data, chat_id: finalChatId };
}

async function getChats(supabase, userId) {
  if (!userId) return { error: 'User ID is required' };
  const { data, error } = await supabase.from('chats').select('*')
    .eq('user_id', userId).order('updated_at', { ascending: false });
  if (error) return { error: error.message || 'Failed to fetch chats' };
  return { data };
}

module.exports = { generateChatId, upsertChat, getChats };

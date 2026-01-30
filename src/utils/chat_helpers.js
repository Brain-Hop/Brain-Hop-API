/**
 * Helper functions for managing chats in the chats table
 */

const { randomUUID } = require('crypto');

/**
 * Generate a UUID for chat_id
 * @returns {string} - Generated UUID
 */
function generateChatId() {
  return randomUUID();
}

/**
 * Get the next chat number for a user (for reference, not used as ID)
 * @param {Object} supabase - Supabase client instance
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Next chat number
 */
async function getNextChatNumber(supabase, userId) {
  try {
    // Count existing chats for this user
    const { count, error } = await supabase
      .from('chats')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.error('[CHAT] Error counting chats:', error);
      return 1;
    }

    return (count || 0) + 1;
  } catch (err) {
    console.error('[CHAT] Error getting chat number:', err);
    return 1;
  }
}

/**
 * Create or update a chat in the chats table
 * @param {Object} supabase - Supabase client instance
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID (if not provided, will be generated)
 * @param {Object} chatData - Chat data (title, zip_file_url, vector_count, chat JSON)
 * @returns {Promise<Object>} - Result with status and data/error
 */
async function upsertChat(supabase, userId, chatId = null, chatData = {}) {
  if (!userId) {
    return { error: 'User ID is required' };
  }

  try {
    const now = new Date().toISOString();
    
    // Check if this is an update to an existing chat
    let finalChatId = chatId;
    let isNewChat = false;
    
    if (finalChatId) {
      // Validate that chatId is a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(finalChatId)) {
        // If provided chat_id is not a valid UUID, generate a new one
        console.warn(`[CHAT] Invalid UUID format for chat_id: ${finalChatId}, generating new UUID`);
        finalChatId = generateChatId();
        isNewChat = true;
      } else {
        // Check if chat exists with this ID and belongs to this user
        const { data: existingChat, error: fetchError } = await supabase
          .from('chats')
          .select('chat_id')
          .eq('chat_id', finalChatId)
          .eq('user_id', userId)
          .single();
        
        if (!existingChat || fetchError) {
          // If chat_id provided but doesn't exist, generate a new UUID
          finalChatId = generateChatId();
          isNewChat = true;
        }
      }
    } else {
      // Generate new chat_id as UUID
      finalChatId = generateChatId();
      isNewChat = true;
    }

    // Final check if chat exists (for update path)
    const { data: existingChat, error: fetchError } = await supabase
      .from('chats')
      .select('chat_id')
      .eq('chat_id', finalChatId)
      .eq('user_id', userId)
      .single();

    const chatRecord = {
      chat_id: finalChatId,
      user_id: userId, // Store user_id in the user_id column
      title: chatData.title || 'New Conversation',
      zip_file_url: chatData.zip_file_url || '', // Use empty string instead of null for NOT NULL constraint
      vector_count: chatData.vector_count || 0,
      chat: chatData.chat || null, // JSON field for chat messages
      updated_at: now,
    };

    let result;
    if (existingChat && !fetchError && !isNewChat) {
      // Update existing chat
      const { data, error } = await supabase
        .from('chats')
        .update(chatRecord)
        .eq('chat_id', finalChatId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('[CHAT] Update error:', error);
        return { error: error.message || 'Failed to update chat' };
      }
      result = data;
      console.log(`[CHAT] Updated chat ${finalChatId} for user ${userId}`);
    } else {
      // Create new chat
      chatRecord.created_at = now;
      const { data, error } = await supabase
        .from('chats')
        .insert(chatRecord)
        .select()
        .single();

      if (error) {
        console.error('[CHAT] Insert error:', error);
        return { error: error.message || 'Failed to create chat' };
      }
      result = data;
      const chatNumber = await getNextChatNumber(supabase, userId);
      console.log(`[CHAT] Created chat ${finalChatId} (chat #${chatNumber}) for user ${userId}`);
    }

    return { data: result, chat_id: finalChatId };
  } catch (err) {
    console.error('[CHAT] Unexpected error:', err);
    return { error: err.message || 'Chat operation failed' };
  }
}

module.exports = { generateChatId, getNextChatNumber, upsertChat };


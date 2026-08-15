/*
 * Rebuilds pgvector memory from the persisted chats.chat JSON column.
 * Default mode is dry-run. Use --apply only after the SQL migration succeeds.
 */
const { supabase } = require('../src/utils/supabase');
const { storeMessageMemory } = require('../src/services/ragService');

const apply = process.argv.includes('--apply');

function messagesFrom(chat) {
  const value = Array.isArray(chat) ? chat : chat?.messages;
  if (!Array.isArray(value)) return [];
  return value.filter((message) => ['user', 'assistant', 'system'].includes(message?.role) && typeof message?.content === 'string' && message.content.trim());
}

async function main() {
  const { data: chats, error } = await supabase.from('chats').select('chat_id, user_id, chat').not('chat', 'is', null);
  if (error) throw error;
  let messages = 0;
  for (const chat of chats || []) {
    const entries = messagesFrom(chat.chat);
    messages += entries.length;
    console.log(`${apply ? 'Backfilling' : 'Would backfill'} ${entries.length} messages for ${chat.chat_id}`);
    if (!apply) continue;
    for (const message of entries) {
      await storeMessageMemory(supabase, {
        userId: chat.user_id,
        chatId: chat.chat_id,
        role: message.role,
        content: message.content,
        metadata: { migrated: true },
      });
    }
  }
  console.log(`${apply ? 'Backfilled' : 'Dry run found'} ${messages} messages across ${(chats || []).length} chats.`);
}

main().catch((error) => {
  console.error('Backfill failed:', error.message || error);
  process.exitCode = 1;
});

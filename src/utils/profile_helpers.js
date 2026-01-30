/**
 * Helper functions for managing user profiles in the profiles table
 */

/**
 * Create or update a profile in the profiles table
 * @param {Object} supabase - Supabase client instance
 * @param {string} userId - User ID from auth.users
 * @param {Object} userData - User data from auth (email, name, avatar_url, etc.)
 * @returns {Promise<Object>} - Result with status and data/error
 */
async function upsertProfile(supabase, userId, userData = {}) {
  if (!userId) {
    return { error: 'User ID is required' };
  }

  try {
    const now = new Date().toISOString();
    
    // Extract user metadata
    const email = userData.email || null;
    const fullName = userData.name || userData.full_name || userData.user_metadata?.full_name || userData.user_metadata?.name || null;
    const avatarUrl = userData.avatar_url || userData.user_metadata?.avatar_url || userData.user_metadata?.picture || null;
    
    // Generate username from email if not provided
    const username = userData.username || userData.user_metadata?.username || 
      (email ? email.split('@')[0] : `user_${userId.slice(0, 8)}`) || null;

    // Check if profile exists
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    const profileData = {
      id: userId,
      username,
      full_name: fullName,
      email,
      avatar_url: avatarUrl,
      updated_at: now,
    };

    let result;
    if (existingProfile) {
      // Update existing profile
      const { data, error } = await supabase
        .from('profiles')
        .update(profileData)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        console.error('[PROFILE] Update error:', error);
        return { error: error.message || 'Failed to update profile' };
      }
      result = data;
    } else {
      // Create new profile
      profileData.created_at = now;
      const { data, error } = await supabase
        .from('profiles')
        .insert(profileData)
        .select()
        .single();

      if (error) {
        console.error('[PROFILE] Insert error:', error);
        return { error: error.message || 'Failed to create profile' };
      }
      result = data;
    }

    console.log(`[PROFILE] ${existingProfile ? 'Updated' : 'Created'} profile for user ${userId}`);
    return { data: result };
  } catch (err) {
    console.error('[PROFILE] Unexpected error:', err);
    return { error: err.message || 'Profile operation failed' };
  }
}

module.exports = { upsertProfile };


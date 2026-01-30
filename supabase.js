/**
 * Shared Supabase client for the backend.
 * Exports: { supabase }
 *
 * Requires environment variables:
 *   - SUPABASE_URL
 *   - SUPABASE_KEY
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jglveatavrfvdczmjaqs.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnbHZlYXRhdnJmdmRjem1qYXFzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTQxMTc3NSwiZXhwIjoyMDc2OTg3Nzc1fQ.f7AzKptwRvlFt40yNQRijdOaqHtbwSuIx23imRJ8E8A';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase };

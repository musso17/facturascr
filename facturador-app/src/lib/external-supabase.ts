import { createClient } from '@supabase/supabase-js';

const externalSupabaseUrl = process.env.NEXT_PUBLIC_EXTERNAL_SUPABASE_URL;
const externalSupabaseKey = process.env.NEXT_PUBLIC_EXTERNAL_SUPABASE_ANON_KEY;

export const externalSupabase = createClient(
  externalSupabaseUrl || 'https://placeholder.supabase.co', 
  externalSupabaseKey || 'placeholder'
);

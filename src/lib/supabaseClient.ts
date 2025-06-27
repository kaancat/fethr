import { createClient } from '@supabase/supabase-js';

// Read values from Vite environment variables (must start with VITE_)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validation at runtime (mostly useful during development)
if (!supabaseUrl) {
  console.error(
    '%cSupabase URL is missing. Ensure VITE_SUPABASE_URL is set in your .env file.',
    'color:red; font-weight:bold;'
  );
}
if (!supabaseAnonKey) {
  console.error(
    '%cSupabase Anon Key is missing. Ensure VITE_SUPABASE_ANON_KEY is set in your .env file.',
    'color:red; font-weight:bold;'
  );
}

// Create and export the Supabase client
// Use empty strings as fallbacks if vars are somehow undefined to satisfy createClient types,
// but the errors above should alert the developer.
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  // Optional: Configure auth persistence. Recommended for desktop apps:
  auth: {
    // Use localStorage for persistence. Note: In Tauri, this might still be cleared
    // on updates depending on configuration. More robust storage might be needed later.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // Usually false for non-web apps
    // storage: window.localStorage, // Default is localStorage
  },
});

console.log('Supabase client initialized (using env vars).'); 
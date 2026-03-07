import { createClient } from "@supabase/supabase-js";

// 🔧 Replace these with your Supabase project credentials
// Found at: https://supabase.com/dashboard → Project Settings → API
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

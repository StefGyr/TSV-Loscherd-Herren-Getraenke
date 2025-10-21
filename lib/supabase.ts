import { createClient } from '@supabase/supabase-js'

// 🔹 Deine Supabase-Keys aus den Environment-Variablen
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string

// 🔹 Client erstellen
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

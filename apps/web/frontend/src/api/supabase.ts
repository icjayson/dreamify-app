import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

// Debug logging to help troubleshoot environment variable issues
console.log('Supabase Environment Variables:', {
  SUPABASE_URL: SUPABASE_URL ? 'Set' : 'Missing',
  SUPABASE_KEY: SUPABASE_KEY ? 'Set' : 'Missing',
  allEnvVars: import.meta.env
})

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase environment variables:', {
    SUPABASE_URL,
    SUPABASE_KEY
  })
  throw new Error('Missing Supabase environment variables')
}

// Create Supabase client with Clerk session integration
// Following the official Clerk-Supabase integration pattern
export const createSupabaseClient = (getToken: () => Promise<string | null>) => {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false, // Clerk handles session persistence
      autoRefreshToken: false, // Clerk handles token refresh
    }
  })

  // Store the getToken function for later use
  ;(client as any).getToken = getToken

  return client
}

// Default client for non-authenticated operations (anonymous access)
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
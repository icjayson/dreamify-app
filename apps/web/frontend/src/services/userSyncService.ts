import { createSupabaseClient } from '../api/supabase'

// Define the Clerk User type locally to avoid import issues
interface ClerkUser {
  id: string
  fullName?: string
  firstName?: string
  lastName?: string
  imageUrl?: string
  primaryEmailAddress?: {
    emailAddress?: string
  }
}

export interface SupabaseUser {
  id: string
  email: string
  full_name?: string
  first_name?: string
  last_name?: string
  image_url?: string
  created_at: string
  updated_at: string
  clerk_user_id: string
}

export class UserSyncService {
  private getToken: () => Promise<string | null>

  constructor(getToken: () => Promise<string | null>) {
    this.getToken = getToken
  }

  /**
   * Get a fresh Supabase client with current authentication
   */
  private async getSupabaseClient() {
    const client = createSupabaseClient(this.getToken)
    const token = await this.getToken()
    
    if (token) {
      // Set the session with the Clerk token
      await client.auth.setSession({
        access_token: token,
        refresh_token: ''
      })
    }
    
    return client
  }

  /**
   * Sync user data from Clerk to Supabase
   */
  async syncUser(clerkUser: ClerkUser): Promise<SupabaseUser | null> {
    try {
      const supabase = await this.getSupabaseClient()
      
      const userData = {
        clerk_user_id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress || '',
        full_name: clerkUser.fullName || '',
        first_name: clerkUser.firstName || '',
        last_name: clerkUser.lastName || '',
        image_url: clerkUser.imageUrl || '',
        updated_at: new Date().toISOString(),
      }

      // Check if user already exists
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('clerk_user_id', clerkUser.id)
        .single()

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Error fetching user:', fetchError)
        return null
      }

      let result
      if (existingUser) {
        // Update existing user
        const { data, error } = await supabase
          .from('users')
          .update(userData)
          .eq('clerk_user_id', clerkUser.id)
          .select()
          .single()

        if (error) {
          console.error('Error updating user:', error)
          return null
        }
        result = data
      } else {
        // Create new user
        const { data, error } = await supabase
          .from('users')
          .insert({
            ...userData,
            created_at: new Date().toISOString(),
          })
          .select()
          .single()

        if (error) {
          console.error('Error creating user:', error)
          return null
        }
        result = data
      }

      console.log('User synced successfully:', result)
      return result
    } catch (error) {
      console.error('Error syncing user:', error)
      return null
    }
  }

  /**
   * Get user data from Supabase
   */
  async getUser(clerkUserId: string): Promise<SupabaseUser | null> {
    try {
      const supabase = await this.getSupabaseClient()
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('clerk_user_id', clerkUserId)
        .single()

      if (error) {
        console.error('Error fetching user:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Error getting user:', error)
      return null
    }
  }

  /**
   * Update user data in Supabase
   */
  async updateUser(clerkUserId: string, updates: Partial<SupabaseUser>): Promise<SupabaseUser | null> {
    try {
      const supabase = await this.getSupabaseClient()
      
      const { data, error } = await supabase
        .from('users')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('clerk_user_id', clerkUserId)
        .select()
        .single()

      if (error) {
        console.error('Error updating user:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Error updating user:', error)
      return null
    }
  }
}
import { useEffect, useState, useCallback } from 'react'
import { useUser, useAuth } from '@clerk/clerk-react'
import { UserSyncService, SupabaseUser } from '../services/userSyncService'

export const useUserSync = () => {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser()
  const { getToken } = useAuth()
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Create a stable reference to the user sync service
  const userSyncService = useCallback(() => new UserSyncService(getToken), [getToken])

  // Sync user data when Clerk user is loaded
  useEffect(() => {
    const syncUserData = async () => {
      if (!clerkLoaded || !clerkUser) {
        return
      }

      setIsSyncing(true)
      setSyncError(null)

      try {
        const service = userSyncService()
        const syncedUser = await service.syncUser(clerkUser)
        if (syncedUser) {
          setSupabaseUser(syncedUser)
        } else {
          setSyncError('Failed to sync user data')
        }
      } catch (error) {
        console.error('Error in useUserSync:', error)
        setSyncError('Error syncing user data')
      } finally {
        setIsSyncing(false)
      }
    }

    syncUserData()
  }, [clerkLoaded, clerkUser, userSyncService])

  // Update user data when Clerk user changes
  useEffect(() => {
    if (!clerkUser || !supabaseUser) return

    const updateUserData = async () => {
      try {
        const service = userSyncService()
        const updatedUser = await service.syncUser(clerkUser)
        if (updatedUser) {
          setSupabaseUser(updatedUser)
        }
      } catch (error) {
        console.error('Error updating user data:', error)
      }
    }

    // Debounce updates to avoid excessive API calls
    const timeoutId = setTimeout(updateUserData, 1000)
    return () => clearTimeout(timeoutId)
  }, [clerkUser?.fullName, clerkUser?.imageUrl, clerkUser?.primaryEmailAddress, userSyncService])

  const refreshUser = useCallback(async () => {
    if (!clerkUser) return

    setIsSyncing(true)
    setSyncError(null)

    try {
      const service = userSyncService()
      const syncedUser = await service.syncUser(clerkUser)
      if (syncedUser) {
        setSupabaseUser(syncedUser)
      } else {
        setSyncError('Failed to refresh user data')
      }
    } catch (error) {
      console.error('Error refreshing user:', error)
      setSyncError('Error refreshing user data')
    } finally {
      setIsSyncing(false)
    }
  }, [clerkUser, userSyncService])

  return {
    supabaseUser,
    clerkUser,
    isSyncing,
    syncError,
    refreshUser,
    isLoaded: clerkLoaded,
  }
}
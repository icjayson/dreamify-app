"""
User service for Supabase operations
"""
from typing import Optional, Dict, Any
from config.supabase import get_supabase_client
import logging

logger = logging.getLogger(__name__)

class UserService:
    """Service for user management operations with Supabase"""
    
    def __init__(self):
        self.supabase = get_supabase_client()
    
    async def get_user_by_clerk_id(self, clerk_user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by Clerk user ID"""
        try:
            response = self.supabase.table('users').select('*').eq('clerk_user_id', clerk_user_id).execute()
            
            if response.data:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting user by Clerk ID {clerk_user_id}: {e}")
            return None
    
    async def create_user(self, user_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Create a new user in Supabase"""
        try:
            response = self.supabase.table('users').insert(user_data).execute()
            
            if response.data:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Error creating user: {e}")
            return None
    
    async def update_user(self, clerk_user_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update user data"""
        try:
            response = self.supabase.table('users').update(updates).eq('clerk_user_id', clerk_user_id).execute()
            
            if response.data:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Error updating user {clerk_user_id}: {e}")
            return None
    
    async def delete_user(self, clerk_user_id: str) -> bool:
        """Delete user by Clerk user ID"""
        try:
            response = self.supabase.table('users').delete().eq('clerk_user_id', clerk_user_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error deleting user {clerk_user_id}: {e}")
            return False
    
    async def sync_user_from_clerk(self, clerk_user_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Sync user data from Clerk to Supabase"""
        try:
            clerk_user_id = clerk_user_data.get('id')
            if not clerk_user_id:
                logger.error("No Clerk user ID provided")
                return None
            
            # Check if user exists
            existing_user = await self.get_user_by_clerk_id(clerk_user_id)
            
            user_data = {
                'clerk_user_id': clerk_user_id,
                'email': clerk_user_data.get('primary_email_address', {}).get('email_address', ''),
                'full_name': clerk_user_data.get('full_name', ''),
                'first_name': clerk_user_data.get('first_name', ''),
                'last_name': clerk_user_data.get('last_name', ''),
                'image_url': clerk_user_data.get('image_url', ''),
            }
            
            if existing_user:
                # Update existing user
                return await self.update_user(clerk_user_id, user_data)
            else:
                # Create new user
                return await self.create_user(user_data)
                
        except Exception as e:
            logger.error(f"Error syncing user from Clerk: {e}")
            return None

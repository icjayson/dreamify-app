"""
Supabase configuration for backend
"""
import os
from supabase import create_client, Client
from config.settings import get_settings

settings = get_settings()

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://zsjjeyxwjtnbaljorhie.supabase.co")
SERVICE_KEY = os.getenv("SERVICE_KEY")

if not SERVICE_KEY:
    raise ValueError("SERVICE_KEY environment variable is required")

# Create Supabase client with service key (FULL access, bypasses security policies)
supabase: Client = create_client(SUPABASE_URL, SERVICE_KEY)

def get_supabase_client() -> Client:
    """Get Supabase client instance with service key"""
    return supabase

#!/usr/bin/env python3
"""
Utility script to generate password hash for admin users.
Usage: python scripts/generate_admin_password.py <password>
"""
import sys
import os

# Add parent directory to path to allow imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.admin_auth import hash_password

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate_admin_password.py <password>")
        sys.exit(1)
    
    password = sys.argv[1]
    password_hash = hash_password(password)
    print(f"Password hash: {password_hash}")
    print(f"\nAdd this to your config.yaml:")
    print(f"  - username: \"admin\"")
    print(f"    password_hash: \"{password_hash}\"")


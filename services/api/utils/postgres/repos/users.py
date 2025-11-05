"""
User repository functions.
"""
from sqlalchemy.orm import Session
from typing import Optional
from utils.postgres.models import User


def get_or_create_user_by_clerk_id(
    db: Session,
    clerk_user_id: str,
    email: Optional[str] = None,
    name: Optional[str] = None,
    image_url: Optional[str] = None
) -> User:
    """Get or create a user by Clerk user ID."""
    user = db.query(User).filter(User.id == clerk_user_id).first()
    
    if user:
        # Update user info if provided
        if email:
            user.email = email
        if name:
            user.name = name
        if image_url:
            user.image_url = image_url
        db.commit()
        db.refresh(user)
        return user
    
    # Create new user
    user = User(
        id=clerk_user_id,
        email=email or "",
        name=name,
        image_url=image_url
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user_profile(
    db: Session,
    clerk_user_id: str,
    email: Optional[str] = None,
    name: Optional[str] = None,
    image_url: Optional[str] = None
) -> Optional[User]:
    """Update user profile."""
    user = db.query(User).filter(User.id == clerk_user_id).first()
    if not user:
        return None
    
    if email:
        user.email = email
    if name:
        user.name = name
    if image_url:
        user.image_url = image_url
    
    db.commit()
    db.refresh(user)
    return user


def get_user(db: Session, clerk_user_id: str) -> Optional[User]:
    """Get user by Clerk user ID."""
    return db.query(User).filter(User.id == clerk_user_id).first()


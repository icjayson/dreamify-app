"""
Session repository functions.
"""
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from utils.postgres.models import Session as SessionModel


def create_session(
    db: Session,
    user_id: str,
    clerk_session_id: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None
) -> SessionModel:
    """Create a new session."""
    session = SessionModel(
        user_id=user_id,
        clerk_session_id=clerk_session_id,
        ip_address=ip_address,
        user_agent=user_agent
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def revoke_session(db: Session, session_id: str) -> bool:
    """Revoke a session by Clerk session ID."""
    session = db.query(SessionModel).filter(SessionModel.clerk_session_id == session_id).first()
    if not session:
        return False
    
    session.revoked_at = datetime.utcnow()
    db.commit()
    return True


def get_active_sessions_for_user(db: Session, user_id: str) -> List[SessionModel]:
    """Get all active sessions for a user."""
    return db.query(SessionModel).filter(
        SessionModel.user_id == user_id,
        SessionModel.revoked_at.is_(None)
    ).all()


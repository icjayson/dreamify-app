"""
Chat repository functions.
"""
from sqlalchemy.orm import Session
from typing import Optional
import uuid
from utils.postgres.models import Chat, Project


def create_chat_for_project(
    db: Session,
    project_id: uuid.UUID,
    title: Optional[str] = None
) -> Chat:
    """Create a chat for a project. One project can only have one chat."""
    # Check if chat already exists for this project
    existing_chat = db.query(Chat).filter(Chat.project_id == project_id).first()
    if existing_chat:
        return existing_chat
    
    chat = Chat(
        id=uuid.uuid4(),
        project_id=project_id,
        title=title
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return chat


def get_chat_by_project_id(db: Session, project_id: uuid.UUID) -> Optional[Chat]:
    """Get chat by project ID."""
    return db.query(Chat).filter(Chat.project_id == project_id).first()


def update_chat(
    db: Session,
    chat_id: uuid.UUID,
    title: Optional[str] = None
) -> Optional[Chat]:
    """Update a chat."""
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat:
        return None
    
    if title:
        chat.title = title
    
    db.commit()
    db.refresh(chat)
    return chat


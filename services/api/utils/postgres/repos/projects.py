"""
Project repository functions.
"""
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
from utils.postgres.models import Project


def create_project(
    db: Session,
    user_id: str,
    name: str,
    description: Optional[str] = None
) -> Project:
    """Create a new project."""
    project = Project(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        description=description
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def get_projects_for_user(db: Session, user_id: str) -> List[Project]:
    """Get all projects for a user."""
    return db.query(Project).filter(Project.user_id == user_id).all()


def get_project_by_id(db: Session, project_id: uuid.UUID) -> Optional[Project]:
    """Get project by ID."""
    return db.query(Project).filter(Project.id == project_id).first()


def update_project(
    db: Session,
    project_id: uuid.UUID,
    name: Optional[str] = None,
    description: Optional[str] = None
) -> Optional[Project]:
    """Update a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return None
    
    if name:
        project.name = name
    if description is not None:
        project.description = description
    
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: uuid.UUID) -> bool:
    """Delete a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return False
    
    db.delete(project)
    db.commit()
    return True


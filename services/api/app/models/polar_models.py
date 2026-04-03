"""
Pydantic models for Polar integration.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class SubscriptionStatus(str, Enum):
    """Subscription status enumeration."""
    ACTIVE = "active"
    TRIALING = "trialing"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    UNPAID = "unpaid"
    INCOMPLETE = "incomplete"
    INCOMPLETE_EXPIRED = "incomplete_expired"


class SubscriptionTier(str, Enum):
    """Subscription tier enumeration."""
    SANDBOX = "sandbox"
    PRO = "pro"
    ENTERPRISE = "enterprise"


class CreateCheckoutSessionRequest(BaseModel):
    """Request model for creating a Polar checkout session."""
    product_id: str = Field(..., description="Polar product ID")
    user_id: str = Field(..., description="Internal user ID")
    success_url: str = Field(..., description="Success redirect URL")


class CreateCheckoutSessionResponse(BaseModel):
    """Response model for creating a Polar checkout session."""
    success: bool
    url: Optional[str] = None
    error: Optional[str] = None


class SubscriptionInfo(BaseModel):
    """Model for subscription information."""
    subscription_id: str
    user_id: str
    status: SubscriptionStatus
    tier: SubscriptionTier
    current_period_end: datetime
    cancel_at_period_end: bool


class SubscriptionResponse(BaseModel):
    """Response model for subscription information."""
    success: bool
    subscription: Optional[SubscriptionInfo] = None
    error: Optional[str] = None


class CreditUsage(BaseModel):
    """Model for credit usage tracking."""
    user_id: str
    subscription_tier: SubscriptionTier
    monthly_credits_used: int
    monthly_credits_limit: int
    last_reset_date: datetime
    can_use_credits: bool


class CreditUsageResponse(BaseModel):
    """Response model for credit usage information."""
    success: bool
    usage: Optional[CreditUsage] = None
    error: Optional[str] = None


class ConsumeCreditRequest(BaseModel):
    """Request model for consuming credits."""
    user_id: str = Field(..., description="User ID")
    action: str = Field(..., description="Action being performed")
    credits_required: int = Field(1, description="Number of credits required")


class ConsumeCreditResponse(BaseModel):
    """Response model for consuming credits."""
    success: bool
    credits_consumed: Optional[int] = None
    remaining_credits: Optional[int] = None
    error: Optional[str] = None

"""
Pydantic models for Stripe integration.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class SubscriptionStatus(str, Enum):
    """Subscription status enumeration."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    CANCELLED = "cancelled"
    PAST_DUE = "past_due"
    UNPAID = "unpaid"
    TRIALING = "trialing"


class SubscriptionTier(str, Enum):
    """Subscription tier enumeration."""
    SANDBOX = "sandbox"
    PRO = "pro"
    ENTERPRISE = "enterprise"


class CreateCustomerRequest(BaseModel):
    """Request model for creating a Stripe customer."""
    email: str = Field(..., description="Customer email address")
    name: Optional[str] = Field(None, description="Customer name")
    user_id: str = Field(..., description="Internal user ID")


class CreateCustomerResponse(BaseModel):
    """Response model for creating a Stripe customer."""
    success: bool
    customer_id: Optional[str] = None
    error: Optional[str] = None


class CreateCheckoutSessionRequest(BaseModel):
    """Request model for creating a Stripe checkout session."""
    price_id: str = Field(..., description="Stripe price ID")
    customer_id: Optional[str] = Field(None, description="Existing customer ID")
    user_id: str = Field(..., description="Internal user ID")
    success_url: str = Field(..., description="Success redirect URL")
    cancel_url: str = Field(..., description="Cancel redirect URL")


class CreateCheckoutSessionResponse(BaseModel):
    """Response model for creating a Stripe checkout session."""
    success: bool
    session_id: Optional[str] = None
    session_url: Optional[str] = None
    error: Optional[str] = None


class CreateSubscriptionRequest(BaseModel):
    """Request model for creating a subscription."""
    customer_id: str = Field(..., description="Stripe customer ID")
    price_id: str = Field(..., description="Stripe price ID")
    user_id: str = Field(..., description="Internal user ID")


class CreateSubscriptionResponse(BaseModel):
    """Response model for creating a subscription."""
    success: bool
    subscription_id: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None


class SubscriptionInfo(BaseModel):
    """Model for subscription information."""
    subscription_id: str
    customer_id: str
    user_id: str
    status: SubscriptionStatus
    tier: SubscriptionTier
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool
    created_at: datetime
    updated_at: datetime


class SubscriptionResponse(BaseModel):
    """Response model for subscription information."""
    success: bool
    subscription: Optional[SubscriptionInfo] = None
    error: Optional[str] = None


class CancelSubscriptionRequest(BaseModel):
    """Request model for cancelling a subscription."""
    subscription_id: str = Field(..., description="Stripe subscription ID")
    user_id: str = Field(..., description="Internal user ID")
    cancel_at_period_end: bool = Field(True, description="Cancel at period end")


class CancelSubscriptionResponse(BaseModel):
    """Response model for cancelling a subscription."""
    success: bool
    subscription_id: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None


class CreateCustomerPortalRequest(BaseModel):
    """Request model for creating a customer portal session."""
    customer_id: str = Field(..., description="Stripe customer ID")
    user_id: str = Field(..., description="Internal user ID")
    return_url: str = Field(..., description="Return URL after portal session")


class CreateCustomerPortalResponse(BaseModel):
    """Response model for creating a customer portal session."""
    success: bool
    portal_url: Optional[str] = None
    error: Optional[str] = None


class WebhookEvent(BaseModel):
    """Model for Stripe webhook events."""
    id: str
    type: str
    data: Dict[str, Any]
    created: int
    livemode: bool


class CreditUsage(BaseModel):
    """Model for credit usage tracking."""
    user_id: str
    subscription_tier: SubscriptionTier
    daily_credits_used: int
    monthly_credits_used: int
    daily_credits_limit: int
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

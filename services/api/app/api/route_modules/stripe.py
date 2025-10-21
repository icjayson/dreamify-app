"""
FastAPI Stripe routes for payment operations.
"""

from fastapi import APIRouter, HTTPException, Query, Path
from fastapi.responses import JSONResponse
from app.services.stripe_service import StripeService
from app.models.stripe_models import (
    CreateCustomerRequest, CreateCheckoutSessionRequest,
    CreateSubscriptionRequest, CancelSubscriptionRequest,
    CreateCustomerPortalRequest, ConsumeCreditRequest,
    CreditUsageResponse
)
from app.config.stripe_config import get_all_subscription_plans
import logging

# Create router
router = APIRouter()

# Initialize Stripe service
stripe_service = StripeService()

logger = logging.getLogger(__name__)

@router.get("/products", tags=["stripe"])
async def get_products():
    """Get available subscription products."""
    try:
        plans = get_all_subscription_plans()
        return {
            'success': True,
            'products': plans
        }
    except Exception as e:
        logger.error(f"Error getting products: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/customers", tags=["stripe"])
async def create_customer(customer_request: CreateCustomerRequest):
    """Create a new Stripe customer."""
    try:
        response = stripe_service.create_customer(customer_request)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error creating customer: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/checkout/sessions", tags=["stripe"])
async def create_checkout_session(checkout_request: CreateCheckoutSessionRequest):
    """Create a Stripe checkout session."""
    try:
        response = stripe_service.create_checkout_session(checkout_request)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error creating checkout session: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/subscriptions", tags=["stripe"])
async def get_subscriptions(user_id: str = Query(..., description="User ID")):
    """Get user subscriptions."""
    try:
        # TODO: Implement actual subscription retrieval from database
        # For now, return mock data
        return {
            'success': True,
            'subscriptions': []
        }
        
    except Exception as e:
        logger.error(f"Error getting subscriptions: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/subscriptions", tags=["stripe"])
async def create_subscription(subscription_request: CreateSubscriptionRequest):
    """Create a subscription."""
    try:
        response = stripe_service.create_subscription(subscription_request)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error creating subscription: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/subscriptions/{subscription_id}", tags=["stripe"])
async def get_subscription(subscription_id: str = Path(..., description="Subscription ID")):
    """Get subscription information."""
    try:
        response = stripe_service.get_subscription(subscription_id)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error getting subscription: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/subscriptions/{subscription_id}/cancel", tags=["stripe"])
async def cancel_subscription(
    subscription_id: str = Path(..., description="Subscription ID"),
    user_id: str = Query(..., description="User ID"),
    cancel_at_period_end: bool = Query(True, description="Cancel at period end")
):
    """Cancel a subscription."""
    try:
        cancel_request = CancelSubscriptionRequest(
            subscription_id=subscription_id,
            user_id=user_id,
            cancel_at_period_end=cancel_at_period_end
        )
        
        response = stripe_service.cancel_subscription(cancel_request)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error cancelling subscription: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/customer-portal", tags=["stripe"])
async def create_customer_portal(portal_request: CreateCustomerPortalRequest):
    """Create a customer portal session."""
    try:
        response = stripe_service.create_customer_portal_session(portal_request)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error creating customer portal: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/credits/usage", tags=["stripe"])
async def get_credit_usage(
    user_id: str = Query(..., description="User ID"),
    subscription_tier: str = Query("sandbox", description="Subscription tier")
):
    """Get credit usage for a user."""
    try:
        from app.models.stripe_models import SubscriptionTier
        
        try:
            subscription_tier_enum = SubscriptionTier(subscription_tier)
        except ValueError:
            raise HTTPException(
                status_code=400, 
                detail=f'Invalid subscription tier: {subscription_tier}'
            )
        
        response = stripe_service.get_credit_usage(user_id, subscription_tier_enum)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error getting credit usage: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/credits/consume", tags=["stripe"])
async def consume_credits(consume_request: ConsumeCreditRequest):
    """Consume credits for a user action."""
    try:
        response = stripe_service.consume_credits(consume_request)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error consuming credits: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/webhooks", tags=["stripe"])
async def handle_webhook(
    payload: bytes,
    stripe_signature: str = Query(..., alias="Stripe-Signature", description="Stripe signature")
):
    """Handle Stripe webhook events."""
    try:
        if not stripe_signature:
            raise HTTPException(status_code=400, detail="Missing Stripe signature")
        
        response = stripe_service.handle_webhook(payload, stripe_signature)
        
        if response['status'] == 'success':
            return response
        else:
            raise HTTPException(status_code=400, detail=response.get('error', 'Webhook processing failed'))
            
    except Exception as e:
        logger.error(f"Error handling webhook: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

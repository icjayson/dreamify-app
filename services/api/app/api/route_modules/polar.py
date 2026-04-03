"""
FastAPI Polar routes for payment operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Path, Request
from fastapi.responses import JSONResponse
from app.services.polar_service import polar_service
from app.models.polar_models import (
    CreateCheckoutSessionRequest, ConsumeCreditRequest,
    SubscriptionTier
)
from app.config.polar_config import get_all_subscription_plans
from app.dependencies.auth import require_user
from app.services.credit_service import CreditService, DAILY_CREDIT_LIMIT
import logging

# Create router
router = APIRouter()

logger = logging.getLogger(__name__)

# Credit service instance for real DynamoDB operations
credit_service = CreditService()

@router.get("/products", tags=["polar"])
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

@router.post("/checkout/sessions", tags=["polar"])
async def create_checkout_session(checkout_request: CreateCheckoutSessionRequest):
    """Create a Polar checkout session."""
    try:
        response = polar_service.create_checkout_session(checkout_request)
        
        if response.success:
            return {
                "success": True,
                "url": response.url
            }
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error creating checkout session: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/subscriptions", tags=["polar"])
async def get_subscriptions(user_id: str = Query(..., description="User ID")):
    """Get subscriptions for a user."""
    # Note: Polar API usually allows listing by metadata or customer.
    # For now, we'll try to get the active one if possible, or return empty.
    # In a real implementation, you'd query your DB or Polar API listing.
    try:
        # This is a placeholder for actual listing logic
        # For now, we'll return a success=True with no subscription if none found
        return {
            "success": True,
            "subscription": None
        }
    except Exception as e:
        logger.error(f"Error listing subscriptions: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/subscriptions/{subscription_id}", tags=["polar"])
async def get_subscription(subscription_id: str = Path(..., description="Subscription ID")):
    """Get subscription information."""
    try:
        response = polar_service.get_subscription(subscription_id)
        
        if response.success:
            return response.dict()
        else:
            raise HTTPException(status_code=400, detail=response.error)
            
    except Exception as e:
        logger.error(f"Error getting subscription: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/credits/usage", tags=["polar"])
async def get_credit_usage(
    user_id: str = Depends(require_user),
):
    """Get credit usage for the authenticated user (reads from DynamoDB)."""
    try:
        remaining = credit_service.get_credits_remaining(user_id)
        daily_used = DAILY_CREDIT_LIMIT - remaining
        return {
            "success": True,
            "credits_remaining": remaining,
            "usage": {
                "user_id": user_id,
                "daily_credits_used": daily_used,
                "daily_credits_limit": DAILY_CREDIT_LIMIT,
                "monthly_credits_used": daily_used,
                "monthly_credits_limit": DAILY_CREDIT_LIMIT,
                "can_use_credits": remaining > 0,
            }
        }
    except Exception as e:
        logger.error(f"Error getting credit usage: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/credits/consume", tags=["polar"])
async def consume_credits(
    consume_request: ConsumeCreditRequest,
    user_id: str = Depends(require_user),
):
    """Consume credits for a user action (atomic DynamoDB write)."""
    try:
        result = credit_service.consume_credits(user_id, consume_request.credits_required)
        return {
            "success": True,
            "credits_consumed": consume_request.credits_required,
            "remaining_credits": result["credits_remaining"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error consuming credits: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/webhooks", tags=["polar"])
async def handle_webhook(request: Request):
    """Handle Polar webhook events."""
    try:
        payload = await request.body()
        # Pass all headers as a dictionary to handle_webhook
        response = polar_service.handle_webhook(payload, dict(request.headers))
        
        if response['status'] == 'success':
            return response
        else:
            raise HTTPException(status_code=400, detail=response.get('message', 'Webhook processing failed'))
            
    except Exception as e:
        logger.error(f"Error handling webhook: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

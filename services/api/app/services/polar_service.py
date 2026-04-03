"""
Polar service layer for handling payment operations.
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime
from app.config.polar_config import polar_config, get_subscription_plan, SUBSCRIPTION_PLANS
from app.models.polar_models import (
    CreateCheckoutSessionRequest, CreateCheckoutSessionResponse,
    SubscriptionInfo, SubscriptionResponse,
    SubscriptionStatus, SubscriptionTier,
    CreditUsage, CreditUsageResponse,
    ConsumeCreditRequest, ConsumeCreditResponse
)
from polar_sdk.models import CheckoutCreate, ProductPrice

logger = logging.getLogger(__name__)


class PolarService:
    """Service class for Polar operations."""
    
    def __init__(self):
        """Initialize Polar service."""
        self.client = polar_config.get_client()
        self.organization_id = polar_config.organization_id
    
    def create_checkout_session(self, request: CreateCheckoutSessionRequest) -> CreateCheckoutSessionResponse:
        """Create a Polar checkout session."""
        try:
            if not self.client:
                return CreateCheckoutSessionResponse(success=False, error="Polar client not configured")
            
            # Prepare checkout creation
            # Resolve product ID if it's a plan key or placeholder
            product_id = request.product_id
            
            # Check if it's a known plan key or the specific placeholder "pro_product_id"
            if product_id == "pro_product_id" or product_id == "pro":
                product_id = SUBSCRIPTION_PLANS['pro']['product_id']
            elif product_id == "enterprise":
                product_id = SUBSCRIPTION_PLANS['enterprise']['product_id']
            
            checkout_create = {
                "products": [product_id],
                "success_url": request.success_url,
                "metadata": {
                    "user_id": request.user_id
                }
            }
            
            # Create checkout via Polar SDK
            checkout = self.client.checkouts.create(request=checkout_create)
            
            return CreateCheckoutSessionResponse(
                success=True,
                url=checkout.url
            )
            
        except Exception as e:
            logger.exception(f"Error creating Polar checkout session: {str(e)}")
            return CreateCheckoutSessionResponse(
                success=False,
                error=str(e)
            )
    
    def get_subscription(self, subscription_id: str) -> SubscriptionResponse:
        """Get subscription information from Polar."""
        try:
            if not self.client:
                return SubscriptionResponse(success=False, error="Polar client not configured")
            
            subscription = self.client.subscriptions.get(id=subscription_id)
            
            # Map Polar subscription to our Internal model
            # Note: This is an example mapping based on typical Polar SDK structure
            subscription_info = SubscriptionInfo(
                subscription_id=subscription.id,
                user_id=subscription.metadata.get('user_id', ''),
                status=SubscriptionStatus(subscription.status),
                tier=self._map_product_to_tier(subscription.product_id),
                current_period_end=subscription.current_period_end,
                cancel_at_period_end=subscription.cancel_at_period_end if hasattr(subscription, 'cancel_at_period_end') else False
            )
            
            return SubscriptionResponse(
                success=True,
                subscription=subscription_info
            )
            
        except Exception as e:
            logger.error(f"Error getting Polar subscription: {str(e)}")
            return SubscriptionResponse(
                success=False,
                error=str(e)
            )

    def _map_product_to_tier(self, product_id: str) -> SubscriptionTier:
        """Map Polar product ID to internal subscription tier."""
        # This mapping should ideally come from configuration
        # For now, we'll return PRO as default if it matches our pro product_id
        from app.config.polar_config import SUBSCRIPTION_PLANS
        if product_id == SUBSCRIPTION_PLANS['pro']['product_id']:
            return SubscriptionTier.PRO
        elif product_id == SUBSCRIPTION_PLANS['enterprise']['product_id']:
            return SubscriptionTier.ENTERPRISE
        return SubscriptionTier.SANDBOX

    def get_credit_usage(self, user_id: str, subscription_tier: SubscriptionTier) -> CreditUsageResponse:
        """Get credit usage information for a user (reads from DynamoDB)."""
        try:
            from app.services.credit_service import CreditService, DAILY_CREDIT_LIMIT
            credit_svc = CreditService()
            remaining = credit_svc.get_credits_remaining(user_id)
            daily_used = DAILY_CREDIT_LIMIT - remaining

            usage = CreditUsage(
                user_id=user_id,
                subscription_tier=subscription_tier,
                daily_credits_used=daily_used,
                monthly_credits_used=daily_used,
                daily_credits_limit=DAILY_CREDIT_LIMIT,
                monthly_credits_limit=DAILY_CREDIT_LIMIT,
                last_reset_date=datetime.now(),
                can_use_credits=remaining > 0
            )
            
            return CreditUsageResponse(
                success=True,
                usage=usage
            )
            
        except Exception as e:
            logger.error(f"Error getting credit usage: {str(e)}")
            return CreditUsageResponse(
                success=False,
                error="Internal server error"
            )
    
    def consume_credits(self, request: ConsumeCreditRequest) -> ConsumeCreditResponse:
        """Consume credits for a user action (atomic DynamoDB write)."""
        try:
            from app.services.credit_service import CreditService
            credit_svc = CreditService()
            result = credit_svc.consume_credits(request.user_id, request.credits_required)
            return ConsumeCreditResponse(
                success=True,
                credits_consumed=request.credits_required,
                remaining_credits=result["credits_remaining"]
            )
            
        except Exception as e:
            logger.error(f"Error consuming credits: {str(e)}")
            return ConsumeCreditResponse(
                success=False,
                error=str(e)
            )
    
    def handle_webhook(self, payload: bytes, headers: Dict[str, str]) -> Dict[str, Any]:
        """Handle Polar webhook events."""
        try:
            from polar_sdk.webhooks import validate_event
            
            if not self.client:
                return {'status': 'error', 'message': 'Polar client not configured'}
            
            # Verify and parse webhook
            # validate_event expects body (bytes/str), headers (dict), and secret (str)
            event = validate_event(
                payload, headers, polar_config.get_webhook_secret()
            )
            
            event_type = event.type
            data = event.data
            
            if event_type == 'subscription.created':
                self._handle_subscription_created(data)
            elif event_type == 'subscription.updated':
                self._handle_subscription_updated(data)
            elif event_type == 'subscription.revoked':
                self._handle_subscription_revoked(data)
            
            return {'status': 'success'}
            
        except Exception as e:
            logger.exception(f"Webhook error: {str(e)}")
            return {'status': 'error', 'message': str(e)}
    
    def _handle_subscription_created(self, data):
        """Handle subscription created webhook."""
        user_id = data.metadata.get('user_id')
        subscription_id = data.id
        logger.info(f"Polar subscription created: {subscription_id} for user {user_id}")
        # TODO: Update user subscription status in database
    
    def _handle_subscription_updated(self, data):
        """Handle subscription updated webhook."""
        user_id = data.metadata.get('user_id')
        subscription_id = data.id
        logger.info(f"Polar subscription updated: {subscription_id} for user {user_id}")
        # TODO: Update user subscription status in database
    
    def _handle_subscription_revoked(self, data):
        """Handle subscription revoked/cancelled webhook."""
        user_id = data.metadata.get('user_id')
        subscription_id = data.id
        logger.info(f"Polar subscription revoked: {subscription_id} for user {user_id}")
        # TODO: Update user subscription status in database


# Global instance
polar_service = PolarService()

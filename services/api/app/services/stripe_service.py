"""
Stripe service layer for handling payment operations.
"""

import stripe
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from app.config.stripe_config import stripe_config, get_subscription_plan
from app.models.stripe_models import (
    CreateCustomerRequest, CreateCustomerResponse,
    CreateCheckoutSessionRequest, CreateCheckoutSessionResponse,
    CreateSubscriptionRequest, CreateSubscriptionResponse,
    SubscriptionInfo, SubscriptionResponse,
    CancelSubscriptionRequest, CancelSubscriptionResponse,
    CreateCustomerPortalRequest, CreateCustomerPortalResponse,
    CreditUsage, CreditUsageResponse,
    ConsumeCreditRequest, ConsumeCreditResponse,
    SubscriptionStatus, SubscriptionTier
)

logger = logging.getLogger(__name__)


class StripeService:
    """Service class for Stripe operations."""
    
    def __init__(self):
        """Initialize Stripe service."""
        self.stripe = stripe_config.get_stripe_client()
    
    def create_customer(self, request: CreateCustomerRequest) -> CreateCustomerResponse:
        """Create a new Stripe customer."""
        try:
            customer = self.stripe.Customer.create(
                email=request.email,
                name=request.name,
                metadata={
                    'user_id': request.user_id
                }
            )
            
            return CreateCustomerResponse(
                success=True,
                customer_id=customer.id
            )
            
        except stripe.StripeError as e:
            logger.error(f"Stripe error creating customer: {str(e)}")
            return CreateCustomerResponse(
                success=False,
                error=str(e)
            )
        except Exception as e:
            logger.error(f"Unexpected error creating customer: {str(e)}")
            return CreateCustomerResponse(
                success=False,
                error="Internal server error"
            )
    
    def create_checkout_session(self, request: CreateCheckoutSessionRequest) -> CreateCheckoutSessionResponse:
        """Create a Stripe checkout session."""
        try:
            # For testing purposes, use one-time payment instead of subscription
            # This avoids the need for pre-existing price IDs
            session_params = {
                'payment_method_types': ['card'],
                'line_items': [{
                    'price_data': {
                        'currency': 'usd',
                        'product_data': {
                            'name': 'Pro Plan - Monthly',
                        },
                        'unit_amount': 2900,  # $29.00 in cents
                        'recurring': {
                            'interval': 'month',
                        },
                    },
                    'quantity': 1,
                }],
                'mode': 'subscription',
                'success_url': request.success_url,
                'cancel_url': request.cancel_url,
                'metadata': {
                    'user_id': request.user_id
                }
            }
            
            if request.customer_id:
                session_params['customer'] = request.customer_id
            else:
                # Create customer if not provided
                customer = self.stripe.Customer.create(
                    metadata={'user_id': request.user_id}
                )
                session_params['customer'] = customer.id
            
            session = self.stripe.checkout.Session.create(**session_params)
            
            return CreateCheckoutSessionResponse(
                success=True,
                session_id=session.id,
                session_url=session.url
            )
            
        except stripe.StripeError as e:
            logger.error(f"Stripe error creating checkout session: {str(e)}")
            return CreateCheckoutSessionResponse(
                success=False,
                error=str(e)
            )
        except Exception as e:
            logger.error(f"Unexpected error creating checkout session: {str(e)}")
            return CreateCheckoutSessionResponse(
                success=False,
                error="Internal server error"
            )
    
    def create_subscription(self, request: CreateSubscriptionRequest) -> CreateSubscriptionResponse:
        """Create a subscription for a customer."""
        try:
            subscription = self.stripe.Subscription.create(
                customer=request.customer_id,
                items=[{
                    'price': request.price_id,
                }],
                metadata={
                    'user_id': request.user_id
                }
            )
            
            return CreateSubscriptionResponse(
                success=True,
                subscription_id=subscription.id,
                status=subscription.status
            )
            
        except stripe.StripeError as e:
            logger.error(f"Stripe error creating subscription: {str(e)}")
            return CreateSubscriptionResponse(
                success=False,
                error=str(e)
            )
        except Exception as e:
            logger.error(f"Unexpected error creating subscription: {str(e)}")
            return CreateSubscriptionResponse(
                success=False,
                error="Internal server error"
            )
    
    def get_subscription(self, subscription_id: str) -> SubscriptionResponse:
        """Get subscription information."""
        try:
            subscription = self.stripe.Subscription.retrieve(subscription_id)
            
            # Determine subscription tier based on price
            tier = self._get_subscription_tier(subscription)
            
            subscription_info = SubscriptionInfo(
                subscription_id=subscription.id,
                customer_id=subscription.customer,
                user_id=subscription.metadata.get('user_id', ''),
                status=SubscriptionStatus(subscription.status),
                tier=tier,
                current_period_start=datetime.fromtimestamp(subscription.current_period_start),
                current_period_end=datetime.fromtimestamp(subscription.current_period_end),
                cancel_at_period_end=subscription.cancel_at_period_end,
                created_at=datetime.fromtimestamp(subscription.created),
                updated_at=datetime.fromtimestamp(subscription.updated)
            )
            
            return SubscriptionResponse(
                success=True,
                subscription=subscription_info
            )
            
        except stripe.StripeError as e:
            logger.error(f"Stripe error getting subscription: {str(e)}")
            return SubscriptionResponse(
                success=False,
                error=str(e)
            )
        except Exception as e:
            logger.error(f"Unexpected error getting subscription: {str(e)}")
            return SubscriptionResponse(
                success=False,
                error="Internal server error"
            )
    
    def cancel_subscription(self, request: CancelSubscriptionRequest) -> CancelSubscriptionResponse:
        """Cancel a subscription."""
        try:
            if request.cancel_at_period_end:
                subscription = self.stripe.Subscription.modify(
                    request.subscription_id,
                    cancel_at_period_end=True
                )
            else:
                subscription = self.stripe.Subscription.delete(request.subscription_id)
            
            return CancelSubscriptionResponse(
                success=True,
                subscription_id=request.subscription_id,
                status=subscription.status
            )
            
        except stripe.StripeError as e:
            logger.error(f"Stripe error cancelling subscription: {str(e)}")
            return CancelSubscriptionResponse(
                success=False,
                error=str(e)
            )
        except Exception as e:
            logger.error(f"Unexpected error cancelling subscription: {str(e)}")
            return CancelSubscriptionResponse(
                success=False,
                error="Internal server error"
            )
    
    def create_customer_portal_session(self, request: CreateCustomerPortalRequest) -> CreateCustomerPortalResponse:
        """Create a customer portal session."""
        try:
            session = self.stripe.billing_portal.Session.create(
                customer=request.customer_id,
                return_url=request.return_url
            )
            
            return CreateCustomerPortalResponse(
                success=True,
                portal_url=session.url
            )
            
        except stripe.StripeError as e:
            logger.error(f"Stripe error creating portal session: {str(e)}")
            return CreateCustomerPortalResponse(
                success=False,
                error=str(e)
            )
        except Exception as e:
            logger.error(f"Unexpected error creating portal session: {str(e)}")
            return CreateCustomerPortalResponse(
                success=False,
                error="Internal server error"
            )
    
    def get_credit_usage(self, user_id: str, subscription_tier: SubscriptionTier) -> CreditUsageResponse:
        """Get credit usage information for a user."""
        try:
            plan = get_subscription_plan(subscription_tier.value)
            
            # TODO: Implement actual credit tracking from database
            # For now, return mock data
            usage = CreditUsage(
                user_id=user_id,
                subscription_tier=subscription_tier,
                daily_credits_used=0,  # TODO: Get from database
                monthly_credits_used=0,  # TODO: Get from database
                daily_credits_limit=plan['daily_credits'],
                monthly_credits_limit=plan['monthly_credits'],
                last_reset_date=datetime.now(),
                can_use_credits=True  # TODO: Implement logic
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
        """Consume credits for a user action."""
        try:
            # TODO: Implement actual credit consumption logic
            # For now, return mock success
            return ConsumeCreditResponse(
                success=True,
                credits_consumed=request.credits_required,
                remaining_credits=100  # TODO: Get actual remaining credits
            )
            
        except Exception as e:
            logger.error(f"Error consuming credits: {str(e)}")
            return ConsumeCreditResponse(
                success=False,
                error="Internal server error"
            )
    
    def _get_subscription_tier(self, subscription) -> SubscriptionTier:
        """Determine subscription tier from Stripe subscription."""
        # TODO: Implement logic to map Stripe price to subscription tier
        # For now, return PRO as default
        return SubscriptionTier.PRO
    
    def handle_webhook(self, payload: bytes, signature: str) -> Dict[str, Any]:
        """Handle Stripe webhook events."""
        try:
            event = self.stripe.Webhook.construct_event(
                payload, signature, stripe_config.get_webhook_secret()
            )
            
            # Handle different event types
            if event['type'] == 'customer.subscription.created':
                self._handle_subscription_created(event)
            elif event['type'] == 'customer.subscription.updated':
                self._handle_subscription_updated(event)
            elif event['type'] == 'customer.subscription.deleted':
                self._handle_subscription_deleted(event)
            elif event['type'] == 'invoice.payment_succeeded':
                self._handle_payment_succeeded(event)
            elif event['type'] == 'invoice.payment_failed':
                self._handle_payment_failed(event)
            
            return {'status': 'success'}
            
        except ValueError as e:
            logger.error(f"Invalid payload: {str(e)}")
            return {'status': 'error', 'message': 'Invalid payload'}
        except stripe.SignatureVerificationError as e:
            logger.error(f"Invalid signature: {str(e)}")
            return {'status': 'error', 'message': 'Invalid signature'}
        except Exception as e:
            logger.error(f"Webhook error: {str(e)}")
            return {'status': 'error', 'message': 'Internal server error'}
    
    def _handle_subscription_created(self, event):
        """Handle subscription created webhook."""
        subscription = event['data']['object']
        user_id = subscription['metadata'].get('user_id')
        logger.info(f"Subscription created for user {user_id}")
        # TODO: Update user subscription status in database
    
    def _handle_subscription_updated(self, event):
        """Handle subscription updated webhook."""
        subscription = event['data']['object']
        user_id = subscription['metadata'].get('user_id')
        logger.info(f"Subscription updated for user {user_id}")
        # TODO: Update user subscription status in database
    
    def _handle_subscription_deleted(self, event):
        """Handle subscription deleted webhook."""
        subscription = event['data']['object']
        user_id = subscription['metadata'].get('user_id')
        logger.info(f"Subscription deleted for user {user_id}")
        # TODO: Update user subscription status in database
    
    def _handle_payment_succeeded(self, event):
        """Handle successful payment webhook."""
        invoice = event['data']['object']
        customer_id = invoice['customer']
        logger.info(f"Payment succeeded for customer {customer_id}")
        # TODO: Update user payment status in database
    
    def _handle_payment_failed(self, event):
        """Handle failed payment webhook."""
        invoice = event['data']['object']
        customer_id = invoice['customer']
        logger.info(f"Payment failed for customer {customer_id}")
        # TODO: Update user payment status in database

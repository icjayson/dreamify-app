"""
Stripe API routes for payment operations.
"""

from flask import Blueprint, request, jsonify
from app.services.stripe_service import StripeService
from app.models.stripe_models import (
    CreateCustomerRequest, CreateCheckoutSessionRequest,
    CreateSubscriptionRequest, CancelSubscriptionRequest,
    CreateCustomerPortalRequest, ConsumeCreditRequest,
    CreditUsageResponse
)
from app.config.stripe_config import get_all_subscription_plans
import logging

# Create blueprint
stripe_bp = Blueprint('stripe', __name__)

# Initialize Stripe service
stripe_service = StripeService()

logger = logging.getLogger(__name__)


@stripe_bp.route('/products', methods=['GET'])
def get_products():
    """Get available subscription products."""
    try:
        plans = get_all_subscription_plans()
        return jsonify({
            'success': True,
            'products': plans
        }), 200
    except Exception as e:
        logger.error(f"Error getting products: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/customers', methods=['POST'])
def create_customer():
    """Create a new Stripe customer."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        customer_request = CreateCustomerRequest(**data)
        response = stripe_service.create_customer(customer_request)
        
        if response.success:
            return jsonify(response.dict()), 201
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error creating customer: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/checkout/sessions', methods=['POST'])
def create_checkout_session():
    """Create a Stripe checkout session."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        checkout_request = CreateCheckoutSessionRequest(**data)
        response = stripe_service.create_checkout_session(checkout_request)
        
        if response.success:
            return jsonify(response.dict()), 201
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error creating checkout session: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/subscriptions', methods=['GET', 'POST'])
def handle_subscriptions():
    """Handle subscriptions - GET for listing, POST for creating."""
    if request.method == 'GET':
        return get_subscriptions()
    else:
        return create_subscription()

def get_subscriptions():
    """Get user subscriptions."""
    try:
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({
                'success': False,
                'error': 'user_id parameter is required'
            }), 400
        
        # TODO: Implement actual subscription retrieval from database
        # For now, return mock data
        return jsonify({
            'success': True,
            'subscriptions': []
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting subscriptions: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

def create_subscription():
    """Create a subscription."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        subscription_request = CreateSubscriptionRequest(**data)
        response = stripe_service.create_subscription(subscription_request)
        
        if response.success:
            return jsonify(response.dict()), 201
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error creating subscription: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/subscriptions/<subscription_id>', methods=['GET'])
def get_subscription(subscription_id):
    """Get subscription information."""
    try:
        response = stripe_service.get_subscription(subscription_id)
        
        if response.success:
            return jsonify(response.dict()), 200
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error getting subscription: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/subscriptions/<subscription_id>/cancel', methods=['POST'])
def cancel_subscription(subscription_id):
    """Cancel a subscription."""
    try:
        data = request.get_json() or {}
        cancel_request = CancelSubscriptionRequest(
            subscription_id=subscription_id,
            user_id=data.get('user_id', ''),
            cancel_at_period_end=data.get('cancel_at_period_end', True)
        )
        
        response = stripe_service.cancel_subscription(cancel_request)
        
        if response.success:
            return jsonify(response.dict()), 200
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error cancelling subscription: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/customer-portal', methods=['POST'])
def create_customer_portal():
    """Create a customer portal session."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        portal_request = CreateCustomerPortalRequest(**data)
        response = stripe_service.create_customer_portal_session(portal_request)
        
        if response.success:
            return jsonify(response.dict()), 200
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error creating customer portal: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/credits/usage', methods=['GET'])
def get_credit_usage():
    """Get credit usage for a user."""
    try:
        user_id = request.args.get('user_id')
        subscription_tier_str = request.args.get('subscription_tier', 'sandbox')
        
        if not user_id:
            return jsonify({
                'success': False,
                'error': 'user_id parameter is required'
            }), 400
        
        # Convert string to SubscriptionTier enum
        from app.models.stripe_models import SubscriptionTier
        try:
            subscription_tier = SubscriptionTier(subscription_tier_str)
        except ValueError:
            return jsonify({
                'success': False,
                'error': f'Invalid subscription tier: {subscription_tier_str}'
            }), 400
        
        response = stripe_service.get_credit_usage(user_id, subscription_tier)
        
        if response.success:
            return jsonify(response.dict()), 200
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error getting credit usage: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/credits/consume', methods=['POST'])
def consume_credits():
    """Consume credits for a user action."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        consume_request = ConsumeCreditRequest(**data)
        response = stripe_service.consume_credits(consume_request)
        
        if response.success:
            return jsonify(response.dict()), 200
        else:
            return jsonify(response.dict()), 400
            
    except Exception as e:
        logger.error(f"Error consuming credits: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@stripe_bp.route('/webhooks', methods=['POST'])
def handle_webhook():
    """Handle Stripe webhook events."""
    try:
        payload = request.get_data()
        signature = request.headers.get('Stripe-Signature')
        
        if not signature:
            return jsonify({
                'success': False,
                'error': 'Missing Stripe signature'
            }), 400
        
        response = stripe_service.handle_webhook(payload, signature)
        
        if response['status'] == 'success':
            return jsonify(response), 200
        else:
            return jsonify(response), 400
            
    except Exception as e:
        logger.error(f"Error handling webhook: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

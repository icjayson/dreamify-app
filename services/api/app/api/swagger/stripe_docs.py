"""
Swagger documentation for Stripe API endpoints.
"""

from flask_restx import Resource, fields
from app.services.stripe_service import StripeService

# Initialize Stripe service
stripe_service = StripeService()

# Define request/response models for Swagger
subscription_plan_model = {
    'name': fields.String(required=True, description='Plan name'),
    'price_id': fields.String(description='Stripe price ID'),
    'monthly_credits': fields.Integer(description='Monthly credits limit'),
    'daily_credits': fields.Integer(description='Daily credits limit'),
    'data_retention_days': fields.Integer(description='Data retention in days'),
    'features': fields.List(fields.String, description='Plan features')
}

products_response_model = {
    'success': fields.Boolean(required=True, description='Request success status'),
    'products': fields.Raw(description='Available subscription plans')
}

subscription_model = {
    'subscription_id': fields.String(required=True, description='Stripe subscription ID'),
    'customer_id': fields.String(required=True, description='Stripe customer ID'),
    'user_id': fields.String(required=True, description='Internal user ID'),
    'status': fields.String(required=True, description='Subscription status'),
    'tier': fields.String(required=True, description='Subscription tier'),
    'current_period_start': fields.DateTime(description='Current period start'),
    'current_period_end': fields.DateTime(description='Current period end'),
    'cancel_at_period_end': fields.Boolean(description='Cancel at period end'),
    'created_at': fields.DateTime(description='Creation timestamp'),
    'updated_at': fields.DateTime(description='Last update timestamp')
}

subscriptions_response_model = {
    'success': fields.Boolean(required=True, description='Request success status'),
    'subscriptions': fields.List(fields.Nested(subscription_model), description='User subscriptions')
}

credit_usage_model = {
    'user_id': fields.String(required=True, description='User ID'),
    'subscription_tier': fields.String(required=True, description='Subscription tier'),
    'daily_credits_used': fields.Integer(description='Daily credits used'),
    'monthly_credits_used': fields.Integer(description='Monthly credits used'),
    'daily_credits_limit': fields.Integer(description='Daily credits limit'),
    'monthly_credits_limit': fields.Integer(description='Monthly credits limit'),
    'last_reset_date': fields.DateTime(description='Last reset date'),
    'can_use_credits': fields.Boolean(description='Can use credits')
}

credit_usage_response_model = {
    'success': fields.Boolean(required=True, description='Request success status'),
    'usage': fields.Nested(credit_usage_model, description='Credit usage information')
}

checkout_session_request_model = {
    'price_id': fields.String(required=True, description='Stripe price ID'),
    'user_id': fields.String(required=True, description='Internal user ID'),
    'success_url': fields.String(required=True, description='Success redirect URL'),
    'cancel_url': fields.String(required=True, description='Cancel redirect URL')
}

checkout_session_response_model = {
    'success': fields.Boolean(required=True, description='Request success status'),
    'session_id': fields.String(description='Stripe checkout session ID'),
    'session_url': fields.String(description='Stripe checkout session URL'),
    'error': fields.String(description='Error message')
}

def add_stripe_endpoints(api, stripe_ns):
    """Add Stripe endpoints to Swagger documentation."""
    
    @stripe_ns.route('/products')
    class Products(Resource):
        @stripe_ns.doc('get_products')
        @stripe_ns.marshal_with(products_response_model)
        def get(self):
            """Get available subscription products."""
            try:
                from app.config.stripe_config import get_all_subscription_plans
                plans = get_all_subscription_plans()
                return {
                    'success': True,
                    'products': plans
                }, 200
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

    @stripe_ns.route('/subscriptions')
    class Subscriptions(Resource):
        @stripe_ns.doc('get_subscriptions')
        @stripe_ns.marshal_with(subscriptions_response_model)
        def get(self):
            """Get user subscriptions."""
            try:
                from flask import request
                user_id = request.args.get('user_id')
                if not user_id:
                    return {
                        'success': False,
                        'error': 'user_id parameter is required'
                    }, 400
                
                # TODO: Implement actual subscription retrieval from database
                return {
                    'success': True,
                    'subscriptions': []
                }, 200
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

    @stripe_ns.route('/credits/usage')
    class CreditUsage(Resource):
        @stripe_ns.doc('get_credit_usage')
        @stripe_ns.marshal_with(credit_usage_response_model)
        def get(self):
            """Get credit usage for a user."""
            try:
                from flask import request
                from app.models.stripe_models import SubscriptionTier
                
                user_id = request.args.get('user_id')
                subscription_tier_str = request.args.get('subscription_tier', 'sandbox')
                
                if not user_id:
                    return {
                        'success': False,
                        'error': 'user_id parameter is required'
                    }, 400
                
                # Convert string to SubscriptionTier enum
                try:
                    subscription_tier = SubscriptionTier(subscription_tier_str)
                except ValueError:
                    return {
                        'success': False,
                        'error': f'Invalid subscription tier: {subscription_tier_str}'
                    }, 400
                
                response = stripe_service.get_credit_usage(user_id, subscription_tier)
                
                if response.success:
                    return response.dict(), 200
                else:
                    return response.dict(), 400
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

    @stripe_ns.route('/checkout/sessions')
    class CheckoutSessions(Resource):
        @stripe_ns.doc('create_checkout_session')
        @stripe_ns.expect(checkout_session_request_model)
        @stripe_ns.marshal_with(checkout_session_response_model)
        def post(self):
            """Create a Stripe checkout session."""
            try:
                from flask import request
                from app.models.stripe_models import CreateCheckoutSessionRequest
                
                data = request.get_json()
                if not data:
                    return {
                        'success': False,
                        'error': 'No request data provided'
                    }, 400
                
                checkout_request = CreateCheckoutSessionRequest(**data)
                response = stripe_service.create_checkout_session(checkout_request)
                
                if response.success:
                    return response.dict(), 201
                else:
                    return response.dict(), 400
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

    @stripe_ns.route('/customers')
    class Customers(Resource):
        @stripe_ns.doc('create_customer')
        def post(self):
            """Create a new Stripe customer."""
            try:
                from flask import request
                from app.models.stripe_models import CreateCustomerRequest
                
                data = request.get_json()
                if not data:
                    return {
                        'success': False,
                        'error': 'No request data provided'
                    }, 400
                
                customer_request = CreateCustomerRequest(**data)
                response = stripe_service.create_customer(customer_request)
                
                if response.success:
                    return response.dict(), 201
                else:
                    return response.dict(), 400
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

    @stripe_ns.route('/customer-portal')
    class CustomerPortal(Resource):
        @stripe_ns.doc('create_customer_portal')
        def post(self):
            """Create a customer portal session."""
            try:
                from flask import request
                from app.models.stripe_models import CreateCustomerPortalRequest
                
                data = request.get_json()
                if not data:
                    return {
                        'success': False,
                        'error': 'No request data provided'
                    }, 400
                
                portal_request = CreateCustomerPortalRequest(**data)
                response = stripe_service.create_customer_portal_session(portal_request)
                
                if response.success:
                    return response.dict(), 200
                else:
                    return response.dict(), 400
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

    @stripe_ns.route('/credits/consume')
    class ConsumeCredits(Resource):
        @stripe_ns.doc('consume_credits')
        def post(self):
            """Consume credits for a user action."""
            try:
                from flask import request
                from app.models.stripe_models import ConsumeCreditRequest
                
                data = request.get_json()
                if not data:
                    return {
                        'success': False,
                        'error': 'No request data provided'
                    }, 400
                
                credit_request = ConsumeCreditRequest(**data)
                response = stripe_service.consume_credits(credit_request)
                
                if response.success:
                    return response.dict(), 200
                else:
                    return response.dict(), 400
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

    @stripe_ns.route('/webhooks')
    class Webhooks(Resource):
        @stripe_ns.doc('handle_webhook')
        def post(self):
            """Handle Stripe webhook events."""
            try:
                from flask import request
                
                payload = request.get_data()
                signature = request.headers.get('Stripe-Signature')
                
                if not signature:
                    return {
                        'success': False,
                        'error': 'Missing Stripe signature'
                    }, 400
                
                response = stripe_service.handle_webhook(payload, signature)
                
                if response['status'] == 'success':
                    return response, 200
                else:
                    return response, 400
            except Exception as e:
                return {
                    'success': False,
                    'error': 'Internal server error'
                }, 500

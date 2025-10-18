"""
Main application entry point for Vibe Analytics Studio Backend.
"""

from flask import Flask
from flask_cors import CORS
from flask_restx import Api, Resource, fields
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

def create_app():
    """Create and configure the Flask application."""
    app = Flask(__name__)
    
    # Configure CORS
    CORS(
        app, 
        origins=[
            "http://localhost:8080", 
            "http://localhost:8000",
            "http://localhost:5000",
            "https://app.dreamify.dev",
            "*"  # Allow all origins for development; restrict in production
        ]
    )
    
    # Basic configuration
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
    app.config['DEBUG'] = os.getenv('DEBUG', 'True').lower() == 'true'
    
    # Initialize Flask-RESTX API
    api = Api(
        app,
        version='1.0',
        title='Dreamify Analytics API',
        description='API for Dreamify Analytics Platform with Stripe integration',
        doc='/docs/',
        prefix='/api/v1'
    )
    
    # Create Stripe namespace for Swagger documentation
    stripe_ns = api.namespace('stripe', description='Stripe payment operations')
    
    # Register blueprints
    print("DEBUG: Importing API blueprint...")
    from app.api.routes import api_bp
    print("DEBUG: API blueprint imported successfully")
    print(f"DEBUG: API blueprint name: {api_bp.name}")
    
    print("DEBUG: Registering API blueprint with main app...")
    app.register_blueprint(api_bp, url_prefix='/api/v1')
    print("DEBUG: API blueprint registered successfully with prefix /api/v1")
    
    # Debug: List all routes in the main app
    print("DEBUG: Main app routes after registration:")
    for rule in app.url_map.iter_rules():
        if 'stripe' in rule.rule:
            print(f"  - {rule.methods} {rule.rule}")
    
    # Add Stripe endpoints to Swagger documentation
    @stripe_ns.route('/products')
    class Products(Resource):
        @stripe_ns.doc('get_products')
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
                
                try:
                    subscription_tier = SubscriptionTier(subscription_tier_str)
                except ValueError:
                    return {
                        'success': False,
                        'error': f'Invalid subscription tier: {subscription_tier_str}'
                    }, 400
                
                from app.services.stripe_service import StripeService
                stripe_service = StripeService()
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
                
                from app.services.stripe_service import StripeService
                stripe_service = StripeService()
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
    
    @app.route('/health')
    def health_check():
        """Health check endpoint."""
        return {'status': 'healthy', 'service': 'vibe-analytics-backend'}
    
    @app.route('/')
    def index():
        """Root endpoint."""
        return {
            'message': 'Welcome to Vibe Analytics Studio Backend',
            'version': '1.0.0',
            'docs': '/api/v1/docs'
        }
    
    return app

app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=app.config["DEBUG"])

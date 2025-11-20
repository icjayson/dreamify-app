"""
Stripe configuration module for Dreamify Analytics Platform.
"""

import stripe
from typing import Optional
from utils.config import config


class StripeConfig:
    """Stripe configuration and client management."""
    
    def __init__(self):
        """Initialize Stripe configuration."""
        self.publishable_key = config.stripe.publishable_key
        self.secret_key = config.stripe.secret_key
        self.webhook_secret = config.stripe.webhook_secret
        
        # Configure Stripe API key
        if self.secret_key:
            stripe.api_key = self.secret_key
        else:
            raise ValueError("Stripe secret_key is required in config.yaml")
    
    def get_publishable_key(self) -> Optional[str]:
        """Get Stripe publishable key for frontend."""
        return self.publishable_key
    
    def get_webhook_secret(self) -> Optional[str]:
        """Get Stripe webhook secret for webhook verification."""
        return self.webhook_secret
    
    def is_configured(self) -> bool:
        """Check if Stripe is properly configured."""
        return bool(self.secret_key and self.publishable_key)
    
    def get_stripe_client(self):
        """Get configured Stripe client."""
        if not self.is_configured():
            raise ValueError("Stripe is not properly configured")
        return stripe


# Create global Stripe configuration instance
stripe_config = StripeConfig()


# Subscription plan configurations
SUBSCRIPTION_PLANS = {
    'sandbox': {
        'name': 'Sandbox',
        'price_id': None,  # Free tier
        'monthly_credits': 5,
        'daily_credits': 5,
        'data_retention_days': 7,
        'features': [
            '5 daily credits',
            'Diverse templates',
            'User roles & permissions',
            '7-day data retention'
        ]
    },
    'pro': {
        'name': 'Pro',
        'price_id': 'price_pro_monthly',  # Will be set when created in Stripe
        'monthly_credits': 100,
        'daily_credits': 5,
        'data_retention_days': 30,
        'features': [
            '100 monthly credits',
            '5 daily credits (up to 150/month)',
            '30-day data retention',
            'Custom domains',
            'Remove the Dreamify badge',
            'User roles & permissions'
        ]
    },
    'enterprise': {
        'name': 'Enterprise',
        'price_id': 'price_enterprise_custom',  # Custom pricing
        'monthly_credits': -1,  # Unlimited
        'daily_credits': -1,  # Unlimited
        'data_retention_days': 365,
        'features': [
            'Dedicated support',
            'Onboarding services',
            'Custom connections',
            'Group-based access control',
            'Custom design systems'
        ]
    }
}


def get_subscription_plan(plan_name: str) -> dict:
    """Get subscription plan configuration by name."""
    return SUBSCRIPTION_PLANS.get(plan_name, SUBSCRIPTION_PLANS['sandbox'])


def get_all_subscription_plans() -> dict:
    """Get all available subscription plans."""
    return SUBSCRIPTION_PLANS

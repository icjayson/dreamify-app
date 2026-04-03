"""
Polar configuration module for Dreamify Analytics Platform.
"""

from polar_sdk import Polar
from typing import Optional
from utils.config import config


class PolarConfig:
    """Polar configuration and client management."""

    def __init__(self):
        """Initialize Polar configuration."""
        polar_settings = getattr(config, "polar", None)
        self.access_token = (
            getattr(polar_settings, "access_token", None) if polar_settings else None
        )
        self.organization_id = (
            getattr(polar_settings, "organization_id", None) if polar_settings else None
        )
        self.webhook_secret = (
            getattr(polar_settings, "webhook_secret", None) if polar_settings else None
        )
        self.is_sandbox = (
            getattr(polar_settings, "is_sandbox", True) if polar_settings else True
        )

        # Configure Polar client
        if self.access_token:
            server = "sandbox" if self.is_sandbox else "production"
            self.client = Polar(access_token=self.access_token, server=server)
        else:
            self.client = None

    def get_client(self) -> Optional[Polar]:
        """Get configured Polar client."""
        return self.client

    def get_webhook_secret(self) -> Optional[str]:
        """Get Polar webhook secret for webhook verification."""
        return self.webhook_secret

    def is_configured(self) -> bool:
        """Check if Polar is properly configured."""
        return bool(self.access_token and self.organization_id)


# Create global Polar configuration instance
polar_config = PolarConfig()


# Subscription plan configurations (mapped to Polar product IDs)
SUBSCRIPTION_PLANS = {
    "sandbox": {
        "name": "Sandbox",
        "product_id": None,  # Free tier
        "monthly_credits": 100,
        "data_retention_days": 7,
        "features": [
            "100 monthly credits",
            "Diverse templates",
            "User roles & permissions",
            "7-day data retention",
        ],
    },
    "pro": {
        "name": "Pro",
        "product_id": "3811ada3-0bd9-48e5-9455-c4a57af6bc54",  # Actual Polar Product ID
        "monthly_credits": 1000,
        "data_retention_days": 30,
        "features": [
            "1,000 monthly credits",
            "30-day data retention",
            "Custom domains",
            "Remove the Dreamify badge",
            "User roles & permissions",
        ],
    },
    "enterprise": {
        "name": "Enterprise",
        "product_id": "enterprise_product_id",  # Custom pricing
        "monthly_credits": -1,  # Unlimited
        "data_retention_days": 365,
        "features": [
            "Dedicated support",
            "Onboarding services",
            "Custom connections",
            "Group-based access control",
            "Custom design systems",
        ],
    },
}


def get_subscription_plan(plan_name: str) -> dict:
    """Get subscription plan configuration by name."""
    return SUBSCRIPTION_PLANS.get(plan_name, SUBSCRIPTION_PLANS["sandbox"])


def get_all_subscription_plans() -> dict:
    """Get all available subscription plans."""
    return SUBSCRIPTION_PLANS

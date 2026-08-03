"""
Credit service for managing user credits based on subscription tiers.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Any
from botocore.exceptions import ClientError
from fastapi import HTTPException
from app.config.stripe_config import get_subscription_plan
from app.models.stripe_models import CreditUsage, SubscriptionTier
from utils.dynamodb.repos import credits as credits_repo

logger = logging.getLogger(__name__)

MONTHLY_CREDIT_LIMIT = 1000
MODEL_COSTS = {"pro": 10, "fast": 5}


class CreditService:
    """Service class for managing user credits."""

    def __init__(self):
        """Initialize credit service."""
        pass

    def get_credits_remaining(self, user_id: str) -> int:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        used = credits_repo.get_credits_used(user_id, month)
        return max(0, MONTHLY_CREDIT_LIMIT - used)

    def consume_credits(self, user_id: str, amount: int) -> dict:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        try:
            new_total = credits_repo.add_credits_atomic(
                user_id, month, amount, MONTHLY_CREDIT_LIMIT
            )
            return {
                "credits_remaining": MONTHLY_CREDIT_LIMIT - new_total,
                "credits_used": amount,
            }
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                remaining = self.get_credits_remaining(user_id)
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "insufficient_credits",
                        "credits_remaining": remaining,
                    },
                )
            raise

    def get_model_cost(self, model: str) -> int:
        return MODEL_COSTS.get(model, MODEL_COSTS["fast"])

    def get_credit_usage(
        self, user_id: str, subscription_tier: SubscriptionTier
    ) -> CreditUsage:
        """Get current credit usage for a user."""
        try:
            plan = get_subscription_plan(subscription_tier.value)
            monthly_credits_used = credits_repo.get_credits_used(
                user_id, datetime.now(timezone.utc).strftime("%Y-%m")
            )
            monthly_limit = plan["monthly_credits"]
            can_use_credits = (
                monthly_limit == -1
                or monthly_credits_used < monthly_limit
            )
            return CreditUsage(
                user_id=user_id,
                subscription_tier=subscription_tier,
                monthly_credits_used=monthly_credits_used,
                monthly_credits_limit=monthly_limit,
                last_reset_date=datetime.now(timezone.utc),
                can_use_credits=can_use_credits,
            )
        except Exception as e:
            logger.error(f"Error getting credit usage for user {user_id}: {str(e)}")
            return self._get_default_usage(user_id)

    def get_credit_limits(self, subscription_tier: SubscriptionTier) -> Dict[str, Any]:
        """Get credit limits for a subscription tier."""
        plan = get_subscription_plan(subscription_tier.value)
        return {
            "monthly_credits": plan["monthly_credits"],
            "data_retention_days": plan["data_retention_days"],
            "features": plan["features"],
        }

    def _get_default_usage(self, user_id: str) -> CreditUsage:
        plan = get_subscription_plan("pro")
        return CreditUsage(
            user_id=user_id,
            subscription_tier=SubscriptionTier.PRO,
            monthly_credits_used=0,
            monthly_credits_limit=plan["monthly_credits"],
            last_reset_date=datetime.now(timezone.utc),
            can_use_credits=True,
        )

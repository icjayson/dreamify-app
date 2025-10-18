"""
Credit service for managing user credits based on subscription tiers.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from app.config.stripe_config import get_subscription_plan, SUBSCRIPTION_PLANS
from app.models.stripe_models import CreditUsage, ConsumeCreditRequest, ConsumeCreditResponse, SubscriptionTier

logger = logging.getLogger(__name__)


class CreditService:
    """Service class for managing user credits."""
    
    def __init__(self):
        """Initialize credit service."""
        # TODO: Initialize database connection for credit tracking
        pass
    
    def get_credit_usage(self, user_id: str, subscription_tier: SubscriptionTier) -> CreditUsage:
        """Get current credit usage for a user."""
        try:
            plan = get_subscription_plan(subscription_tier.value)
            
            # TODO: Get actual usage from database
            # For now, return mock data
            daily_credits_used = self._get_daily_credits_used(user_id)
            monthly_credits_used = self._get_monthly_credits_used(user_id)
            
            daily_limit = plan['daily_credits']
            monthly_limit = plan['monthly_credits']
            
            # Check if user can use credits
            can_use_credits = self._can_use_credits(
                daily_credits_used, daily_limit,
                monthly_credits_used, monthly_limit
            )
            
            return CreditUsage(
                user_id=user_id,
                subscription_tier=subscription_tier,
                daily_credits_used=daily_credits_used,
                monthly_credits_used=monthly_credits_used,
                daily_credits_limit=daily_limit,
                monthly_credits_limit=monthly_limit,
                last_reset_date=datetime.now(),
                can_use_credits=can_use_credits
            )
            
        except Exception as e:
            logger.error(f"Error getting credit usage for user {user_id}: {str(e)}")
            # Return default sandbox plan on error
            return self._get_default_usage(user_id)
    
    def consume_credits(self, request: ConsumeCreditRequest) -> ConsumeCreditResponse:
        """Consume credits for a user action."""
        try:
            # Get current usage
            usage = self.get_credit_usage(request.user_id, SubscriptionTier.SANDBOX)  # TODO: Get actual tier
            
            # Check if user can consume credits
            if not usage.can_use_credits:
                return ConsumeCreditResponse(
                    success=False,
                    error="Daily credit limit reached"
                )
            
            # Check if enough credits available
            if usage.daily_credits_used + request.credits_required > usage.daily_credits_limit:
                return ConsumeCreditResponse(
                    success=False,
                    error="Insufficient credits available"
                )
            
            # TODO: Update database with credit consumption
            self._record_credit_usage(
                request.user_id,
                request.action,
                request.credits_required
            )
            
            # Calculate remaining credits
            remaining_credits = usage.daily_credits_limit - (usage.daily_credits_used + request.credits_required)
            
            return ConsumeCreditResponse(
                success=True,
                credits_consumed=request.credits_required,
                remaining_credits=remaining_credits
            )
            
        except Exception as e:
            logger.error(f"Error consuming credits for user {request.user_id}: {str(e)}")
            return ConsumeCreditResponse(
                success=False,
                error="Internal server error"
            )
    
    def reset_daily_credits(self, user_id: str) -> bool:
        """Reset daily credits for a user."""
        try:
            # TODO: Implement daily credit reset in database
            logger.info(f"Resetting daily credits for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Error resetting daily credits for user {user_id}: {str(e)}")
            return False
    
    def reset_monthly_credits(self, user_id: str) -> bool:
        """Reset monthly credits for a user."""
        try:
            # TODO: Implement monthly credit reset in database
            logger.info(f"Resetting monthly credits for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Error resetting monthly credits for user {user_id}: {str(e)}")
            return False
    
    def _get_daily_credits_used(self, user_id: str) -> int:
        """Get daily credits used by user."""
        # TODO: Query database for actual usage
        return 0
    
    def _get_monthly_credits_used(self, user_id: str) -> int:
        """Get monthly credits used by user."""
        # TODO: Query database for actual usage
        return 0
    
    def _can_use_credits(self, daily_used: int, daily_limit: int, 
                        monthly_used: int, monthly_limit: int) -> bool:
        """Check if user can use credits."""
        # Unlimited credits for enterprise
        if daily_limit == -1 or monthly_limit == -1:
            return True
        
        # Check daily and monthly limits
        return daily_used < daily_limit and monthly_used < monthly_limit
    
    def _get_default_usage(self, user_id: str) -> CreditUsage:
        """Get default credit usage (sandbox plan)."""
        plan = get_subscription_plan('sandbox')
        return CreditUsage(
            user_id=user_id,
            subscription_tier=SubscriptionTier.SANDBOX,
            daily_credits_used=0,
            monthly_credits_used=0,
            daily_credits_limit=plan['daily_credits'],
            monthly_credits_limit=plan['monthly_credits'],
            last_reset_date=datetime.now(),
            can_use_credits=True
        )
    
    def _record_credit_usage(self, user_id: str, action: str, credits_used: int):
        """Record credit usage in database."""
        # TODO: Implement database recording
        logger.info(f"User {user_id} used {credits_used} credits for action: {action}")
    
    def get_credit_limits(self, subscription_tier: SubscriptionTier) -> Dict[str, Any]:
        """Get credit limits for a subscription tier."""
        plan = get_subscription_plan(subscription_tier.value)
        return {
            'daily_credits': plan['daily_credits'],
            'monthly_credits': plan['monthly_credits'],
            'data_retention_days': plan['data_retention_days'],
            'features': plan['features']
        }
    
    def check_feature_access(self, user_id: str, feature: str) -> bool:
        """Check if user has access to a specific feature based on subscription."""
        try:
            # TODO: Get user's actual subscription tier from database
            subscription_tier = SubscriptionTier.SANDBOX  # Default to sandbox
            
            plan = get_subscription_plan(subscription_tier.value)
            
            # Check feature access based on subscription tier
            if subscription_tier == SubscriptionTier.SANDBOX:
                # Sandbox users have limited access
                return feature in ['basic_analytics', 'data_upload']
            elif subscription_tier == SubscriptionTier.PRO:
                # Pro users have most features
                return feature in ['basic_analytics', 'data_upload', 'custom_domains', 'remove_branding']
            elif subscription_tier == SubscriptionTier.ENTERPRISE:
                # Enterprise users have all features
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking feature access for user {user_id}: {str(e)}")
            return False

"""
EventBridge Scheduler wrapper for Dreamify sync schedules.

Each sync schedule maps to one AWS EventBridge Scheduler schedule that calls
the internal trigger endpoint over HTTPS with a shared secret.
"""
import json
import logging
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from utils.config import config

logger = logging.getLogger(__name__)

_FLEXIBLE_WINDOW_MINUTES = 10  # allow up to 10-min delivery window


def _schedule_group() -> str:
    return config.scheduler.SCHEDULE_GROUP or "dreamify-sync-schedules"


def is_scheduler_configured() -> bool:
    """Return whether production automatic schedule delivery can be created."""
    return bool(config.scheduler.EVENTBRIDGE_ROLE_ARN and config.scheduler.TARGET_LAMBDA_ARN)


def _get_client():
    return boto3.client(
        "scheduler",
        region_name=config.aws.access_key.AWS_DEFAULT_REGION,
        aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
    )


def _ensure_group() -> None:
    """Create the schedule group if it doesn't exist."""
    client = _get_client()
    try:
        client.get_schedule_group(Name=_schedule_group())
    except client.exceptions.ResourceNotFoundException:
        try:
            client.create_schedule_group(Name=_schedule_group())
            logger.info("Created EventBridge schedule group: %s", _schedule_group())
        except ClientError as exc:
            # Another process may have created it concurrently
            if exc.response["Error"]["Code"] != "ConflictException":
                raise


def _build_cron_expression(frequency: str, hour_utc: int, day_of_week: int) -> str:
    """
    Build an EventBridge cron() or rate() expression.

    EventBridge cron format: cron(minutes hours day-of-month month day-of-week year)
    Day-of-week: 1=Sun, 2=Mon, ..., 7=Sat (1-based, not 0-based like Python)
    """
    if frequency == "daily":
        return f"cron(0 {hour_utc} * * ? *)"
    elif frequency == "weekly":
        # EventBridge DOW is 1=Sun..7=Sat; input is 0=Mon..6=Sun
        eb_dow = (day_of_week + 2) % 7 or 7  # 0(Mon)->2, 6(Sun)->1
        return f"cron(0 {hour_utc} ? * {eb_dow} *)"
    elif frequency == "biweekly":
        # rate(14 days) anchored from schedule creation time
        return "rate(14 days)"
    else:
        raise ValueError(f"Unknown frequency: {frequency}")


def _build_target(schedule_id: str) -> dict:
    """Build a universal target that invokes the Lambda bridge for one schedule."""
    if not is_scheduler_configured():
        raise RuntimeError("EventBridge Scheduler is missing EVENTBRIDGE_ROLE_ARN or TARGET_LAMBDA_ARN")

    return {
        "Arn": "arn:aws:scheduler:::aws-sdk:lambda:invoke",
        "RoleArn": config.scheduler.EVENTBRIDGE_ROLE_ARN,
        "Input": json.dumps({
            "FunctionName": config.scheduler.TARGET_LAMBDA_ARN,
            "InvocationType": "Event",
            "Payload": json.dumps({"schedule_id": schedule_id}),
        }),
    }


def create_schedule(
    schedule_id: str,
    frequency: str,
    hour_utc: int,
    day_of_week: int,
) -> str:
    """
    Create an EventBridge Scheduler schedule.
    Returns the schedule name (used for future updates/deletes).

    Raises RuntimeError when scheduler delivery is not configured.
    """
    if not is_scheduler_configured():
        raise RuntimeError("EventBridge Scheduler is not configured")

    _ensure_group()
    client = _get_client()
    name = f"dreamify-sync-{schedule_id}"
    cron_expr = _build_cron_expression(frequency, hour_utc, day_of_week)

    client.create_schedule(
        Name=name,
        GroupName=_schedule_group(),
        ScheduleExpression=cron_expr,
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "FLEXIBLE", "MaximumWindowInMinutes": _FLEXIBLE_WINDOW_MINUTES},
        Target=_build_target(schedule_id),
        State="ENABLED",
        Description=f"Dreamify data sync schedule {schedule_id}",
    )
    logger.info("Created EventBridge schedule: %s (%s)", name, cron_expr)
    return name


def update_schedule(
    rule_name: str,
    schedule_id: str,
    frequency: str,
    hour_utc: int,
    day_of_week: int,
) -> None:
    """Update the cron expression on an existing EventBridge schedule."""
    if not is_scheduler_configured():
        raise RuntimeError("EventBridge Scheduler is not configured")

    client = _get_client()
    cron_expr = _build_cron_expression(frequency, hour_utc, day_of_week)
    existing = client.get_schedule(Name=rule_name, GroupName=_schedule_group())

    client.update_schedule(
        Name=rule_name,
        GroupName=_schedule_group(),
        ScheduleExpression=cron_expr,
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "FLEXIBLE", "MaximumWindowInMinutes": _FLEXIBLE_WINDOW_MINUTES},
        Target=existing["Target"],
        State=existing["State"],
    )
    logger.info("Updated EventBridge schedule: %s -> %s", rule_name, cron_expr)


def pause_schedule(rule_name: str) -> None:
    """Disable an EventBridge schedule (paused state)."""
    if not is_scheduler_configured():
        raise RuntimeError("EventBridge Scheduler is not configured")
    client = _get_client()
    existing = client.get_schedule(Name=rule_name, GroupName=_schedule_group())
    client.update_schedule(
        Name=rule_name,
        GroupName=_schedule_group(),
        ScheduleExpression=existing["ScheduleExpression"],
        ScheduleExpressionTimezone=existing.get("ScheduleExpressionTimezone", "UTC"),
        FlexibleTimeWindow=existing["FlexibleTimeWindow"],
        Target=existing["Target"],
        State="DISABLED",
    )
    logger.info("Paused EventBridge schedule: %s", rule_name)


def resume_schedule(rule_name: str) -> None:
    """Re-enable a disabled EventBridge schedule."""
    if not is_scheduler_configured():
        raise RuntimeError("EventBridge Scheduler is not configured")
    client = _get_client()
    existing = client.get_schedule(Name=rule_name, GroupName=_schedule_group())
    client.update_schedule(
        Name=rule_name,
        GroupName=_schedule_group(),
        ScheduleExpression=existing["ScheduleExpression"],
        ScheduleExpressionTimezone=existing.get("ScheduleExpressionTimezone", "UTC"),
        FlexibleTimeWindow=existing["FlexibleTimeWindow"],
        Target=existing["Target"],
        State="ENABLED",
    )
    logger.info("Resumed EventBridge schedule: %s", rule_name)


def delete_schedule(rule_name: str) -> None:
    """Delete an EventBridge schedule."""
    if not is_scheduler_configured():
        raise RuntimeError("EventBridge Scheduler is not configured")
    client = _get_client()
    try:
        client.delete_schedule(Name=rule_name, GroupName=_schedule_group())
        logger.info("Deleted EventBridge schedule: %s", rule_name)
    except client.exceptions.ResourceNotFoundException:
        logger.warning("EventBridge schedule not found (already deleted?): %s", rule_name)

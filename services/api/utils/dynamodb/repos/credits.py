"""
DynamoDB repository for credit usage entities.
"""

from typing import Optional

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


def get_credits_used(user_id: str, date: str) -> int:
    table = get_table(tables.credits)
    resp = table.get_item(Key={"user_id": user_id, "date": date})
    item = resp.get("Item", {})
    return int(item.get("credits_used", 0))


def add_credits_atomic(user_id: str, date: str, amount: int, limit: int) -> int:
    table = get_table(tables.credits)
    max_allowed = limit - amount
    resp = table.update_item(
        Key={"user_id": user_id, "date": date},
        UpdateExpression="ADD credits_used :amount",
        ConditionExpression="attribute_not_exists(credits_used) OR credits_used <= :max_allowed",
        ExpressionAttributeValues={
            ":amount": amount,
            ":max_allowed": max_allowed,
        },
        ReturnValues="UPDATED_NEW",
    )
    return int(resp["Attributes"]["credits_used"])

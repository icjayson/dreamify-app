import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.api.route_modules import user as user_routes
from app.api.route_modules.user import OverallFeedbackRequest, _format_overall_feedback_message


def test_overall_feedback_message_contains_all_answers():
    request = OverallFeedbackRequest(
        full_name="Ada Lovelace",
        email="ada@example.com",
        overall_rating=5,
        visual_appeal_rating=4,
        metrics_insights_rating=3,
        layout_editing_rating=4,
        share_link_rating=5,
        requested_connectors="HubSpot",
        dashboard_improvements="More filters",
        export_improvements="Scheduled PDF",
    )

    message = _format_overall_feedback_message(request, "user_123")

    assert "Overall Dreamify dashboard: 5/5" in message
    assert "HubSpot" in message
    assert "More filters" in message
    assert "Scheduled PDF" in message
    assert "Authenticated user ID: user_123" in message


def test_overall_feedback_requires_every_answer():
    with pytest.raises(ValidationError):
        OverallFeedbackRequest(
            full_name="Guest",
            email="guest@example.com",
            overall_rating=3,
            visual_appeal_rating=3,
            metrics_insights_rating=3,
            layout_editing_rating=3,
            share_link_rating=3,
        )


def test_overall_feedback_uses_feedback_resend_key():
    request = OverallFeedbackRequest(
        full_name="Guest User",
        email="guest@example.com",
        overall_rating=5,
        visual_appeal_rating=4,
        metrics_insights_rating=4,
        layout_editing_rating=3,
        share_link_rating=5,
        requested_connectors="HubSpot",
        dashboard_improvements="More filters",
        export_improvements="Scheduled PDF",
    )
    resend_config = SimpleNamespace(
        feedback_api_key="feedback-key",
        api_key="general-key",
        feedback_email="feedback@dreamify.dev",
        from_email="Dreamify <noreply@dreamify.dev>",
    )

    with (
        patch.object(user_routes.config, "resend", resend_config),
        patch.object(user_routes, "send_feedback_email", return_value=True) as send_feedback,
        patch.object(user_routes, "send_feedback_thank_you_email", return_value=True),
    ):
        response = asyncio.run(user_routes.submit_overall_feedback(request, user_id=None))

    assert response == {"success": True}
    assert send_feedback.call_args.kwargs["api_key"] == "feedback-key"
    assert send_feedback.call_args.kwargs["user_email"] == "guest@example.com"

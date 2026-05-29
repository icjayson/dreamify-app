"""
Email sending utilities via Resend.
"""

import logging
from typing import Optional
import resend as _resend

logger = logging.getLogger(__name__)


def send_dashboard_share_email(
    *,
    to_email: str,
    to_name: Optional[str],
    sharer_name: str,
    project_id: str,
    app_url: str,
    from_email: str,
    api_key: str,
) -> bool:
    """
    Send a share notification email to a newly invited user.
    Returns True on success, False on failure (non-fatal — caller should log but not raise).
    """
    logger.info("[email] Attempting to send share invite to %s", to_email)
    try:
        _resend.api_key = api_key

        base = app_url.rstrip("/")
        preview_url = f"{base}/workspace/project/preview?projectId={project_id}"
        logo_url = "https://app.dreamify.dev/logo-full-horizon-dark.png"
        icon_url = "https://app.dreamify.dev/logo-main.png"
        recipient_greeting = f"Hi {to_name}," if to_name else "Hi there,"
        logger.info("[email] preview_url=%s from=%s", preview_url, from_email)

        html_body = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>Dashboard shared with you</title>
  <style>
    :root {{ color-scheme: light only; }}
    @media (prefers-color-scheme: dark) {{
      body, table, td {{ background-color: #f1f5f9 !important; color: #334155 !important; }}
    }}
  </style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <!-- Outer card -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 24px rgba(0,0,0,0.04);">

          <!-- Logo bar -->
          <tr>
            <td style="padding:28px 36px 20px;" align="left">
              <img src="{logo_url}" alt="Dreamify" width="130" style="display:block;height:auto;border:0;" />
            </td>
          </tr>

          <!-- Hero section -->
          <tr>
            <td style="padding:0 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#eef2ff 0%,#e0e7ff 50%,#ede9fe 100%);border-radius:16px;overflow:hidden;">
                <tr>
                  <td style="padding:32px 28px;" align="center">
                    <img src="{icon_url}" alt="" width="72" style="display:block;height:auto;border:0;margin:0 auto;" />
                    <p style="margin:16px 0 0;font-size:20px;font-weight:700;color:#1e293b;letter-spacing:-0.3px;">
                      Dashboard Shared
                    </p>
                    <p style="margin:8px 0 0;font-size:14px;color:#6366f1;line-height:1;">
                      You have a new dashboard to explore
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Message body -->
          <tr>
            <td style="padding:28px 36px 0;">
              <p style="margin:0 0 12px;font-size:15px;color:#64748b;">{recipient_greeting}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
                <strong style="color:#1e293b;">{sharer_name}</strong> has shared a dashboard with you on Dreamify. Click below to view the insights.
              </p>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td style="padding:0 36px 28px;" align="left">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);mso-padding-alt:0;">
                    <a href="{preview_url}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;line-height:1;"
                       target="_blank">
                      View Dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background:#e2e8f0;"></div>
            </td>
          </tr>

          <!-- Help text -->
          <tr>
            <td style="padding:20px 36px;">
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">
                Sign in with <strong style="color:#334155;">{to_email}</strong> to access it.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background:#e2e8f0;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px 28px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                You received this email because
                <span style="color:#64748b;">{sharer_name}</span>
                shared a dashboard with you on
                <a href="https://dreamify.dev" style="color:#6366f1;text-decoration:none;">Dreamify</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""

        result = _resend.Emails.send({
            "from": from_email,
            "to": [to_email],
            "subject": f"{sharer_name} shared a dashboard with you on Dreamify",
            "html": html_body,
        })
        email_id = result.get("id") if isinstance(result, dict) else getattr(result, "id", None)
        logger.info("[email] ✓ Sent to %s — resend_id=%s", to_email, email_id)
        return True

    except Exception as e:
        logger.error("[email] ✗ Failed to send to %s: %s: %s", to_email, type(e).__name__, e)
        return False

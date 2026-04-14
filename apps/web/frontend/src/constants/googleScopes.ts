/**
 * Google OAuth scopes required by each connector.
 *
 * These are requested **incrementally** via Clerk's `reauthorize()` — only when
 * the user actually opens a specific connector modal, NOT at sign-in time.
 *
 * The Clerk Dashboard should only have base scopes: openid, email, profile.
 */

export const GOOGLE_CONNECTOR_SCOPES: Record<string, string[]> = {
  GA4: [
    'https://www.googleapis.com/auth/analytics.readonly',
  ],
  'Google Sheets': [
    'https://www.googleapis.com/auth/drive.file',
  ],
  'Google Ads': [
    'https://www.googleapis.com/auth/adwords',
  ],
  Firebase: [
    'https://www.googleapis.com/auth/firebase.readonly',
  ],
} as const;

/** Flat list of all connector-specific scopes (useful for checking what's approved) */
export const ALL_GOOGLE_CONNECTOR_SCOPES = Object.values(GOOGLE_CONNECTOR_SCOPES).flat();

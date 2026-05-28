/**
 * Meta Pixel (Facebook Pixel) integration hook for Dreamify.
 *
 * The base pixel code (init + initial PageView) is loaded in index.html.
 * This hook handles SPA route-change tracking and provides helpers for
 * firing standard / custom events from anywhere in the app.
 *
 * Usage:
 *   import { useMetaPixel, MetaPixel } from '@/hooks/useMetaPixel';
 *
 *   // In AppContent — auto-tracks PageView on every route change:
 *   useMetaPixel();
 *
 *   // Fire standard events anywhere:
 *   MetaPixel.track('Lead');
 *   MetaPixel.track('Purchase', { value: 29.99, currency: 'USD' });
 *
 *   // Fire custom events:
 *   MetaPixel.trackCustom('UpgradePlan', { plan: 'pro' });
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Extend Window to include fbq
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    fbq: ((...args: unknown[]) => void) & {
      callMethod?: (...args: unknown[]) => void;
      queue: unknown[];
      loaded: boolean;
      version: string;
      push: (...args: unknown[]) => void;
    };
    _fbq: typeof window.fbq;
  }
}

// ---------------------------------------------------------------------------
// Check if fbq is available (loaded from index.html)
// ---------------------------------------------------------------------------
function isFbqReady(): boolean {
  return typeof window !== 'undefined' && typeof window.fbq === 'function';
}

// ---------------------------------------------------------------------------
// Public helpers — safe to call even if pixel hasn't loaded yet
// ---------------------------------------------------------------------------
export const MetaPixel = {
  /**
   * Fire a standard Meta Pixel event.
   * @see https://developers.facebook.com/docs/meta-pixel/reference#standard-events
   */
  track(event: string, params?: Record<string, unknown>): void {
    if (!isFbqReady()) return;
    if (params) {
      window.fbq('track', event, params);
    } else {
      window.fbq('track', event);
    }
  },

  /**
   * Fire a custom (non-standard) Meta Pixel event.
   */
  trackCustom(event: string, params?: Record<string, unknown>): void {
    if (!isFbqReady()) return;
    if (params) {
      window.fbq('trackCustom', event, params);
    } else {
      window.fbq('trackCustom', event);
    }
  },
};

// ---------------------------------------------------------------------------
// React Hook — sends PageView on every SPA route change
// (The initial PageView is already fired in index.html)
// ---------------------------------------------------------------------------
export function useMetaPixel(): void {
  const location = useLocation();

  useEffect(() => {
    if (!isFbqReady()) return;
    // Track page views on SPA route changes
    window.fbq('track', 'PageView');
  }, [location.pathname, location.search]);
}

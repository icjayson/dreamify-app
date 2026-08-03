import html2canvas from 'html2canvas';

/**
 * Captures a thumbnail of the dashboard preview element.
 * Returns a base64 data URL of the thumbnail image.
 */
export async function captureDashboardThumbnail(
  width = 600,
  height = 360
): Promise<string | null> {
  const dashboardRoot = document.querySelector('[data-dashboard-root]') as HTMLElement | null;
  if (!dashboardRoot) return null;

  try {
    const canvas = await html2canvas(dashboardRoot, {
      width: dashboardRoot.scrollWidth,
      height: Math.min(dashboardRoot.scrollHeight, 900),
      scale: 0.5,
      useCORS: true,
      logging: false,
      backgroundColor: null,
      windowWidth: dashboardRoot.scrollWidth,
      windowHeight: Math.min(dashboardRoot.scrollHeight, 900),
    });

    // Resize to thumbnail dimensions
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = width;
    thumbCanvas.height = height;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return null;

    // Draw the captured canvas scaled down to thumbnail size
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height);

    return thumbCanvas.toDataURL('image/jpeg', 0.7);
  } catch (error) {
    console.warn('Failed to capture dashboard thumbnail:', error);
    return null;
  }
}

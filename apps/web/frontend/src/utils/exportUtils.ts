
// Simple PDF export function that captures the original dashboard directly
export async function exportDashboardAsPdf() {
  // Wait for the hidden container to appear in the DOM
  let dashboardEl = document.getElementById('dashboard-export-root');
  let retries = 0;
  while (!dashboardEl && retries < 20) {
    await new Promise(r => setTimeout(r, 100));
    dashboardEl = document.getElementById('dashboard-export-root');
    retries++;
  }

  // Fallback if the export wrapper absolutely failed to mount
  if (!dashboardEl) {
    console.warn('Export root not found, falling back to live preview');
    dashboardEl = document.getElementById('dashboard-preview-root');
  }

  if (!dashboardEl) {
    console.error('Dashboard preview root not found');
    return;
  }

  console.log('Dashboard element found:', dashboardEl);
  console.log('Dashboard dimensions:', {
    width: dashboardEl.scrollWidth,
    height: dashboardEl.scrollHeight,
    offsetWidth: dashboardEl.offsetWidth,
    offsetHeight: dashboardEl.offsetHeight
  });

  const scrollWidth = dashboardEl.scrollWidth;
  const scrollHeight = dashboardEl.scrollHeight;

  // Wait for React-Grid-Layout and Recharts to settle animation
  // Force a window resize event to trigger ResponsiveContainer to measure the new DOM
  window.dispatchEvent(new Event('resize'));

  await new Promise(resolve => setTimeout(resolve, 1500));

  // Dispatch a second time just in case layout shifted
  window.dispatchEvent(new Event('resize'));

  await new Promise(resolve => setTimeout(resolve, 1500));

  // Use html2canvas directly with the original dashboard
  const html2canvas = (await import('html2canvas')).default;
  const jsPDF = (await import('jspdf')).default;

  console.log('Starting html2canvas capture...');

  const bgColor = window.getComputedStyle(dashboardEl).backgroundColor;
  const finalBgColor = bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent' ? '#ffffff' : bgColor;

  const canvas = await html2canvas(dashboardEl, {
    scale: 2, // slightly higher scale for better quality
    backgroundColor: finalBgColor,
    useCORS: true,
    logging: false, // turn off logging for production
    allowTaint: true,
    foreignObjectRendering: true,
    width: scrollWidth,
    height: scrollHeight,
    windowWidth: scrollWidth,
    windowHeight: scrollHeight,
    x: 0,
    y: 0,
    scrollX: 0,
    scrollY: 0,
    onclone: (clonedDoc) => {
      const el = clonedDoc.getElementById('dashboard-export-root') || clonedDoc.getElementById('dashboard-preview-root');
      if (el) {
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = scrollWidth + 'px';
        el.style.height = scrollHeight + 'px';
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        el.style.transform = 'none';
      }
    }
  });

  console.log('Canvas created:', {
    width: canvas.width,
    height: canvas.height
  });

  if (canvas.width === 0 || canvas.height === 0) {
    console.error('Canvas is empty - no content captured');
    return;
  }

  // Create PDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 0;
  const usableWidth = pageWidth - (margin * 2);
  const usableHeight = pageHeight - (margin * 2);

  // Calculate image dimensions to fit the page
  const imgWidth = usableWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  console.log('PDF dimensions:', {
    pageWidth,
    pageHeight,
    imgWidth,
    imgHeight
  });

  // If image fits on one page, add it directly
  if (imgHeight <= usableHeight) {
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imgWidth, imgHeight);
  } else {
    // If image is too tall, scale it down to fit
    const scaledHeight = usableHeight;
    const scaledWidth = (canvas.width * scaledHeight) / canvas.height;
    const xOffset = (pageWidth - scaledWidth) / 2;

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', xOffset, margin, scaledWidth, scaledHeight);
  }

  console.log('Saving PDF...');
  pdf.save(`dashboard-${new Date().toISOString().slice(0, 10)}.pdf`);
  console.log('PDF saved successfully');
}

export async function exportChartAsPng(element: HTMLElement, title: string): Promise<void> {
  const menuBtn = element.querySelector<HTMLElement>('.dashboard-card-menu-trigger');
  if (menuBtn) menuBtn.style.visibility = 'hidden';

  // Allow SVGs to paint beyond their viewport so rotated labels aren't clipped
  type SvgRestore = { el: SVGSVGElement; overflow: string };
  const svgRestoreList: SvgRestore[] = [];
  element.querySelectorAll<SVGSVGElement>('svg.recharts-surface').forEach((svg) => {
    svgRestoreList.push({ el: svg, overflow: svg.style.overflow });
    svg.style.overflow = 'visible';
  });

  // Rotate X-axis tick labels -35° around their own anchor point.
  // Each Recharts tick <text> uses x/y attributes as its position;
  // rotating around (x, y) keeps the label anchored to its tick mark.
  type TickRestore = { el: SVGTextElement; transform: string | null; anchor: string | null };
  const tickRestoreList: TickRestore[] = [];
  element.querySelectorAll<SVGTextElement>('.recharts-xAxis .recharts-cartesian-axis-tick text').forEach((text) => {
    const x = text.getAttribute('x') || '0';
    const y = text.getAttribute('y') || '0';
    tickRestoreList.push({ el: text, transform: text.getAttribute('transform'), anchor: text.getAttribute('text-anchor') });
    text.setAttribute('transform', `rotate(-35, ${x}, ${y})`);
    text.setAttribute('text-anchor', 'end');
  });

  try {
    // Short wait for any pending paint — do NOT dispatch resize events as they
    // trigger Recharts ResponsiveContainer to re-render and reload the chart.
    await new Promise(r => setTimeout(r, 200));

    const { toPng } = await import('html-to-image');

    // Pass extra height and bottom padding via html-to-image's clone options so
    // the rotated labels have room without touching the live DOM layout.
    const extraBottom = tickRestoreList.length > 0 ? 48 : 0;

    const dataUrl = await toPng(element, {
      pixelRatio: 2,
      skipFonts: false,
      height: element.offsetHeight + extraBottom,
      style: { paddingBottom: `${extraBottom}px`, overflow: 'visible' },
      filter: (node) => {
        if (node instanceof HTMLElement) {
          if (node.classList.contains('dashboard-card-menu-trigger')) return false;
          if (node.hasAttribute('data-export-exclude')) return false;
        }
        return true;
      },
    });

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const link = document.createElement('a');
    link.download = `chart-${slug}-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = dataUrl;
    link.click();
  } finally {
    for (const { el, overflow } of svgRestoreList) {
      el.style.overflow = overflow;
    }
    for (const { el, transform, anchor } of tickRestoreList) {
      if (transform !== null) el.setAttribute('transform', transform);
      else el.removeAttribute('transform');
      if (anchor !== null) el.setAttribute('text-anchor', anchor);
      else el.removeAttribute('text-anchor');
    }
    if (menuBtn) menuBtn.style.visibility = '';
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportDashboardAsPng() {
  // Wait for the hidden container to appear in the DOM
  let dashboardEl = document.getElementById('dashboard-export-root');
  let retries = 0;
  while (!dashboardEl && retries < 20) {
    await new Promise(r => setTimeout(r, 100));
    dashboardEl = document.getElementById('dashboard-export-root');
    retries++;
  }

  // Fallback if the export wrapper absolutely failed to mount
  if (!dashboardEl) {
    console.warn('Export root not found, falling back to live preview');
    dashboardEl = document.getElementById('dashboard-preview-root');
  }

  if (!dashboardEl) {
    console.error('Dashboard preview root not found');
    return;
  }

  console.log('Dashboard element found:', dashboardEl);

  const scrollWidth = dashboardEl.scrollWidth;
  const scrollHeight = dashboardEl.scrollHeight;

  // Wait for React-Grid-Layout and Recharts to settle animation
  // Force a window resize event to trigger ResponsiveContainer to measure the new DOM
  window.dispatchEvent(new Event('resize'));

  await new Promise(resolve => setTimeout(resolve, 1500));

  window.dispatchEvent(new Event('resize'));

  await new Promise(resolve => setTimeout(resolve, 1500));

  const html2canvas = (await import('html2canvas')).default;

  console.log('Starting html2canvas capture for PNG...');

  const bgColor = window.getComputedStyle(dashboardEl).backgroundColor;
  const finalBgColor = bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent' ? '#ffffff' : bgColor;

  const canvas = await html2canvas(dashboardEl, {
    scale: 2,
    backgroundColor: finalBgColor,
    useCORS: true,
    logging: false,
    allowTaint: true,
    foreignObjectRendering: true,
    width: scrollWidth,
    height: scrollHeight,
    windowWidth: scrollWidth,
    windowHeight: scrollHeight,
    x: 0,
    y: 0,
    scrollX: 0,
    scrollY: 0,
    onclone: (clonedDoc) => {
      const el = clonedDoc.getElementById('dashboard-export-root') || clonedDoc.getElementById('dashboard-preview-root');
      if (el) {
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = scrollWidth + 'px';
        el.style.height = scrollHeight + 'px';
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        el.style.transform = 'none';
      }
    }
  });

  if (canvas.width === 0 || canvas.height === 0) {
    console.error('Canvas is empty - no content captured');
    return;
  }

  console.log('Saving PNG...');
  const link = document.createElement('a');
  link.download = `dashboard-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  console.log('PNG saved successfully');
}

/**
 * Capture the live dashboard as a WebP Blob WITHOUT downloading it.
 * Used for auto-generating dashboard preview thumbnails.
 *
 * @param elementId - ID of the dashboard root element (defaults to 'dashboard-preview-root')
 * @returns WebP Blob or null if capture failed
 */
export async function captureDashboardAsWebpBlob(
  elementId: string = 'dashboard-preview-root',
): Promise<Blob | null> {
  const dashboardEl = document.getElementById(elementId);
  if (!dashboardEl) {
    console.warn(`captureDashboardAsPngBlob: element #${elementId} not found`);
    return null;
  }

  const scrollWidth = dashboardEl.scrollWidth;
  const scrollHeight = dashboardEl.scrollHeight;

  if (scrollWidth === 0 || scrollHeight === 0) {
    console.warn('captureDashboardAsWebpBlob: element has no dimensions');
    return null;
  }

  // Allow charts to finish rendering
  window.dispatchEvent(new Event('resize'));
  await new Promise(resolve => setTimeout(resolve, 1500));
  window.dispatchEvent(new Event('resize'));
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    const html2canvas = (await import('html2canvas')).default;

    const bgColor = window.getComputedStyle(dashboardEl).backgroundColor;
    const finalBgColor =
      bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent' ? '#0a0a0f' : bgColor;

    const canvas = await html2canvas(dashboardEl, {
      scale: 1.5,  // Slightly lower than export (2x) for smaller file size
      backgroundColor: finalBgColor,
      useCORS: true,
      logging: false,
      allowTaint: true,
      foreignObjectRendering: true,
      width: scrollWidth,
      height: scrollHeight,
      windowWidth: scrollWidth,
      windowHeight: scrollHeight,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDoc) => {
        const el = clonedDoc.getElementById(elementId);
        if (el) {
          el.style.position = 'fixed';
          el.style.top = '0';
          el.style.left = '0';
          el.style.width = scrollWidth + 'px';
          el.style.height = scrollHeight + 'px';
          el.style.overflow = 'visible';
          el.style.maxHeight = 'none';
          el.style.transform = 'none';
        }
      },
    });

    if (canvas.width === 0 || canvas.height === 0) {
      console.warn('captureDashboardAsWebpBlob: captured canvas is empty');
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        'image/webp',
        0.5,
      );
    });
  } catch (error) {
    console.warn('captureDashboardAsWebpBlob: capture failed:', error);
    return null;
  }
}

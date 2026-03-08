
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

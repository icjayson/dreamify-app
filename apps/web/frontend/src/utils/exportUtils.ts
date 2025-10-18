
// Simple PDF export function that captures the original dashboard directly
export async function exportDashboardAsPdf() {
  const dashboardEl = document.getElementById('dashboard-preview-root');
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

  // Wait for any pending renders
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Use html2canvas directly with the original dashboard
  const html2canvas = (await import('html2canvas')).default;
  const jsPDF = (await import('jspdf')).default;
  
  console.log('Starting html2canvas capture...');
  
  const canvas = await html2canvas(dashboardEl, {
    scale: 1.5,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: true,
    allowTaint: true,
    foreignObjectRendering: true,
    scrollX: -475,
    scrollY: -60,
    width: dashboardEl.scrollWidth,
    height: dashboardEl.scrollHeight
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
  pdf.save(`dashboard-${new Date().toISOString().slice(0,10)}.pdf`);
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



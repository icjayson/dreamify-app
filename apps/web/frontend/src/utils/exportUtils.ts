import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export async function captureDashboardAsPdf(rootEl: HTMLElement, options?: { filename?: string }) {
  const filename = options?.filename || `dashboard-${new Date().toISOString().slice(0,16).replace(/[:-]/g, '').replace('T','-')}.pdf`;

  const scale = Math.min(2, window.devicePixelRatio || 1.5);
  const canvas = await html2canvas(rootEl, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10; // mm
  const usableWidth = pageWidth - margin * 2;

  const imgWidth = usableWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width * 0.264583; // px to mm

  let y = margin;
  let remainingHeight = imgHeight;

  const pageImgHeight = pageHeight - margin * 2;

  // If the content fits on one page
  if (imgHeight <= pageImgHeight) {
    pdf.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight, undefined, 'FAST');
  } else {
    // Slice vertically across pages
    const viewportHeightPx = Math.round((pageImgHeight / 0.264583) * (canvas.width / imgWidth));
    let offsetPx = 0;
    while (remainingHeight > 0) {
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.min(viewportHeightPx, canvas.height - offsetPx);
      const ctx = sliceCanvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(canvas, 0, offsetPx, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
      const sliceData = sliceCanvas.toDataURL('image/png');
      const sliceHeightMm = (sliceCanvas.height * imgWidth) / sliceCanvas.width * 0.264583;
      if (y + sliceHeightMm > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.addImage(sliceData, 'PNG', margin, y, imgWidth, sliceHeightMm, undefined, 'FAST');
      y += sliceHeightMm;
      offsetPx += sliceCanvas.height;
      remainingHeight -= sliceHeightMm;
      if (offsetPx < canvas.height) {
        pdf.addPage();
        y = margin;
      }
    }
  }

  pdf.save(filename);
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



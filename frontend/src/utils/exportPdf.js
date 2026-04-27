/**
 * Render a list of LogSheet container DOM elements into a single multi-page
 * PDF (one sheet per page, Letter landscape).
 *
 * Each element is rasterized with html2canvas at 2x scale, then placed onto
 * a Letter-landscape page, scaled to fit while preserving aspect ratio.
 *
 *   await exportLogSheetsToPdf(refs.current.filter(Boolean), "trip.pdf")
 *
 * jspdf + html2canvas total ~700KB; we dynamic-import them so they only
 * load on first click, not on initial app render.
 */
export async function exportLogSheetsToPdf(elements, filename = "eld-log.pdf") {
  if (!elements || elements.length === 0) return;

  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter",
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24; // ~1/3 inch

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      // Force layout regardless of where the element actually sits on page
      // (we render hidden sheets at left:-99999px to keep them measurable).
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const imgRatio = canvas.width / canvas.height;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;

    let drawW, drawH;
    if (imgRatio > availW / availH) {
      drawW = availW;
      drawH = drawW / imgRatio;
    } else {
      drawH = availH;
      drawW = drawH * imgRatio;
    }
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, "JPEG", x, y, drawW, drawH, undefined, "FAST");
  }

  pdf.save(filename);
}

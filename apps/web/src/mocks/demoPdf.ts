/**
 * A small, valid one-page PDF for the mock "Export signed PDF" button. In mock mode there is no signing key, so the page says
 * plainly that it is a demo copy and unsigned. The real backend (services/api/advisory_pdf.py) returns the Ed25519-signed file.
 * Text is Latin-1 only (Helvetica); anything else is replaced so the file always opens.
 */
export function demoAdvisoryPdf(lines: { text: string; size?: number; bold?: boolean; gap?: number }[]): Blob {
  const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '-').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let y = 790;
  const ops: string[] = ['BT'];
  for (const l of lines) {
    const size = l.size ?? 11;
    // wrap to the 483 pt text width (Helvetica averages about half the font size per character)
    const max = Math.floor(483 / (size * (l.bold ? 0.56 : 0.5)));
    const words = l.text.split(' ');
    const rows: string[] = [];
    let row = '';
    for (const w of words) {
      if (row && (row + ' ' + w).length > max) { rows.push(row); row = w; } else row = row ? `${row} ${w}` : w;
    }
    rows.push(row);
    rows.forEach((r, i) => {
      y -= i === 0 ? (l.gap ?? size + 8) : size + 4;
      ops.push(`/${l.bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 56 ${y} Tm (${safe(r)}) Tj`);
    });
  }
  ops.push('ET');
  // frame and a header rule
  ops.push('0.06 0.16 0.28 RG 1.5 w 40 40 515 762 re S 56 738 m 539 738 l S');
  const stream = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}

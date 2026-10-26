// ASCII-only, deterministic two-page PDF. No customer data or external resources.
export function twoPagePdfFixture(): Buffer {
  const streams = ['OMNI_PAGE_ONE', 'OMNI_PAGE_TWO'].map((marker, i) =>
    `BT /F1 18 Tf 72 720 Td (${marker}) Tj 0 -32 Td (Contract location: page ${i + 1}.) Tj ET\n`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map(stream => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`),
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, 'ascii');
}

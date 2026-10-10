export function twoPageOriginal(
  pages: readonly [string, string] = [
    "Independent original page one",
    "Independent original page two",
  ],
  pageSize: readonly [number, number] = [300, 300],
) {
  const streams = pages.map((text) => `BT /F1 14 Tf 30 ${pageSize[1] - 50} Td (${text}) Tj ET`);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize[0]} ${pageSize[1]}] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize[0]} ${pageSize[1]}] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...streams.map(
      (stream) => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ),
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const start = Buffer.byteLength(body);
  body += `xref\n0 8\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;

  return Buffer.from(body);
}

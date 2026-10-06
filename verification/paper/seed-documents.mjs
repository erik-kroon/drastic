import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const path = resolve(process.argv[2] ?? "");
if (basename(path) !== "session.json" || !basename(dirname(path)).startsWith("openerp-paper-")) throw new Error("Use a private disposable Paper session");
const session = JSON.parse(await readFile(path, "utf8"));
const origin = new URL(session.apiUrl);
if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:") throw new Error("Only the disposable local Worker is allowed");
const base = `${origin.origin}/api/v1/entities/entity_synthetic/books/book_synthetic`;

function pdf(lines) {
  const content = `BT /F1 9 Tf 14 210 Td ${lines.map((line, index) => `${index ? "0 -14 Td " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 170 230] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body).toString("base64");
}

const examples = [
  ["F-2026-0041.pdf", ["Synthetic customer document", "F-2026-0041", "Retained original fixture"]],
  ["Hyresavtal, Fjällfastigheter AB.pdf", ["Synthetic lease fixture", "Fjallfastigheter AB"]],
  ["Kvitto 2208, Kontorsbolaget.pdf", ["Synthetic receipt fixture", "Kontorsbolaget", "Kvitto 2208"]],
  ["Vinter & Co AB, faktura 882.pdf", ["Vinter & Co AB", "", "Faktura 882", "Synthetic source fixture"]],
  ["Nordhamn Studio AB, faktura 1048.pdf", ["Nordhamn Studio AB", "", "Faktura 1048", "Konceptutveckling 6 000,00", "Layout 3 000,00", "Bildbehandling 1 000,00", "Att betala 12 500,00"]],
];
const receipts = [];
for (const [filename, lines] of examples) {
  const response = await fetch(`${base}/source-occurrences`, { method: "POST", headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ sourceSystem: "manual-upload", sourceAccountId: "book_synthetic", occurrenceKey: `paper-archive-${filename}`, sourceRevision: "1", filename, mediaType: "application/pdf", contentBase64: pdf(lines) }), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(result)}`);
  receipts.push({ id: result.id, filename: result.filename, sha256: result.sha256 });
}
await mkdir("test-results/paper", { recursive: true });
await writeFile("test-results/paper/documents-seed.json", JSON.stringify({ synthetic: true, financialWrites: false, originals: receipts }, null, 2));
console.log(JSON.stringify({ retained: receipts.length, artifact: "test-results/paper/documents-seed.json" }));

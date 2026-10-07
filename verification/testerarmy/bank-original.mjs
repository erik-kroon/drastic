import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const document = await PDFDocument.create();

const regular = await document.embedFont(StandardFonts.Helvetica);

const bold = await document.embedFont(StandardFonts.HelveticaBold);

const page = document.addPage([595, 842]);

const ink = rgb(0.06, 0.09, 0.16);

const muted = rgb(0.28, 0.33, 0.41);

page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) });

document.setCreationDate(new Date("2026-10-03T00:00:00Z"));

document.setModificationDate(new Date("2026-10-03T00:00:00Z"));

document.setTitle("Synthetic bank review supplier document");

document.setAuthor("OpenERP synthetic fixture");

document.setProducer("OpenERP locked pdf-lib fixture");

const line = (text, y, size = 11, font = regular, color = ink) =>
  page.drawText(text, { x: 48, y, size, font, color });

line("EXEMPELDATA", 784, 10, bold, muted);

line("Exempel Kontorsservice AB", 744, 20, bold);

line("Leverantörsunderlag", 710, 14, bold);

line("Nummer DEMO-2026-0037", 678);

line("Datum 3 okt 2026", 658);

line("Till Fjällby Konsult AB", 620, 12, bold);

line("Beskrivning", 556, 10, bold, muted);

page.drawText("Belopp SEK", { x: 448, y: 556, size: 10, font: bold, color: muted });

page.drawLine({ start: { x: 48, y: 542 }, end: { x: 547, y: 542 }, thickness: 1, color: muted });

line("Kontorsmaterial", 518);

page.drawText("1 250,00", { x: 472, y: 518, size: 11, font: regular, color: ink });

line("Total enligt underlaget", 462, 12, bold);

page.drawText("1 250,00 SEK", { x: 435, y: 462, size: 12, font: bold, color: ink });

line("Momsbehandling är inte fastställd i detta exempel.", 420, 10, regular, muted);

line("Syntetiskt underlag för lokal granskning. Inte en juridisk faktura.", 96, 10, regular, muted);

line("Ingen betalning eller bankanslutning sker genom detta underlag.", 78, 10, regular, muted);

const bytes = await document.save({ useObjectStreams: false });

const output = join(import.meta.dirname, "bank-review-original.pdf");

await writeFile(output, bytes);

console.log(
  JSON.stringify({
    filename: "bank-review-original.pdf",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    totalMinor: "125000",
    syntheticOnly: true,
  }),
);

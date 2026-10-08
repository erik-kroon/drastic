import { PDFDocument } from "pdf-lib";

async function inspect(bytes: Uint8Array, mediaType: string) {
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024) throw new Error("document_size");

  if (mediaType === "application/pdf") {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
      throw new Error("pdf_signature");
    const pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: true });

    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 20) throw new Error("page_limit");

    return {
      unit: "inch",
      pages: pdf.getPages().map((page) => {
        const media = page.getMediaBox();
        const crop = page.getCropBox();

        const width =
          Math.min(media.x + media.width, crop.x + crop.width) - Math.max(media.x, crop.x);

        const height =
          Math.min(media.y + media.height, crop.y + crop.height) - Math.max(media.y, crop.y);

        const angle = page.getRotation().angle;

        if (width <= 0 || height <= 0 || angle % 90 !== 0) throw new Error("document_invalid");

        const size = { width, height };
        const rotated = Math.abs(angle % 180) === 90;

        return {
          width: (rotated ? size.height : size.width) / 72,
          height: (rotated ? size.width : size.height) / 72,
        };
      }),
    };
  } else {
    const pdf = await PDFDocument.create();
    let image;

    if (mediaType === "image/png") image = await pdf.embedPng(bytes);
    else if (mediaType === "image/jpeg") image = await pdf.embedJpg(bytes);
    else throw new Error("image_profile");

    if (image === null || image.width * image.height > 25000000) throw new Error("image_profile");

    return { unit: "pixel", pages: [{ width: image.width, height: image.height }] };
  }
}

const chunks: Buffer[] = [];

let length = 0;

try {
  for await (const chunk of process.stdin) {
    length += chunk.length;

    if (length > 5 * 1024 * 1024) throw new Error("document_size");
    chunks.push(Buffer.from(chunk));
  }

  process.stdout.write(JSON.stringify(await inspect(Buffer.concat(chunks), process.argv[2] ?? "")));
} catch (error) {
  const message = error instanceof Error ? error.message : "";

  const code = ["document_size", "pdf_signature", "image_profile", "page_limit"].includes(message)
    ? message
    : "document_invalid";

  process.stdout.write(JSON.stringify({ error: code }));
}

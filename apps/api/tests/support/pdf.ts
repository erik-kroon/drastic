import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect } from "vitest";
import { environment } from "./fixtures";

function numberList(value: unknown): value is ReadonlyArray<number> | Float32Array {
  return (
    (Array.isArray(value) || value instanceof Float32Array) &&
    Array.from(value).every((item: unknown) => typeof item === "number" && Number.isFinite(item))
  );
}

function unknownList(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value);
}

export async function readPdf(bytes: Uint8Array, name: string) {
  await writeFile(join(environment().artifacts, `${name}.pdf`), bytes);

  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pages = [];

  try {
    const document = await loading.promise;

    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const operators = await page.getOperatorList();
      const rules = [];
      let transform: number[] = [1, 0, 0, 1, 0, 0];
      const transforms: number[][] = [];

      for (const [index, operation] of operators.fnArray.entries()) {
        const arguments_: unknown = operators.argsArray[index];

        if (operation === OPS.save) transforms.push([...transform]);
        else if (operation === OPS.restore) {
          const restored = transforms.pop();

          if (!restored) throw new Error("PDF graphics restore has no saved transform.");

          transform = restored;
        } else if (operation === OPS.transform && numberList(arguments_)) {
          transform = Util.transform(transform, arguments_);
        } else if (
          operation === OPS.constructPath &&
          unknownList(arguments_) &&
          arguments_[0] === OPS.fill
        ) {
          const bounds = arguments_[2];

          if (!numberList(bounds) || bounds.length !== 4) continue;

          const points = Array.from(bounds);
          Util.applyTransform(points, transform, 0);
          Util.applyTransform(points, transform, 2);
          const [x1, y1, x2, y2] = points;

          if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined)
            throw new Error("PDF path has incomplete bounds.");

          const width = Math.abs(x2 - x1);
          const height = Math.abs(y2 - y1);

          // Takumi paints rules as thin filled rectangles; exclude clips and text paths.
          if (height <= 1 && width > viewport.width * 0.8)
            rules.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), width, height });
        }
      }

      const items = content.items.flatMap((item) =>
        "str" in item
          ? [
              {
                text: item.str,
                x: item.transform[4] ?? NaN,
                y: item.transform[5] ?? NaN,
                width: item.width,
                height: item.height,
              },
            ]
          : [],
      );

      expect(viewport.width).toBeCloseTo(595.28, 0);
      expect(viewport.height).toBeCloseTo(841.89, 0);

      for (const item of items) {
        // PDF.js inserts zero-height spaces between separately positioned text runs.
        if (item.text.trim() === "") continue;

        expect(item.x, item.text).toBeGreaterThanOrEqual(0);
        expect(item.x + item.width, item.text).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(item.y, item.text).toBeGreaterThanOrEqual(0);
        expect(item.y, item.text).toBeLessThanOrEqual(viewport.height + 0.5);
      }

      pages.push({
        number,
        text: content.items
          .flatMap((item) => ("str" in item ? [item.str + (item.hasEOL ? "\n" : "")] : []))
          .join("")
          .replaceAll(/\s+/gu, " "),
        items,
        rules,
      });
    }
  } finally {
    await loading.destroy();
  }

  await writeFile(
    join(environment().artifacts, `${name}.text.json`),
    JSON.stringify(pages, null, 2),
  );

  return pages;
}

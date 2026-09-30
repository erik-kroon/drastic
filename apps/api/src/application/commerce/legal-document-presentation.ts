import * as Accounting from "@open-erp/contracts/accounting";
import {
  plexLatin400,
  plexLatin600,
  plexExtended400,
  plexExtended600,
} from "../fonts/plex-mono-embedded";

const fontBytes = (source: string) =>
  Uint8Array.from(atob(source), (character) => character.charCodeAt(0));

export const legalDocumentFonts = [
  {
    name: "Plex Latin 400",
    subsetOf: "OpenERP Plex",
    subsetRank: 0,
    weight: 400,
    data: fontBytes(plexLatin400),
  },
  {
    name: "Plex Latin 600",
    subsetOf: "OpenERP Plex",
    subsetRank: 0,
    weight: 600,
    data: fontBytes(plexLatin600),
  },
  {
    name: "Plex Extended 400",
    subsetOf: "OpenERP Plex",
    subsetRank: 1,
    weight: 400,
    data: fontBytes(plexExtended400),
  },
  {
    name: "Plex Extended 600",
    subsetOf: "OpenERP Plex",
    subsetRank: 1,
    weight: 600,
    data: fontBytes(plexExtended600),
  },
];

export function unsupportedDocument(message: string): never {
  throw new Accounting.AccountingError({ code: "UnsupportedProfile", message });
}

export function legalDocumentText(value: string) {
  if (
    !value.isWellFormed() ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;

      return (
        code !== 9 &&
        code !== 10 &&
        code !== 13 &&
        !(code >= 32 && code <= 126) &&
        !(code >= 160 && code <= 591) &&
        !(code >= 8192 && code <= 8303) &&
        code !== 8364 &&
        code !== 8482
      );
    })
  ) {
    unsupportedDocument(
      "The document contains characters outside the bundled font coverage. No text was replaced.",
    );
  }

  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function legalDocumentMoney(minor: string) {
  if (!/^(0|[1-9][0-9]{0,37})$/u.test(minor))
    unsupportedDocument("The document amount is not an exact minor-unit string.");
  const padded = minor.padStart(3, "0");
  const major = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, " ");

  return `${major},${padded.slice(-2)} kr`;
}

export function requiredDocumentText(value: string | null, field: string): string {
  if (value === null || value === "")
    return unsupportedDocument(`Legal document is missing ${field}.`);

  return legalDocumentText(value);
}

export function verifyDocumentBytes(bytes: Uint8Array) {
  if (
    bytes.length < 8 ||
    bytes.length > 2097152 ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
  )
    unsupportedDocument("The PDF exceeds the supported 2 MiB artifact profile.");

  return bytes;
}

import { Buffer } from "node:buffer";

export type SieDiagnostic = {
  code: string;
  severity: "error" | "warning";
  line: number;
  byteOffset: number;
  message: string;
};
export type SieRecord = {
  ordinal: number;
  line: number;
  byteStart: number;
  byteEnd: number;
  tag: string;
  text: string;
  fields: string[];
  voucherOrdinal: number | null;
};
export type SieVoucher = {
  ordinal: number;
  series: string;
  number: string;
  date: string;
  recordOrdinal: number;
  sourceReference: string;
  transactions: Array<{
    recordOrdinal: number;
    kind: "TRANS" | "RTRANS" | "BTRANS";
    account: string;
    dimensions: string;
    amount: string;
  }>;
};

type AppendDiagnostic = (code: string, line: number, byteOffset: number, message: string) => void;
type SieControl = {
  kind: "IB" | "UB" | "RES";
  year: string;
  account: string;
  amount: string;
  recordOrdinal: number;
};

const pc8High =
  "\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192" +
  "\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510" +
  "\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580" +
  "\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0";

type SieEncoding = "utf-8" | "windows-1252" | "ibm437";

function decodePc8(bytes: Uint8Array) {
  const characters: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    characters.push(byte < 128 ? String.fromCharCode(byte) : (pc8High[byte - 128] ?? ""));
  }
  return characters.join("");
}

function scanSieFields(body: string) {
  const fields: string[] = [];
  let token = "";
  let quoted = false;
  let brace = 0;
  let active = false;
  for (let pos = 0; pos < body.length; pos++) {
    const ch = body[pos] ?? "";
    if (quoted && ch === "\\" && body[pos + 1] === '"') {
      token += '"';
      pos++;
      active = true;
    } else if (ch === '"') {
      if (quoted && body[pos + 1] === '"') {
        token += '"';
        pos++;
      } else quoted = !quoted;
      active = true;
    } else if (!quoted && ch === "{") {
      brace++;
      token += ch;
      active = true;
    } else if (!quoted && ch === "}") {
      brace--;
      token += ch;
      active = true;
    } else if (!quoted && brace === 0 && /\s/.test(ch)) {
      if (active) {
        fields.push(token);
        token = "";
        active = false;
      }
    } else {
      token += ch;
      active = true;
    }
  }
  if (active) fields.push(token);
  return { fields, complete: !quoted && brace === 0 };
}

const exactAmount = /^-?(?:0|[1-9][0-9]{0,35})(?:\.[0-9]{1,2})?$/;
function validTransaction(fields: string[]) {
  return (
    fields.length >= 3 &&
    /^[0-9]{4}$/.test(fields[0] ?? "") &&
    /^\{.*\}$/.test(fields[1] ?? "") &&
    exactAmount.test(fields[2] ?? "")
  );
}
function validControl(fields: string[]) {
  return (
    fields.length >= 3 &&
    /^-?[0-9]{1,4}$/.test(fields[0] ?? "") &&
    /^[0-9]{4}$/.test(fields[1] ?? "") &&
    exactAmount.test(fields[2] ?? "")
  );
}

function recordSieFact(
  record: SieRecord,
  current: SieVoucher | null,
  depth: number,
  vouchers: SieVoucher[],
  controls: SieControl[],
  append: AppendDiagnostic,
): SieVoucher | null {
  const { tag, fields, line, byteStart } = record;
  if (tag === "VER") {
    if (depth !== 0 || fields.length < 3 || !/^[0-9]{8}$/.test(fields[2] ?? ""))
      append("voucher", line, byteStart, "Voucher identity or date is invalid.");
    current = {
      ordinal: vouchers.length + 1,
      series: fields[0] ?? "",
      number: fields[1] ?? "",
      date: fields[2] ?? "",
      recordOrdinal: record.ordinal,
      sourceReference: `${fields[0] ?? ""}:${fields[1] ?? ""}`,
      transactions: [],
    };
    vouchers.push(current);
    record.voucherOrdinal = current.ordinal;
  } else if (tag === "TRANS" || tag === "RTRANS" || tag === "BTRANS") {
    if (!current || depth !== 1 || !validTransaction(fields))
      append(
        "transaction",
        line,
        byteStart,
        "Transaction needs a voucher, account, dimensions and exact decimal amount.",
      );
    else
      current.transactions.push({
        recordOrdinal: record.ordinal,
        kind: tag,
        account: fields[0] ?? "",
        dimensions: fields[1] ?? "",
        amount: fields[2] ?? "",
      });
  } else if (tag === "IB" || tag === "UB" || tag === "RES") {
    if (depth !== 0 || !validControl(fields))
      append("control", line, byteStart, "Opening, closing or result control has invalid fields.");
    else
      controls.push({
        kind: tag,
        year: fields[0] ?? "",
        account: fields[1] ?? "",
        amount: fields[2] ?? "",
        recordOrdinal: record.ordinal,
      });
  } else if (depth === 1)
    append(
      "voucher_record",
      line,
      byteStart,
      "Unexpected record inside voucher; retained but not admitted.",
    );
  return current;
}

// Explicit encoding is part of the interpretation. Original bytes remain in source intake.
export function parseSie(bytes: Uint8Array, encoding: SieEncoding) {
  const diagnostics: SieDiagnostic[] = [];
  const records: SieRecord[] = [];
  const vouchers: SieVoucher[] = [];
  const controls: SieControl[] = [];
  const append: AppendDiagnostic = (code, line, byteOffset, message) =>
    diagnostics.push({ code, severity: "error", line, byteOffset, message });
  let text: string;
  try {
    text =
      encoding === "ibm437"
        ? decodePc8(bytes)
        : new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    append("encoding", 1, 0, `Bytes cannot be decoded as ${encoding}.`);
    return { records, vouchers, controls, diagnostics, ready: false };
  }
  if (text.includes("\0")) append("nul", 1, 0, "NUL bytes are not supported.");
  const bom =
    encoding === "utf-8" &&
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf;
  if (bom && text.startsWith("\ufeff")) text = text.slice(1);
  const depth = scanSieLines(text, encoding, bom ? 3 : 0, records, vouchers, controls, append);
  validateSieProfile(depth, bytes.length, records, vouchers, encoding, append);
  return { records, vouchers, controls, diagnostics, ready: diagnostics.length === 0 };
}

function scanSieLines(
  text: string,
  encoding: SieEncoding,
  startOffset: number,
  records: SieRecord[],
  vouchers: SieVoucher[],
  controls: SieControl[],
  append: AppendDiagnostic,
) {
  let offset = startOffset;
  let current: SieVoucher | null = null;
  let depth = 0;
  const supported = new Set([
    "FLAGGA",
    "PROGRAM",
    "FORMAT",
    "GEN",
    "SIETYP",
    "RAR",
    "ORGNR",
    "FNAMN",
    "ADRESS",
    "KPTYP",
    "VALUTA",
    "KONTO",
    "KTYP",
    "SRU",
    "DIM",
    "OBJEKT",
    "IB",
    "UB",
    "RES",
    "VER",
    "TRANS",
    "RTRANS",
    "BTRANS",
    "OMFATTN",
    "TAXAR",
    "FNR",
    "BKOD",
    "PROSA",
  ]);
  const lines = text.split(/(?<=\n)/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const byteStart = offset;
    offset += encoding !== "utf-8" ? raw.length : Buffer.byteLength(raw, "utf8");
    const line = raw.replace(/\r?\n$/, "");
    if (line.trim() === "") continue;
    if (line === "{") {
      depth++;
      if (depth !== 1 || current === null)
        append("brace", i + 1, byteStart, "Unexpected opening brace.");
      continue;
    }
    if (line === "}") {
      depth--;
      if (depth !== 0 || current === null)
        append("brace", i + 1, byteStart, "Unexpected closing brace.");
      current = null;
      continue;
    }
    const match = /^#([A-Z][A-Z0-9]*)\s*(.*)$/.exec(line);
    if (!match) {
      append("syntax", i + 1, byteStart, "Unsupported record syntax.");
      continue;
    }
    const tag = match[1] ?? "";
    const body = match[2] ?? "";
    const { fields, complete } = scanSieFields(body);
    if (!complete)
      append("field_syntax", i + 1, byteStart, "Unclosed quoted field or dimension group.");
    const record: SieRecord = {
      ordinal: records.length + 1,
      line: i + 1,
      byteStart,
      byteEnd: offset,
      tag,
      text: line,
      fields,
      voucherOrdinal: current?.ordinal ?? null,
    };
    records.push(record);
    if (!supported.has(tag))
      append("unsupported_record", i + 1, byteStart, `Unsupported #${tag} record is retained.`);
    current = recordSieFact(record, current, depth, vouchers, controls, append);
  }
  return depth;
}

function validateSieProfile(
  depth: number,
  byteLength: number,
  records: SieRecord[],
  vouchers: SieVoucher[],
  encoding: SieEncoding,
  append: AppendDiagnostic,
) {
  if (depth !== 0)
    append("brace", records.at(-1)?.line ?? 1, byteLength, "Voucher block was not closed.");
  const formats = records.filter((record) => record.tag === "FORMAT");
  const types = records.filter((record) => record.tag === "SIETYP");
  if (formats.length !== 1 || types.length !== 1 || types[0]?.fields[0] !== "4")
    append("profile", 1, 0, "Only an explicitly declared SIE type 4 profile is supported.");
  if (
    formats[0]?.fields[0] !==
    (encoding === "utf-8" ? "UTF8" : encoding === "ibm437" ? "PC8" : "WIN1252")
  )
    append(
      "format",
      formats[0]?.line ?? 1,
      formats[0]?.byteStart ?? 0,
      "Declared #FORMAT does not match the selected byte encoding.",
    );
  for (const voucher of vouchers) {
    const year = Number(voucher.date.slice(0, 4));
    const month = Number(voucher.date.slice(4, 6));
    const day = Number(voucher.date.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day
    )
      append(
        "voucher_date",
        records[voucher.recordOrdinal - 1]?.line ?? 1,
        records[voucher.recordOrdinal - 1]?.byteStart ?? 0,
        "Voucher date is not a calendar date.",
      );
  }
  if (vouchers.length === 0) append("empty", 1, 0, "No historical vouchers were found.");
}

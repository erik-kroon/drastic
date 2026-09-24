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

function scanSieFields(body: string) {
  const fields: string[] = [];
  let token = "";
  let quoted = false;
  let brace = 0;
  let active = false;
  for (let pos = 0; pos < body.length; pos++) {
    const ch = body[pos] ?? "";
    if (ch === '"') {
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
export function parseSie(bytes: Uint8Array, encoding: "utf-8" | "windows-1252") {
  const diagnostics: SieDiagnostic[] = [];
  const records: SieRecord[] = [];
  const vouchers: SieVoucher[] = [];
  const controls: SieControl[] = [];
  const append: AppendDiagnostic = (code, line, byteOffset, message) =>
    diagnostics.push({ code, severity: "error", line, byteOffset, message });
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
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
  encoding: "utf-8" | "windows-1252",
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
    offset += encoding === "windows-1252" ? raw.length : Buffer.byteLength(raw, "utf8");
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
  encoding: "utf-8" | "windows-1252",
  append: AppendDiagnostic,
) {
  if (depth !== 0)
    append("brace", records.at(-1)?.line ?? 1, byteLength, "Voucher block was not closed.");
  const formats = records.filter((record) => record.tag === "FORMAT");
  const types = records.filter((record) => record.tag === "SIETYP");
  if (formats.length !== 1 || types.length !== 1 || types[0]?.fields[0] !== "4")
    append("profile", 1, 0, "Only an explicitly declared SIE type 4 profile is supported.");
  if (formats[0]?.fields[0] !== (encoding === "utf-8" ? "UTF8" : "WIN1252"))
    append(
      "format",
      formats[0]?.line ?? 1,
      formats[0]?.byteStart ?? 0,
      "Declared #FORMAT does not match selected encoding; PC8 and other formats are unsupported.",
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

export const statementByteLimit = 1_048_576;
const rowLimit = 10_000;
const headers = ["Bokförd", "Valutadatum", "Text", "Typ", "Insättningar/uttag", "Bokfört saldo"];

export class StatementProblem extends Error {
  constructor(
    readonly code: "size" | "encoding" | "csv" | "header" | "empty" | "rows" | "date" | "amount" | "order" | "read",
    readonly line: number = 1,
  ) {
    super(code);
  }
}

type CsvRecord = { line: number; fields: string[] };

export type StatementMovement = {
  ordinal: number;
  sourceLine: number;
  bookedOn: string;
  valuedOn: string;
  description: string;
  transactionType: string;
  amountMinor: string;
  balanceMinor: string;
};

export type StatementPreview = {
  profile: "seb_six_column_csv_v1";
  source: { name: string; sha256: string; byteLength: number };
  selectedCurrency: "SEK";
  coverage: "unconfirmed";
  sourceAccount: null;
  rows: StatementMovement[];
  controls: {
    inferredOpeningMinor: string;
    lastObservedMinor: string;
    depositsMinor: string;
    withdrawalsMinor: string;
    balanceDifferenceRows: number[];
  };
};

function csvRecords(source: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let mode: "plain" | "quoted" | "closed" = "plain";
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (mode === "quoted") {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else mode = "closed";
      } else {
        field += char;
        if (char === "\n" || (char === "\r" && source[index + 1] !== "\n")) line++;
      }
      continue;
    }
    if (char === ",") {
      fields.push(field);
      field = "";
      mode = "plain";
    } else if (char === "\n" || char === "\r") {
      fields.push(field);
      records.push({ line: recordLine, fields });
      if (records.length > rowLimit + 1) throw new StatementProblem("rows", recordLine);
      fields = [];
      field = "";
      mode = "plain";
      if (char === "\r" && source[index + 1] === "\n") index++;
      line++;
      recordLine = line;
    } else if (char === '"' && mode === "plain" && field === "") {
      mode = "quoted";
    } else {
      if (mode === "closed" || char === '"') throw new StatementProblem("csv", line);
      field += char;
    }
  }
  if (mode === "quoted") throw new StatementProblem("csv", recordLine);
  if (field !== "" || fields.length > 0 || mode === "closed") {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  if (records.length > rowLimit + 1) throw new StatementProblem("rows", recordLine);
  return records;
}

function accountingDate(value: string, line: number) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new StatementProblem("date", line);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)
    throw new StatementProblem("date", line);
  return value;
}

function exactMinor(value: string, line: number) {
  if (!/^-?(0|[1-9]\d{0,35})\.\d{2}$/.test(value)) throw new StatementProblem("amount", line);
  return BigInt(value.replace(".", "")).toString();
}

function movement(record: CsvRecord, ordinal: number): StatementMovement {
  const [bookedOn, valuedOn, description, transactionType, amount, balance] = record.fields;
  if (
    record.fields.length !== 6 ||
    bookedOn === undefined || valuedOn === undefined ||
    !description?.trim() || !transactionType?.trim() ||
    amount === undefined || balance === undefined
  ) throw new StatementProblem("csv", record.line);
  return {
    ordinal,
    sourceLine: record.line,
    bookedOn: accountingDate(bookedOn, record.line),
    valuedOn: accountingDate(valuedOn, record.line),
    description,
    transactionType,
    amountMinor: exactMinor(amount, record.line),
    balanceMinor: exactMinor(balance, record.line),
  };
}

export async function previewSebStatement(file: File): Promise<StatementPreview> {
  if (file.size > statementByteLimit) throw new StatementProblem("size");
  const bytes = await file.arrayBuffer();
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StatementProblem("encoding");
  }
  const records = csvRecords(source);
  const header = records[0];
  if (!header || header.fields.length !== headers.length || headers.some((value, index) => value !== header.fields[index]))
    throw new StatementProblem("header");
  const rows = records.slice(1).map((record, index) => movement(record, index + 1));
  const newest = rows[0];
  const oldest = rows.at(-1);
  if (!newest || !oldest) throw new StatementProblem("empty");
  let deposits = 0n;
  let withdrawals = 0n;
  const balanceDifferenceRows: number[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row) continue;
    const amount = BigInt(row.amountMinor);
    if (amount > 0n) deposits += amount;
    else withdrawals -= amount;
    const previous = rows[index + 1];
    if (previous) {
      if (row.bookedOn < previous.bookedOn) throw new StatementProblem("order", row.sourceLine);
      if (BigInt(row.balanceMinor) !== BigInt(previous.balanceMinor) + amount)
        balanceDifferenceRows.push(row.ordinal);
    }
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    profile: "seb_six_column_csv_v1",
    source: {
      name: file.name,
      byteLength: bytes.byteLength,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    },
    selectedCurrency: "SEK",
    coverage: "unconfirmed",
    sourceAccount: null,
    rows,
    controls: {
      inferredOpeningMinor: (BigInt(oldest.balanceMinor) - BigInt(oldest.amountMinor)).toString(),
      lastObservedMinor: newest.balanceMinor,
      depositsMinor: deposits.toString(),
      withdrawalsMinor: withdrawals.toString(),
      balanceDifferenceRows,
    },
  };
}

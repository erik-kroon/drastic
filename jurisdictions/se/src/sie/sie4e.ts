import type * as Sie4E from "@open-erp/contracts/sie4e";
import { amount, date, encodeCp437, quoted, refuse } from "./encoder";

// Complete-book SIE4E export: pure record encoding, pure raw balance arithmetic
// and an independent semantic comparison. This module has no database, no
// network and no ambient date: the capture it receives already pins the
// generation date, the reviewed classifications and the exact retained rows.
//
// The record grammar is the pinned SIE type-4 family recorded on the capture's
// renderer release. A record family this renderer does not emit is never
// implied, and text that is not representable in the declared encoding is
// refused rather than replaced, transliterated or truncated.

type Capture = typeof Sie4E.Sie4EExport.Type;

type Row = typeof Sie4E.Sie4ERow.Type;

type AccountClass = typeof Sie4E.Sie4EAccountClass.Type;

type AccountRow = typeof Sie4E.Sie4EAccountRow.Type;

type BalanceRow = typeof Sie4E.Sie4EBalanceRow.Type;

type LineRow = typeof Sie4E.Sie4ELineRow.Type;

type Limitation = typeof Sie4E.Sie4ELimitation.Type;

export const maximumAccounts = 500;

export const maximumLines = 20000;

export const maximumVouchers = 2000;

// The pinned edition's account field is four digits, which is also what the
// independent inbound parser accepts. A code of another shape is refused; it is
// never padded, trimmed or re-mapped to a neighbouring account.
const accountCode = /^[1-9][0-9]{3}$/u;

const voucherSeries = /^[A-Z0-9]{1,16}$/u;

const exactMinor = /^(0|[1-9][0-9]{0,37})$/u;

const exactSigned = /^-?(0|[1-9][0-9]{0,37})$/u;

const organizationNumber = /^[0-9]{6}-?[0-9]{4}$/u;

const parsedAmount = /^(-?)(0|[1-9][0-9]{0,35})\.([0-9]{2})$/u;

export type Sie4EAccountFact = {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly version: string;
};

export type Sie4EOpeningFact = { readonly accountId: string; readonly minor: string };

export type Sie4ELineFact = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly ordinalInVoucher: number;
  readonly sequence: string;
  readonly fiscalYearId: string;
  readonly series: string;
  readonly number: string;
  readonly postingDate: string;
  readonly eventId: string;
  readonly changeSetId: string;
  readonly correctsVoucherId: string | null;
  readonly accountId: string;
  readonly accountCode: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
};

export type Sie4ESelection = {
  readonly accounts: ReadonlyArray<Sie4EAccountFact>;
  readonly classifications: ReadonlyArray<{
    readonly accountId: string;
    readonly accountClass: AccountClass;
  }>;
  readonly opening: ReadonlyArray<Sie4EOpeningFact>;
  readonly lines: ReadonlyArray<Sie4ELineFact>;
  readonly establishedOpening: boolean;
};

export type Sie4EMembership = {
  readonly accounts: ReadonlyArray<AccountRow>;
  readonly balances: ReadonlyArray<BalanceRow>;
  readonly lines: ReadonlyArray<LineRow>;
  readonly vouchers: number;
  readonly controlTotals: {
    readonly openingMinor: bigint;
    readonly movementMinor: bigint;
    readonly closingMinor: bigint;
  };
  readonly limitations: ReadonlyArray<Limitation>;
};

function classify(
  classifications: ReadonlyArray<{
    readonly accountId: string;
    readonly accountClass: AccountClass;
  }>,
) {
  const byAccount = new Map<string, AccountClass>();

  for (const entry of classifications) {
    if (byAccount.has(entry.accountId))
      refuse(
        `The reviewed account classification names account ${entry.accountId} twice. One reviewed class per account is required.`,
      );

    byAccount.set(entry.accountId, entry.accountClass);
  }

  return byAccount;
}

function codeOrder(left: string, right: string) {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

function numberOrder(left: string, right: string) {
  const difference = BigInt(left) - BigInt(right);

  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

function signed(debitMinor: string, creditMinor: string) {
  if (!exactMinor.test(debitMinor) || !exactMinor.test(creditMinor))
    refuse("A captured amount is not an exact minor-unit integer.");

  if ((debitMinor === "0") === (creditMinor === "0"))
    refuse("Each captured line must contain exactly one positive amount.");

  return BigInt(debitMinor) - BigInt(creditMinor);
}

function limitation(code: Limitation["code"], detail: string): Limitation {
  return { code, detail };
}

const scopeLimitations: ReadonlyArray<Limitation> = [
  limitation(
    "unreviewed_account_classification",
    "Balance-sheet and nominal account classes are the caller's reviewed classification and were not checked against a reviewed company profile.",
  ),
  limitation(
    "no_reviewed_company_profile",
    "No reviewed statutory chart, VAT classification or period closure is applied. The export does not assert a closed fiscal year.",
  ),
  limitation(
    "no_external_source_completeness",
    "This export covers the selected book only. External source systems are not reconciled, so it is not a claim that every real-world transaction is recorded.",
  ),
  limitation(
    "not_a_statutory_archive",
    "This is an application-owned export, not a statutory archival file and not certified against the SIE Group specification.",
  ),
  limitation(
    "no_destination_validation",
    "No importer, program or authority has accepted these bytes. Repeated reads return the retained bytes, not a newly rendered file.",
  ),
];

// Pure raw balance arithmetic over the frozen selection. The complete declared
// account set receives a balance row, so no nonzero account is omitted and no
// unestablished opening can become a quiet zero.
export function buildSie4EMembership(selection: Sie4ESelection): Sie4EMembership {
  if (selection.accounts.length === 0) refuse("The selected book declares no accounts.");

  if (selection.accounts.length > maximumAccounts)
    refuse(`A complete-book export supports at most ${maximumAccounts} accounts.`);

  if (selection.lines.length > maximumLines)
    refuse(`A complete-book export supports at most ${maximumLines} journal lines.`);

  const classes = classify(selection.classifications);
  const codes = new Set<string>();
  const accounts: Array<AccountRow> = [];

  selection.accounts
    .slice()
    .sort((left, right) => codeOrder(left.code, right.code))
    .forEach((account, index) => {
      if (!accountCode.test(account.code))
        refuse(
          `Account ${account.code} is not a four-digit account code. The pinned record family cannot represent it and no code was changed.`,
        );

      if (codes.has(account.code))
        refuse(`Account code ${account.code} is declared twice in this book.`);

      codes.add(account.code);

      const accountClass = classes.get(account.accountId);

      if (accountClass === undefined)
        refuse(
          `Account ${account.code} has no reviewed classification. Every declared account needs one reviewed balance-sheet or nominal class.`,
        );

      accounts.push({
        rowId: `KONTO:${account.accountId}`,
        ordinal: index + 1,
        kind: "account",
        accountId: account.accountId,
        code: account.code,
        name: account.name,
        accountClass,
        active: account.active,
        version: account.version,
      });
    });

  const declared = new Map<string, string>(
    accounts.map((account) => [account.accountId, account.code]),
  );

  const opening = new Map<string, bigint>();

  for (const fact of selection.opening) {
    if (!exactSigned.test(fact.minor))
      refuse("A captured prior-period balance is not an exact integer.");

    if (!declared.has(fact.accountId))
      refuse(
        `A captured prior-period balance names account ${fact.accountId}, which the book does not declare.`,
      );

    opening.set(fact.accountId, (opening.get(fact.accountId) ?? 0n) + BigInt(fact.minor));
  }

  const movement = new Map<string, bigint>();
  const lines: Array<LineRow> = [];

  selection.lines
    .slice()
    .sort(
      (left, right) =>
        numberOrder(left.sequence, right.sequence) ||
        left.ordinalInVoucher - right.ordinalInVoucher,
    )
    .forEach((line, index) => {
      if (declared.get(line.accountId) !== line.accountCode)
        refuse(
          `A captured line names account ${line.accountId} without a matching account declaration.`,
        );

      if (!voucherSeries.test(line.series))
        refuse("SIE4E requires retained alphanumeric series names of at most sixteen characters.");

      if (!exactMinor.test(line.number)) refuse("SIE4E requires a positive exact voucher number.");

      if (line.ordinalInVoucher < 1)
        refuse("A captured line has no positive ordinal inside its voucher.");

      const value = signed(line.debitMinor, line.creditMinor);

      movement.set(line.accountId, (movement.get(line.accountId) ?? 0n) + value);
      lines.push({
        rowId: `VER:${line.voucherId}:${line.ordinalInVoucher}`,
        ordinal: index + 1,
        kind: "line",
        voucherId: line.voucherId,
        lineId: line.lineId,
        ordinalInVoucher: line.ordinalInVoucher,
        sequence: line.sequence,
        fiscalYearId: line.fiscalYearId,
        series: line.series,
        number: line.number,
        postingDate: line.postingDate,
        eventId: line.eventId,
        changeSetId: line.changeSetId,
        correctsVoucherId: line.correctsVoucherId,
        accountId: line.accountId,
        accountCode: line.accountCode,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        signedMinor: value.toString(),
        description: line.description,
      });
    });

  const groups = new Map<string, Array<LineRow>>();

  for (const line of lines) {
    const group = groups.get(line.voucherId);

    if (group) group.push(line);
    else groups.set(line.voucherId, [line]);
  }

  if (groups.size > maximumVouchers)
    refuse(`A complete-book export supports at most ${maximumVouchers} complete vouchers.`);

  const identities = new Set<string>();

  for (const [voucherId, group] of groups) {
    const first = group[0];

    if (first === undefined) refuse("A captured voucher has no lines.");

    if (group.length < 2) refuse(`Voucher ${voucherId} is incomplete and cannot be exported.`);

    const ordinals = new Set(group.map((line) => line.ordinalInVoucher));

    if (ordinals.size !== group.length || Math.max(...ordinals) !== group.length)
      refuse(`Voucher ${voucherId} has a duplicate or missing line ordinal.`);

    const balance = group.reduce((total, line) => total + BigInt(line.signedMinor), 0n);

    if (balance !== 0n) refuse(`Voucher ${voucherId} does not balance and cannot be exported.`);

    const metadata = new Set(
      group.map((line) =>
        [line.series, line.number, line.postingDate, line.sequence, line.changeSetId].join(
          "\u0000",
        ),
      ),
    );

    if (metadata.size !== 1)
      refuse(
        `Voucher ${voucherId} carries inconsistent series, number, date or sequence metadata.`,
      );

    const identity = `${first.series}:${first.number}`;

    if (identities.has(identity))
      refuse(
        `Series ${first.series} reuses voucher number ${first.number} in the selected year. Export one fiscal year per capture.`,
      );

    identities.add(identity);
  }

  if (!selection.establishedOpening)
    refuse(
      "The selected fiscal year has no established opening representation. A prior native balance or a reviewed opening set is required; a first-year zero opening is never inferred.",
    );

  const nominalOpening = accounts
    .filter((account) => account.accountClass === "nominal")
    .reduce((total, account) => total + (opening.get(account.accountId) ?? 0n), 0n);

  if (nominalOpening !== 0n)
    refuse(
      "A nominal result account carries a non-zero captured opening balance. The pinned record family carries the raw result balance, so that opening would be lost.",
    );

  let openingTotal = 0n;
  let movementTotal = 0n;
  let closingTotal = 0n;

  const balances: Array<BalanceRow> = accounts.map((account, index) => {
    const openingMinor = opening.get(account.accountId) ?? 0n;
    const movementMinor = movement.get(account.accountId) ?? 0n;
    const closingMinor = openingMinor + movementMinor;

    openingTotal += openingMinor;
    movementTotal += movementMinor;
    closingTotal += closingMinor;

    return {
      rowId: `SALDO:${account.accountId}`,
      ordinal: index + 1,
      kind: "balance",
      accountId: account.accountId,
      code: account.code,
      accountClass: account.accountClass,
      openingMinor: openingMinor.toString(),
      movementMinor: movementMinor.toString(),
      closingMinor: closingMinor.toString(),
      resultMinor: closingMinor.toString(),
    };
  });

  return {
    accounts,
    balances,
    lines,
    vouchers: groups.size,
    controlTotals: {
      openingMinor: openingTotal,
      movementMinor: movementTotal,
      closingMinor: closingTotal,
    },
    limitations: scopeLimitations,
  };
}

type Voucher = {
  readonly series: string;
  readonly number: string;
  readonly postingDate: string;
  readonly lines: ReadonlyArray<LineRow>;
};

function orderVouchers(lines: ReadonlyArray<LineRow>) {
  const groups = new Map<string, Array<LineRow>>();

  for (const line of lines) {
    const group = groups.get(line.voucherId);

    if (group) group.push(line);
    else groups.set(line.voucherId, [line]);
  }

  return [...groups.values()]
    .map((group) => {
      const first = group[0];

      if (first === undefined) refuse("A captured voucher has no lines.");

      return {
        series: first.series,
        number: first.number,
        postingDate: first.postingDate,
        lines: [...group].sort((left, right) => left.ordinalInVoucher - right.ordinalInVoucher),
      } satisfies Voucher;
    })
    .sort(
      (left, right) =>
        codeOrder(left.series, right.series) || numberOrder(left.number, right.number),
    );
}

// Strict record writer for the pinned type-4 family. Text, quoting, line ending
// and byte encoding are all fixed here; nothing is substituted afterwards.
export function renderSie4E(
  capture: Capture,
  rows: ReadonlyArray<Row>,
  limitations: ReadonlyArray<Limitation> = capture.coverageLimitations,
): Uint8Array<ArrayBuffer> {
  if (
    capture.currencyScale !== 2 ||
    capture.emittedRecords.objectRecords !== "absent" ||
    capture.emittedRecords.priorYearRecords !== "absent"
  )
    refuse(
      "This SIE4E renderer supports only currency scale two and no object or prior-year records.",
    );

  if (capture.kind !== "complete_book_sie_v1")
    refuse("A complete-book export requires a complete_book_sie_v1 capture.");

  if (!organizationNumber.test(capture.organizationNumber))
    refuse("The organisation number is not a declared six-plus-four digit representation.");

  if (capture.legalName.trim() !== capture.legalName || capture.legalName.length < 1)
    refuse("A complete-book export requires a retained legal company name.");

  const accounts = rows.filter((row): row is AccountRow => row.kind === "account");
  const balances = rows.filter((row): row is BalanceRow => row.kind === "balance");
  const lines = rows.filter((row): row is LineRow => row.kind === "line");

  if (accounts.length !== capture.counts.accounts || balances.length !== capture.counts.balances)
    refuse("The retained membership does not match the captured account and balance counts.");

  if (lines.length !== capture.counts.lines)
    refuse("The retained membership does not match the captured journal line count.");

  const orderedAccounts = [...accounts].sort((left, right) => codeOrder(left.code, right.code));
  const orderedBalances = [...balances].sort((left, right) => codeOrder(left.code, right.code));
  const vouchers = orderVouchers(lines);

  if (vouchers.length !== capture.counts.vouchers)
    refuse("The retained membership does not match the captured voucher count.");

  for (const balance of orderedBalances)
    if (
      BigInt(balance.openingMinor) + BigInt(balance.movementMinor) !==
      BigInt(balance.closingMinor)
    )
      refuse(
        `Account ${balance.code} does not satisfy opening plus movement equals closing and cannot be exported.`,
      );

  for (const line of lines)
    if (line.postingDate < capture.fiscalYear.startsOn || line.postingDate > capture.asOf)
      refuse("A captured line falls outside the selected fiscal year and as-of scope.");

  const records = [
    "#FLAGGA 0",
    `#PROGRAM ${quoted("OpenERP")} ${quoted(capture.rendererRelease.version)}`,
    "#FORMAT PC8",
    `#GEN ${date(capture.generationDate)}`,
    "#SIETYP 4",
    `#ORGNR ${capture.organizationNumber}`,
    `#FNAMN ${quoted(capture.legalName)}`,
    `#RAR 0 ${date(capture.fiscalYear.startsOn)} ${date(capture.fiscalYear.endsOn)}`,
    `#VALUTA ${capture.currency}`,
    `#PROSA ${quoted(
      `Complete-book export of the selected book through ${capture.asOf} at committed sequence ${capture.ledgerBoundary}. ${limitations
        .map((entry) => `${entry.code}: ${entry.detail}`)
        .join(" ")}`,
    )}`,
    ...orderedAccounts.map((account) => `#KONTO ${account.code} ${quoted(account.name)}`),
    ...orderedBalances
      .filter((balance) => balance.accountClass === "balance_sheet")
      .map((balance) => `#IB 0 ${balance.code} ${amount(BigInt(balance.openingMinor))}`),
    ...orderedBalances
      .filter((balance) => balance.accountClass === "balance_sheet")
      .map((balance) => `#UB 0 ${balance.code} ${amount(BigInt(balance.closingMinor))}`),
    ...orderedBalances
      .filter((balance) => balance.accountClass === "nominal")
      .map((balance) => `#RES 0 ${balance.code} ${amount(BigInt(balance.resultMinor))}`),
  ];

  let emitted = 0;

  for (const voucher of vouchers) {
    if (!voucherSeries.test(voucher.series)) refuse("A voucher series is not representable.");

    if (voucher.lines.length < 2) refuse("A complete voucher needs at least two lines.");

    const balance = voucher.lines.reduce((total, line) => total + BigInt(line.signedMinor), 0n);

    if (balance !== 0n) refuse("An unbalanced voucher cannot be transferred.");

    records.push(
      `#VER ${quoted(voucher.series)} ${voucher.number} ${date(voucher.postingDate)}`,
      "{",
      ...voucher.lines.map(
        (line) =>
          `#TRANS ${line.accountCode} {} ${amount(BigInt(line.signedMinor))} ${date(line.postingDate)} ${quoted(line.description)}`,
      ),
      "}",
    );
    emitted += voucher.lines.length;
  }

  if (emitted !== capture.counts.lines)
    refuse("The rendered vouchers do not cover every captured line exactly once.");

  return encodeCp437(`${records.join("\r\n")}\r\n`);
}

// The structural shape of the existing inbound SIE parser's result. Keeping the
// comparison parameterised by that shape is what makes it an independent check:
// the produced bytes are re-parsed by code that never encoded them.
export type Sie4EParsed = {
  readonly records: ReadonlyArray<{
    readonly tag: string;
    readonly fields: ReadonlyArray<string>;
  }>;
  readonly vouchers: ReadonlyArray<{
    readonly series: string;
    readonly number: string;
    readonly date: string;
    readonly transactions: ReadonlyArray<{
      readonly kind: string;
      readonly account: string;
      readonly dimensions: string;
      readonly amount: string;
    }>;
  }>;
  readonly controls: ReadonlyArray<{
    readonly kind: string;
    readonly year: string;
    readonly account: string;
    readonly amount: string;
  }>;
  readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly severity: string }>;
};

export type Sie4EComparison =
  | {
      readonly matched: true;
      readonly records: number;
      readonly accounts: number;
      readonly vouchers: number;
      readonly lines: number;
      readonly controls: number;
    }
  | { readonly matched: false; readonly reasons: ReadonlyArray<string> };

// The one parser code this profile tolerates: a genuinely established but empty
// book has no vouchers, and the parser says so rather than losing data.
const permittedDiagnostics = new Set(["empty"]);

function parseMinor(text: string) {
  const match = parsedAmount.exec(text);

  if (match === null) return null;

  const magnitude = BigInt(match[2] ?? "0") * 100n + BigInt(match[3] ?? "0");

  return match[1] === "-" ? -magnitude : magnitude;
}

function singleRecord(parsed: Sie4EParsed, tag: string) {
  const found = parsed.records.filter((record) => record.tag === tag);

  return found.length === 1 ? found[0] : undefined;
}

type Note = (reason: string) => void;

function checkHeader(capture: Capture, parsed: Sie4EParsed, note: Note) {
  for (const diagnostic of parsed.diagnostics) {
    if (permittedDiagnostics.has(diagnostic.code) && parsed.vouchers.length === 0) continue;

    note(`The independent parser reported ${diagnostic.code} at ${diagnostic.severity}.`);
  }

  const flagga = singleRecord(parsed, "FLAGGA");

  if (flagga?.fields[0] !== "0") note("#FLAGGA is not the generated 0 record.");

  const format = singleRecord(parsed, "FORMAT");

  if (format?.fields[0] !== "PC8") note("#FORMAT does not declare the rendered PC8 encoding.");

  const type = singleRecord(parsed, "SIETYP");

  if (type?.fields[0] !== "4") note("#SIETYP is not the exported type 4 record.");

  const program = singleRecord(parsed, "PROGRAM");

  if (program?.fields[0] !== "OpenERP" || program?.fields[1] !== capture.rendererRelease.version)
    note("#PROGRAM does not name the captured renderer release.");

  const gen = singleRecord(parsed, "GEN");

  if (gen?.fields[0] !== capture.generationDate.replaceAll("-", ""))
    note("#GEN is not the captured generation date.");

  const name = singleRecord(parsed, "FNAMN");

  if (name?.fields[0] !== capture.legalName) note("#FNAMN is not the captured legal company name.");

  const organization = singleRecord(parsed, "ORGNR");

  if (organization?.fields[0] !== capture.organizationNumber)
    note("#ORGNR is not the captured organisation number.");

  const year = singleRecord(parsed, "RAR");

  if (
    year?.fields[0] !== "0" ||
    year?.fields[1] !== capture.fiscalYear.startsOn.replaceAll("-", "") ||
    year?.fields[2] !== capture.fiscalYear.endsOn.replaceAll("-", "")
  )
    note("#RAR does not carry the captured current fiscal year interval.");

  const currency = singleRecord(parsed, "VALUTA");

  if (currency?.fields[0] !== capture.currency) note("#VALUTA is not the captured currency.");

  if (singleRecord(parsed, "PROSA") === undefined) note("#PROSA is missing.");

  if (parsed.records.some((record) => record.tag === "DIM" || record.tag === "OBJEKT"))
    note("Object records are present although the capture declares no dimension.");
}

function checkAccountDeclarations(
  accounts: ReadonlyArray<AccountRow>,
  parsed: Sie4EParsed,
  note: Note,
) {
  const declared = parsed.records.filter((record) => record.tag === "KONTO");

  if (declared.length !== accounts.length) {
    note(
      `The file declares ${declared.length} accounts but the capture retains ${accounts.length}.`,
    );

    return;
  }

  const expected = [...accounts].sort((left, right) => codeOrder(left.code, right.code));

  expected.forEach((account, index) => {
    const record = declared[index];
    const actual = record === undefined ? "" : `${record.fields[0]} ${record.fields[1]}`;

    if (actual !== `${account.code} ${account.name}`)
      note(`#KONTO ${account.code} ${account.name} is missing or changed in the file.`);
  });
}

function checkControls(balances: ReadonlyArray<BalanceRow>, parsed: Sie4EParsed, note: Note) {
  const expected = new Map<string, bigint>();

  for (const balance of balances) {
    if (balance.accountClass === "balance_sheet") {
      expected.set(`IB ${balance.code}`, BigInt(balance.openingMinor));
      expected.set(`UB ${balance.code}`, BigInt(balance.closingMinor));
    } else expected.set(`RES ${balance.code}`, BigInt(balance.resultMinor));
  }

  const actual = new Map<string, bigint>();

  for (const control of parsed.controls) {
    const key = `${control.kind} ${control.account}`;
    const minor = parseMinor(control.amount);

    if (control.year !== "0" || minor === null) {
      note(`Control record ${key} is not a current-year exact amount.`);

      continue;
    }

    if (actual.has(key)) {
      note(`Control record ${key} is emitted more than once.`);

      continue;
    }

    actual.set(key, minor);
  }

  if (actual.size !== expected.size)
    note(
      `The file carries ${actual.size} control records but the capture retains ${expected.size}.`,
    );

  for (const [key, minor] of expected) {
    const found = actual.get(key);

    if (found === undefined) note(`Control record ${key} is missing from the file.`);
    else if (found !== minor)
      note(`Control record ${key} is ${found} but the capture retains ${minor}.`);
  }

  return actual;
}

// Movement recomputed from the parsed transactions only. Together with the parsed
// #IB and #UB this is the independent opening plus movement equals closing
// identity, derived from the file rather than from the capture.
function checkTransactions(parsed: Sie4EParsed, note: Note) {
  const movement = new Map<string, bigint>();

  for (const voucher of parsed.vouchers) {
    for (const transaction of voucher.transactions) {
      const minor = parseMinor(transaction.amount);

      if (transaction.kind !== "TRANS")
        note(`Transaction ${voucher.series}:${voucher.number} is not a #TRANS record.`);

      if (transaction.dimensions !== "{}")
        note(
          `Transaction ${voucher.series}:${voucher.number} carries an object group the capture does not hold.`,
        );

      if (minor === null) {
        note(`Transaction ${voucher.series}:${voucher.number} has no exact two-decimal amount.`);

        continue;
      }

      movement.set(transaction.account, (movement.get(transaction.account) ?? 0n) + minor);
    }
  }

  return movement;
}

function checkVoucherIdentities(
  capture: Capture,
  lines: ReadonlyArray<LineRow>,
  parsed: Sie4EParsed,
  note: Note,
) {
  if (parsed.vouchers.length !== capture.counts.vouchers)
    note(
      `The file carries ${parsed.vouchers.length} vouchers but the capture retains ${capture.counts.vouchers}.`,
    );

  const counted = parsed.vouchers.reduce(
    (total, voucher) => total + voucher.transactions.length,
    0,
  );

  if (counted !== capture.counts.lines)
    note(
      `The file carries ${counted} transactions but the capture retains ${capture.counts.lines}.`,
    );

  orderVouchers(lines).forEach((voucher, index) => {
    const actual = parsed.vouchers[index];

    if (
      actual === undefined ||
      actual.series !== voucher.series ||
      actual.number !== voucher.number ||
      actual.date !== voucher.postingDate.replaceAll("-", "")
    ) {
      note(
        `Voucher ${voucher.series}:${voucher.number} is missing or changed at file position ${index + 1}.`,
      );

      return;
    }

    if (actual.transactions.length !== voucher.lines.length) {
      note(
        `Voucher ${voucher.series}:${voucher.number} carries a different number of transactions.`,
      );

      return;
    }

    voucher.lines.forEach((line, position) => {
      const transaction = actual.transactions[position];

      if (
        transaction === undefined ||
        transaction.account !== line.accountCode ||
        parseMinor(transaction.amount) !== BigInt(line.signedMinor)
      )
        note(
          `Transaction ${position + 1} of voucher ${voucher.series}:${voucher.number} is missing or changed.`,
        );
    });
  });

  return counted;
}

function checkBalanceIdentities(
  balances: ReadonlyArray<BalanceRow>,
  movement: ReadonlyMap<string, bigint>,
  controls: ReadonlyMap<string, bigint>,
  note: Note,
) {
  for (const balance of balances) {
    const moved = movement.get(balance.code) ?? 0n;

    if (moved !== BigInt(balance.movementMinor))
      note(
        `Account ${balance.code} moves ${moved} in the file but ${balance.movementMinor} in the capture.`,
      );

    if (balance.accountClass === "balance_sheet") {
      const opening = controls.get(`IB ${balance.code}`) ?? 0n;
      const closing = controls.get(`UB ${balance.code}`);

      if (closing === undefined) note(`Account ${balance.code} has no #UB record in the file.`);
      else if (opening + moved !== closing)
        note(
          `Account ${balance.code} does not satisfy opening plus movement equals closing in the file.`,
        );

      continue;
    }

    const result = controls.get(`RES ${balance.code}`);

    if (result === undefined) note(`Account ${balance.code} has no #RES record in the file.`);
    else if (result !== moved)
      note(`Account ${balance.code} result ${result} is not the raw nominal movement ${moved}.`);
  }
}

export function compareSie4E(
  capture: Capture,
  rows: ReadonlyArray<Row>,
  parsed: Sie4EParsed,
): Sie4EComparison {
  const reasons: string[] = [];

  const note: Note = (reason) => {
    if (reasons.length < 20) reasons.push(reason);
  };

  const accounts = rows.filter((row): row is AccountRow => row.kind === "account");
  const balances = rows.filter((row): row is BalanceRow => row.kind === "balance");
  const lines = rows.filter((row): row is LineRow => row.kind === "line");

  checkHeader(capture, parsed, note);
  checkAccountDeclarations(accounts, parsed, note);

  const controls = checkControls(balances, parsed, note);
  const movement = checkTransactions(parsed, note);
  const counted = checkVoucherIdentities(capture, lines, parsed, note);

  checkBalanceIdentities(balances, movement, controls, note);

  for (const code of movement.keys())
    if (!accounts.some((account) => account.code === code))
      note(`Account ${code} appears in the file without a retained account declaration.`);

  if (reasons.length > 0) return { matched: false, reasons };

  return {
    matched: true,
    records: parsed.records.length,
    accounts: accounts.length,
    vouchers: parsed.vouchers.length,
    lines: counted,
    controls: controls.size,
  };
}

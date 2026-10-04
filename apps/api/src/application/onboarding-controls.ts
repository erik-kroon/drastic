import { qualifyImportReview } from "./onboarding-import-review";
import { qualifyAssetRegister } from "./onboarding-asset-register";
import { parseOpeningInvoiceRows } from "./onboarding-open-items";
import { qualifyPayrollHandoff } from "./onboarding-payroll-handoff";
import { qualifyOriginalIndex } from "./onboarding-originals";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as A from "@open-erp/contracts/accounting";
import * as O from "@open-erp/contracts/onboarding";
import { readSourceBytesInTransaction } from "./source-retention";
import { failure } from "./failures";
import { decode, toJsonObject, type Scope } from "./commerce/support";
import { isoNow, newId } from "./posting";
import * as Db from "../db/onboarding-lifecycle";
import type { Transaction } from "../db/transaction";

const Row = Schema.Struct({
  kind: O.OnboardingControlKind,
  asOf: A.AccountingDate,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  accountCode: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  amountMinor: A.SignedMinorUnits.check(Schema.isMaxLength(39)),
});

export const qualifyControlInTransaction = Effect.fn("onboarding.qualifyControl")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  input: typeof O.QualifyOnboardingControl.Type,
) {
  const original = yield* readSourceBytesInTransaction(tx, scope, input.occurrenceId);

  const expectedMediaType =
    input.kind === "historical_import_review" ? "application/json" : "text/csv";

  if (original.occurrence.mediaType !== expectedMediaType || original.bytes.byteLength > 65536)
    return yield* failure("UnsupportedProfile");

  if (/^openerp(?:[_-]|$)/i.test(original.occurrence.sourceSystem))
    return yield* failure("InvalidJournal");

  if (input.kind === "historical_payroll_handoff")
    return yield* qualifyPayrollHandoff(tx, scope, actorId, input, original);

  if (input.kind === "historical_asset_register")
    return yield* qualifyAssetRegister(tx, scope, actorId, input, original);

  if (input.kind === "historical_originals")
    return yield* qualifyOriginalIndex(tx, scope, actorId, input, original);

  if (input.kind === "historical_import_review")
    return yield* qualifyImportReview(tx, scope, actorId, input, original);

  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(original.bytes),
    catch: () => failure("InvalidJournal"),
  });

  const sourceLines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const header = sourceLines[0];
  const lines = sourceLines.slice(1);

  const detailed =
    header ===
      "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state" ||
    header ===
      "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state,counterparty_name";

  const invoiceRows = detailed
    ? yield* parseOpeningInvoiceRows(
        lines,
        `${original.occurrence.id}, ${original.occurrence.sha256}`,
        header.endsWith(",counterparty_name"),
      )
    : undefined;

  if (
    (!detailed && header !== "kind,as_of,currency,source_identity,account_code,amount_minor") ||
    lines.length === 0 ||
    lines.length > 1000
  )
    return yield* failure("UnsupportedProfile");

  const rows =
    invoiceRows?.map((row) => ({
      kind: row.kind,
      asOf: row.item.asOf,
      currency: row.item.currency,
      sourceIdentity: row.item.sourceIdentity,
      accountCode: row.item.sourceAccount,
      amountMinor: row.item.outstandingMinor,
    })) ??
    (yield* Effect.forEach(lines, (line) => {
      const fields = line.split(",");

      return fields.length !== 6
        ? failure("InvalidJournal")
        : Schema.decodeUnknownEffect(Row)({
            kind: fields[0],
            asOf: fields[1],
            currency: fields[2],
            sourceIdentity: fields[3],
            accountCode: fields[4],
            amountMinor: fields[5],
          }).pipe(Effect.mapError(() => failure("InvalidJournal")));
    }));

  const first = rows[0];

  if (
    !first ||
    rows.some(
      (row) =>
        row.kind !== input.kind || row.asOf !== first.asOf || row.currency !== first.currency,
    ) ||
    new Set(rows.map((row) => row.sourceIdentity)).size !== rows.length
  )
    return yield* failure("InvalidJournal");

  if (
    input.kind === "trial_balance" &&
    rows.reduce((total, row) => total + BigInt(row.amountMinor), 0n) !== 0n
  )
    return yield* failure("InvalidJournal");
  const balances = yield* Db.readBalances(tx, scope.bookId, first.asOf);
  const facts: Array<(typeof O.OnboardingControl.Type.facts)[number]> = [];

  for (const row of rows) {
    const account = balances.find((balance) => balance.code === row.accountCode);

    if (!account) return yield* failure("AccountInactive");
    facts.push({
      sourceIdentity: row.sourceIdentity,
      accountId: account.accountId,
      accountCode: account.code,
      amountMinor: row.amountMinor,
    });
  }

  const result = yield* decode(O.OnboardingControl, {
    id: newId("onboardingcontrol"),
    scope,
    occurrenceId: original.occurrence.id,
    sourceSha256: original.occurrence.sha256,
    sourceSystem: original.occurrence.sourceSystem,
    sourceAccountId: original.occurrence.sourceAccountId,
    kind: input.kind,
    parserVersion: "onboarding_csv_v1",
    asOf: first.asOf,
    currency: first.currency,
    facts,
    provenance: input.provenance,
    qualifiedBy: actorId,
    qualifiedAt: yield* isoNow(tx),
  });

  return invoiceRows ? { ...result, openItemDetails: invoiceRows.map((row) => row.item) } : result;
});

export const qualifyAttachedControlInTransaction = Effect.fn("onboarding.qualifyAttachedControl")(
  function* (tx: Transaction, scope: Scope, actorId: string, occurrenceId: string) {
    const original = yield* readSourceBytesInTransaction(tx, scope, occurrenceId);

    if (original.occurrence.mediaType !== "text/csv") return;

    const text = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(original.bytes),
      catch: () => failure("UnsupportedProfile"),
    }).pipe(Effect.catch(() => Effect.succeed("")));

    const header = text.replace(/\r\n/g, "\n").split("\n")[0];
    let kind: typeof O.OnboardingControlKind.Type;

    if (
      header ===
      "as_of,currency,source_identity,account_code,cost_minor,accumulated_depreciation_minor"
    )
      kind = "historical_asset_register";
    else if (header === "as_of,currency,source_identity,original_occurrence_id")
      kind = "historical_originals";
    else if (header === "source_system,history_starts_on,retained_through,currency")
      kind = "historical_payroll_handoff";
    else if (
      header === "kind,as_of,currency,source_identity,account_code,amount_minor" ||
      header ===
        "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state" ||
      header ===
        "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state,counterparty_name"
    ) {
      kind = yield* Schema.decodeUnknownEffect(O.OnboardingControlKind)(
        text.split("\n")[1]?.split(",")[0],
      ).pipe(Effect.mapError(() => failure("InvalidJournal")));
    } else return;
    const existing = yield* Db.readRecords(tx, "controls", scope.bookId);

    if (existing.some((row) => row.body.occurrenceId === occurrenceId && row.body.kind === kind))
      return;

    const control = yield* qualifyControlInTransaction(tx, scope, actorId, {
      occurrenceId,
      kind,
      provenance: `${original.occurrence.filename}, ${original.occurrence.sourceSystem}`,
    });

    yield* Db.insertRecord(tx, "controls", {
      bookId: scope.bookId,
      id: control.id,
      body: yield* toJsonObject(control),
    });
  },
);

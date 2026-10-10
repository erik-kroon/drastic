import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as A from "@open-erp/contracts/accounting";
import * as O from "@open-erp/contracts/onboarding";
import * as Intake from "@open-erp/contracts/source-intake";
import { isCalendarDate } from "@open-erp/domain/values";
import * as Db from "../../db/onboarding-lifecycle";
import * as PostingDb from "../../db/posting";
import * as Cases from "../../db/onboarding";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { rejectedOnboardingControls } from "./control-rejection";

const Row = Schema.Struct({
  asOf: A.AccountingDate,
  currency: Schema.Literal("SEK"),
  sourceIdentity: A.Identifier,
  accountCode: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  costMinor: A.MinorUnits,
  accumulatedDepreciationMinor: A.MinorUnits,
});

export const qualifyAssetRegister = Effect.fn("onboarding.qualifyReceivedAssetRegister")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  input: typeof O.QualifyOnboardingControl.Type,
  original: { occurrence: typeof Intake.SourceOccurrence.Type; bytes: Uint8Array },
) {
  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(original.bytes),
    catch: () => failure("InvalidJournal"),
  });

  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");

  if (
    lines[0] !==
      "as_of,currency,source_identity,account_code,cost_minor,accumulated_depreciation_minor" ||
    lines.length < 2 ||
    lines.length > 501
  )
    return yield* failure("UnsupportedProfile");

  const rows = yield* Effect.forEach(lines.slice(1), (line) => {
    const fields = line.split(",");

    if (fields.length !== 6) return failure("InvalidJournal");

    return decode(Row, {
      asOf: fields[0] ?? null,
      currency: fields[1] ?? null,
      sourceIdentity: fields[2] ?? null,
      accountCode: fields[3] ?? null,
      costMinor: fields[4] ?? null,
      accumulatedDepreciationMinor: fields[5] ?? null,
    }).pipe(Effect.mapError(() => failure("InvalidJournal")));
  });

  const first = rows[0];
  const current = (yield* Cases.readCurrent(tx, scope.bookId))[0];

  if (!first || !current) return yield* failure("NotFound");
  const setup = yield* decode(O.OnboardingCase, current.body);

  if (
    !isCalendarDate(first.asOf) ||
    first.asOf !== setup.configuration.dates.historyEndsOn ||
    rows.some((row) => row.asOf !== first.asOf) ||
    new Set(rows.map((row) => row.sourceIdentity)).size !== rows.length
  )
    return yield* failure("InvalidJournal");

  const controls = yield* Effect.forEach(
    yield* Db.readRecords(tx, "controls", scope.bookId),
    (row) => decode(O.OnboardingControl, row.body),
  );

  const balance = controls
    .filter((control) => control.kind === "trial_balance" && control.asOf === first.asOf)
    .toSorted(
      (left, right) =>
        right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
    )[0];

  if (
    !balance ||
    balance.occurrenceId === original.occurrence.id ||
    balance.currency !== first.currency
  )
    return yield* failure("MissingEvidence");

  if ((yield* rejectedOnboardingControls(tx, scope)).has(balance.id))
    return yield* failure("ApprovalRequired");
  const accounts = yield* PostingDb.readAllAccounts(tx, scope.bookId);
  const retained: Array<(typeof O.OnboardingAssetRegister.Type.rows)[number]> = [];
  const sums = new Map<string, bigint>();

  for (const row of rows) {
    const account = accounts.find((item) => item.active && item.code === row.accountCode);

    if (!account) return yield* failure("AccountInactive");
    const carrying = BigInt(row.costMinor) - BigInt(row.accumulatedDepreciationMinor);

    if (carrying < 0n) return yield* failure("InvalidJournal");
    sums.set(account.id, (sums.get(account.id) ?? 0n) + carrying);
    retained.push({
      sourceIdentity: row.sourceIdentity,
      accountId: account.id,
      costMinor: row.costMinor,
      accumulatedDepreciationMinor: row.accumulatedDepreciationMinor,
      carryingMinor: carrying.toString(),
    });
  }

  for (const [accountId, amount] of sums) {
    const expected = balance.facts.filter((fact) => fact.accountId === accountId);

    if (
      !expected.length ||
      expected.reduce((total, fact) => total + BigInt(fact.amountMinor), 0n) !== amount
    )
      return yield* failure("InvalidJournal");
  }

  return yield* decode(O.OnboardingControl, {
    id: newId("onboardingcontrol"),
    scope,
    occurrenceId: original.occurrence.id,
    sourceSha256: original.occurrence.sha256,
    sourceSystem: original.occurrence.sourceSystem,
    sourceAccountId: original.occurrence.sourceAccountId,
    kind: "historical_asset_register",
    parserVersion: "onboarding_csv_v1",
    asOf: first.asOf,
    currency: first.currency,
    facts: [],
    assetRegister: {
      trialBalanceControlId: balance.id,
      trialBalanceSourceSha256: balance.sourceSha256,
      rows: retained,
    },
    provenance: input.provenance,
    qualifiedBy: actorId,
    qualifiedAt: yield* isoNow(tx),
  });
});

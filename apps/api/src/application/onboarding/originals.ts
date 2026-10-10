import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as A from "@open-erp/contracts/accounting";
import * as O from "@open-erp/contracts/onboarding";
import * as Intake from "@open-erp/contracts/source-intake";
import { readSourceBytesInTransaction } from "../source-retention";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import type { Transaction } from "../../db/transaction";

const IndexRow = Schema.Struct({
  asOf: A.AccountingDate,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  occurrenceId: Schema.NullOr(A.Identifier),
});

export const qualifyOriginalIndex = Effect.fn("onboarding.qualifyOriginalIndex")(function* (
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
    lines[0] !== "as_of,currency,source_identity,original_occurrence_id" ||
    lines.length < 2 ||
    lines.length > 1001
  )
    return yield* failure("UnsupportedProfile");

  const rows = yield* Effect.forEach(lines.slice(1), (line) => {
    const fields = line.split(",");

    if (fields.length !== 4) return failure("InvalidJournal");

    return decode(IndexRow, {
      asOf: fields[0] ?? null,
      currency: fields[1] ?? null,
      sourceIdentity: fields[2] ?? null,
      occurrenceId: fields[3] || null,
    }).pipe(Effect.mapError(() => failure("InvalidJournal")));
  });

  const first = rows[0];

  if (
    !first ||
    rows.some((row) => row.asOf !== first.asOf || row.currency !== first.currency) ||
    new Set(rows.map((row) => row.sourceIdentity)).size !== rows.length
  )
    return yield* failure("InvalidJournal");
  const occurrenceIds = rows.flatMap((row) => (row.occurrenceId ? [row.occurrenceId] : []));

  if (new Set(occurrenceIds).size !== occurrenceIds.length) return yield* failure("InvalidJournal");

  const coverage = yield* Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      if (row.occurrenceId === null)
        return { sourceIdentity: row.sourceIdentity, occurrenceId: null, sourceSha256: null };
      const retained = yield* readSourceBytesInTransaction(tx, scope, row.occurrenceId);

      if (
        retained.occurrence.id === original.occurrence.id ||
        (retained.occurrence.mediaType !== "application/pdf" &&
          !retained.occurrence.mediaType.startsWith("image/"))
      )
        return yield* failure("UnsupportedProfile");

      return {
        sourceIdentity: row.sourceIdentity,
        occurrenceId: retained.occurrence.id,
        sourceSha256: retained.occurrence.sha256,
      };
    }),
  );

  return yield* decode(O.OnboardingControl, {
    id: newId("onboardingcontrol"),
    scope,
    occurrenceId: original.occurrence.id,
    sourceSha256: original.occurrence.sha256,
    sourceSystem: original.occurrence.sourceSystem,
    sourceAccountId: original.occurrence.sourceAccountId,
    kind: "historical_originals",
    parserVersion: "onboarding_csv_v1",
    asOf: first.asOf,
    currency: first.currency,
    facts: [],
    originalCoverage: { rows: coverage },
    provenance: input.provenance,
    qualifiedBy: actorId,
    qualifiedAt: yield* isoNow(tx),
  });
});

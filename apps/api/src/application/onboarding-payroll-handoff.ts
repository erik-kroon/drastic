import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as O from "@open-erp/contracts/onboarding";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Cases from "../db/onboarding";
import type { Transaction } from "../db/transaction";
import { decode, type Scope } from "./commerce/support";
import { failure } from "./failures";
import { isoNow } from "./command-receipts";
import { newId } from "./identifiers";

const Handoff = Schema.Struct({
  ...O.OnboardingPayrollHandoff.fields,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
});

export const qualifyPayrollHandoff = Effect.fn("onboarding.qualifyPayrollHandoff")(function* (
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
  const fields = lines[1]?.split(",") ?? [];

  if (
    lines[0] !== "source_system,history_starts_on,retained_through,currency" ||
    lines.length !== 2 ||
    fields.length !== 4
  )
    return yield* failure("InvalidJournal");

  const handoff = yield* decode(Handoff, {
    incumbentSystem: fields[0] ?? null,
    historyStartsOn: fields[1] ?? null,
    retainedThrough: fields[2] ?? null,
    currency: fields[3] ?? null,
  }).pipe(Effect.mapError(() => failure("InvalidJournal")));

  const row = (yield* Cases.readCurrent(tx, scope.bookId))[0];

  if (!row) return yield* failure("NotFound");
  const current = yield* decode(O.OnboardingCase, row.body);
  const dates = current.configuration.dates;

  if (
    handoff.incumbentSystem !== current.configuration.incumbentSystem ||
    handoff.historyStartsOn !== dates.historyStartsOn ||
    handoff.retainedThrough !== dates.historyEndsOn ||
    !dates.candidateLiveOn ||
    handoff.retainedThrough >= dates.candidateLiveOn
  )
    return yield* failure("StaleDependency");

  return yield* decode(O.OnboardingControl, {
    id: newId("onboardingcontrol"),
    scope,
    occurrenceId: original.occurrence.id,
    sourceSha256: original.occurrence.sha256,
    sourceSystem: original.occurrence.sourceSystem,
    sourceAccountId: original.occurrence.sourceAccountId,
    kind: "historical_payroll_handoff",
    parserVersion: "onboarding_csv_v1",
    asOf: handoff.retainedThrough,
    currency: handoff.currency,
    facts: [],
    payrollHandoff: {
      incumbentSystem: handoff.incumbentSystem,
      historyStartsOn: handoff.historyStartsOn,
      retainedThrough: handoff.retainedThrough,
    },
    provenance: input.provenance,
    qualifiedBy: actorId,
    qualifiedAt: yield* isoNow(tx),
  });
});

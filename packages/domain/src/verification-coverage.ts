import * as Schema from "effect/Schema";
import { Identifier, AccountingDate, Digest, isCalendarDate } from "./values";
import { MinorUnits } from "./money";

export const builderVersion = "month_close_predicate_v1";

export const gatedCheckIds = [
  "bank_reconciliation",
  "vouchers_supported",
  "facts_complete",
  "reviews_and_questions",
  "vat_control",
] as const;

export const GatedCheckId = Schema.Literals(gatedCheckIds);

export const CheckId = Schema.Literals([
  ...gatedCheckIds,
  "tax_account_control",
  "subledger_control",
  "supplier_statement_control",
  "customer_statement_control",
  "closing_provider_control",
]);

export const Status = Schema.Literals(["pass", "fail", "not_established", "not_run"]);

export const Freshness = Schema.Struct({
  observedBookSequence: Schema.optionalKey(MinorUnits),
  status: Schema.Literals(["fresh", "stale", "unavailable"]),
  reasons: Schema.Array(Schema.String),
  dependencyDigests: Schema.Record(Schema.String, Schema.String),
});

export const EvidenceRef = Schema.Struct({
  owner: Schema.String,
  id: Identifier,
  digest: Digest,
});

export const FrozenMonth = Schema.Struct({
  id: Identifier,
  fiscalYearId: Identifier,
  startsOn: AccountingDate,
  endsOn: AccountingDate,
  version: MinorUnits,
});

export const CheckRecord = Schema.Struct({
  checkId: CheckId,
  status: Status,
  reasons: Schema.Array(Schema.String),
  observedCutoff: Schema.Struct({
    ledgerSequence: MinorUnits,
    dependencyDigests: Schema.Record(Schema.String, Schema.String),
  }),
  builderVersion: Schema.String,
  evidenceRefs: Schema.Array(EvidenceRef),
  facts: Schema.JsonObject,
});

export const CheckView = Schema.Struct({
  checkId: CheckId,
  status: Status,
  reasons: Schema.Array(Schema.String),
  retained: Schema.NullOr(CheckRecord),
  evidenceRefs: Schema.Array(EvidenceRef),
  freshness: Freshness,
});

export const Verdict = Schema.Literals(["done", "not_done", "inconclusive"]);

export function monthBounds(startsOn: string, endsOn: string) {
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn) || !startsOn.endsWith("-01"))
    return false;
  const prefix = startsOn.slice(0, 8);
  const last = [31, 30, 29, 28].find((day) => isCalendarDate(`${prefix}${day}`));

  return endsOn === `${prefix}${last}`;
}

export function closeVerdict(checks: ReadonlyArray<typeof CheckView.Type>): typeof Verdict.Type {
  if (
    checks.length !== gatedCheckIds.length ||
    gatedCheckIds.some((id) => checks.filter((check) => check.checkId === id).length !== 1)
  )
    return "inconclusive";

  if (
    checks.some(
      (check) =>
        check.retained === null ||
        check.retained.status === "not_run" ||
        check.retained.status === "not_established" ||
        check.freshness.status !== "fresh",
    )
  )
    return "inconclusive";

  return checks.some((check) => check.retained?.status === "fail") ? "not_done" : "done";
}

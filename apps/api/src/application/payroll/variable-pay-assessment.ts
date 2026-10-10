import * as V from "@open-erp/contracts/variable-pay-review";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { calculateVariablePay, holidayTarget } from "@open-erp/domain/variable-pay";
import * as Db from "../../db/payroll/variable-pay";
import * as InputDb from "../../db/payroll/inputs";
import * as Foundation from "../../db/payroll-foundation";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../json";
import { readVariableSource, requireVariableSourceBinding } from "./variable-pay-source";

type Blocker = typeof V.VariablePayBlocker.Type;

const emptyBlocker = {
  sourceIds: [],
  dates: [],
  amountMinor: null,
  priorInputId: null,
  priorRunId: null,
  priorPaidEventId: null,
  priorPaidEventDigest: null,
  priorPaidEvidenceId: null,
  priorSettlementExecutionId: null,
  paidOn: null,
  priorRunRow: null,
};

function unresolvedPriorSource(
  original: typeof Inputs.PayrollInput.Type,
  profile: typeof V.VariablePaySourceProfile.Type,
): Blocker | null {
  if (original.input.basis.kind !== "variable") return null;
  const dates = new Set(original.input.basis.work.map((row) => row.scheduleDate));
  const candidates = profile.rows.filter((row) => dates.has(row.scheduleDate));

  if (!candidates.length) return null;

  return {
    ...emptyBlocker,
    code: "invalid_source",
    sourceIds: candidates.map((row) => row.sourceId),
    dates: candidates.map((row) => row.scheduleDate),
    priorInputId: original.id,
  };
}

export const duplicateSources = Effect.fn("variablePay.duplicateSources")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
  profile: typeof V.VariablePaySourceProfile.Type,
) {
  const blockers: Blocker[] = [];

  const prior = yield* Db.priorVariableInputs(
    tx,
    scope.bookId,
    submitted.input.employeeId,
    submitted.id,
  );

  if (prior.length > 100) return yield* failure("UnsupportedProfile");

  for (const row of prior) {
    const original = yield* decode(Inputs.PayrollInput, row.body);

    if (!row.sourceOccurrenceId) {
      const unresolved = unresolvedPriorSource(original, profile);

      if (unresolved) blockers.push(unresolved);
      continue;
    }

    const result = yield* Effect.result(readVariableSource(tx, scope, row.sourceOccurrenceId));

    if (Result.isFailure(result)) {
      if (original.input.evidence.sha256 === submitted.input.evidence.sha256)
        return yield* failure("MissingEvidence");
      const unresolved = unresolvedPriorSource(original, profile);

      if (unresolved) blockers.push(unresolved);
      continue;
    }

    const originalProfile = result.success.profile;
    yield* requireVariableSourceBinding(original, originalProfile);

    if (originalProfile.employeeId !== submitted.input.employeeId)
      return yield* failure("StaleDependency");
    const paid = row.paid === null ? null : yield* decode(Settlement.PaidPayrollEvent, row.paid);

    for (const current of profile.rows) {
      const consumed = originalProfile.rows.find(
        (item) =>
          item.scheduleDate === current.scheduleDate &&
          item.startLocal < current.endLocal &&
          current.startLocal < item.endLocal,
      );

      if (!consumed) continue;
      blockers.push({
        ...emptyBlocker,
        code: "duplicate_source",
        sourceIds: [current.sourceId],
        dates: [current.scheduleDate],
        priorInputId: original.id,
        priorRunId: row.runId,
        priorPaidEventId: paid?.id ?? null,
        priorPaidEventDigest: paid?.digest ?? null,
        priorPaidEvidenceId: paid?.evidenceId ?? null,
        priorSettlementExecutionId: paid?.settlementExecutionId ?? null,
        paidOn: paid?.paidOn ?? null,
        priorRunRow: paid === null ? null : originalProfile.rows.indexOf(consumed) + 1,
      });
    }
  }

  return blockers;
});

export const assessVariableBasis = Effect.fn("variablePay.assessBasis")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
  sourceOccurrence: typeof V.VariablePaySourceOccurrence.Type,
  ownRecognition?: typeof Inputs.PayrollInputReview.Type,
) {
  const source = yield* readVariableSource(tx, scope, sourceOccurrence.occurrenceId);

  if (
    source.occurrence.sha256 !== sourceOccurrence.sha256 ||
    source.occurrence.sha256 !== `sha256:${submitted.input.evidence.sha256}`
  )
    return yield* failure("StaleDependency");
  const basis = yield* requireVariableSourceBinding(submitted, source.profile);
  const blockers: Blocker[] = [];

  const unsupported = source.profile.rows.filter(
    (row) => !["worked", "overtime"].includes(row.kind),
  );

  if (unsupported.length)
    blockers.push({
      ...emptyBlocker,
      code: "unsupported_work",
      sourceIds: unsupported.map((row) => row.sourceId),
      dates: unsupported.map((row) => row.scheduleDate),
    });

  const ledgerMoney =
    (yield* InputDb.readCreditBalance(tx, scope.bookId, basis.holidayLiabilityAccountId))[0]
      ?.minor ?? "0";

  const ledgerSocial =
    (yield* InputDb.readCreditBalance(tx, scope.bookId, basis.socialProvisionAccountId))[0]
      ?.minor ?? "0";

  const money = (
    BigInt(ledgerMoney) - ownHolidayDelta(ownRecognition, "holidayMoneyDeltaMinor")
  ).toString();

  const social = (
    BigInt(ledgerSocial) - ownHolidayDelta(ownRecognition, "holidaySocialDeltaMinor")
  ).toString();

  const difference = (BigInt(basis.holiday.openingValueMinor) - BigInt(money)).toString();

  if (difference !== "0" || basis.holiday.openingSocialMinor !== social)
    blockers.push({
      ...emptyBlocker,
      code: "holiday_control",
      amountMinor: (BigInt(difference) < 0n ? -BigInt(difference) : BigInt(difference)).toString(),
    });
  blockers.push(...(yield* duplicateSources(tx, scope, submitted, source.profile)));
  const supported = source.profile.rows.filter((row) => ["worked", "overtime"].includes(row.kind));
  const components = calculateVariablePay(basis.earnings, []);
  const rates = new Set(supported.map((row) => row.rateMinor));
  const workedMinutes = supported.reduce((sum, row) => sum + BigInt(row.unitsMinor), 0n).toString();

  const workedAmountMinor = Result.isFailure(components)
    ? null
    : components.success.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n).toString();

  if (workedAmountMinor === null) blockers.push({ ...emptyBlocker, code: "invalid_source" });
  const holiday = holidayTarget(basis.holiday);

  if (invalidHolidayTarget(holiday, basis.holiday))
    blockers.push({ ...emptyBlocker, code: "invalid_source" });

  const holidayDeltaMinor =
    unsupported.length ||
    blockers.some((row) => row.code === "holiday_control") ||
    Result.isFailure(holiday) ||
    blockers.some((row) => row.code === "invalid_source")
      ? null
      : (BigInt(holiday.success.valueMinor) - BigInt(money)).toString();

  const revisions = yield* Foundation.listRevisions(tx, scope.bookId, submitted.input.employeeId);

  const employment = revisions
    .filter(
      (row) =>
        row.isCurrent &&
        row.kind === "employment" &&
        row.effectiveOn <= `${submitted.input.month}-01`,
    )
    .at(-1);

  const submitter = (yield* Db.submitter(tx, submitted.createdBy))[0];
  const account = (yield* Db.account(tx, scope.bookId, basis.holidayLiabilityAccountId))[0];

  if (!employment || typeof employment.body.personRef !== "string" || !submitter || !account)
    return yield* failure("StaleDependency");

  const dependencyDigest = yield* digest({
    inputDigest: submitted.digest,
    source: source.occurrence,
    profile: source.profile,
    money,
    social,
    blockers,
    employmentId: employment.id,
    submitter,
    financial: ownRecognition
      ? [{ present: false }]
      : yield* Db.financialReferences(tx, scope.bookId, submitted.id),
  });

  return {
    sourceOccurrence,
    sourceProfile: source.profile,
    employee: { id: submitted.input.employeeId, personRef: employment.body.personRef },
    submitter: { actorId: submitted.createdBy, displayName: submitter.displayName },
    paymentOn: source.profile.paymentOn,
    workedMinutes,
    rateMinor: rates.size === 1 ? (supported[0]?.rateMinor ?? null) : null,
    workedAmountMinor,
    sickAmountMinor: unsupported.length ? null : "0",
    holidayDeltaMinor,
    holidayControl: {
      accountId: basis.holidayLiabilityAccountId,
      accountCode: account.code,
      openingMinor: basis.holiday.openingValueMinor,
      ledgerMinor: money,
      differenceMinor: difference,
      socialAccountId: basis.socialProvisionAccountId,
      openingSocialMinor: basis.holiday.openingSocialMinor,
      ledgerSocialMinor: social,
    },
    blockers,
    dependencyDigest,
  };
});

function ownHolidayDelta(
  review: typeof Inputs.PayrollInputReview.Type | undefined,
  key: "holidayMoneyDeltaMinor" | "holidaySocialDeltaMinor",
) {
  return BigInt(review?.outputs[key] ?? "0");
}

function invalidHolidayTarget(
  target: ReturnType<typeof holidayTarget>,
  basis: Parameters<typeof holidayTarget>[0],
) {
  return (
    Result.isFailure(target) ||
    BigInt(target.success.unitsMinor) < 0n ||
    BigInt(target.success.valueMinor) < 0n ||
    BigInt(target.success.socialTargetMinor) < 0n ||
    basis.movements.some((row) => row.kind !== "earned" && row.kind !== "used")
  );
}

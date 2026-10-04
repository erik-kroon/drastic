import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Valuation from "@open-erp/domain/impairment-reversal";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { Transaction } from "../../db/transaction";
import * as Db from "../../db/subledger/valuations";
import * as Assets from "../../db/subledger/assets";
import * as Schedules from "../../db/subledger/schedules";
import * as Ledger from "../../db/posting";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest, readBook, isoNow } from "../posting";
import { captureAssetBasis } from "./asset-basis";
import { readPostingBasis } from "./schedules";

type Input = typeof Controls.PrepareAssetValuation.Type;

type Captured = Effect.Success<ReturnType<typeof captureAssetBasis>>;

type Event = typeof Subledgers.AssetValuationEvent.Type;

const counterfactualBasis = Effect.fn("subledger.counterfactualBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  state: Captured,
  events: ReadonlyArray<Event>,
) {
  const history = yield* Effect.forEach(
    yield* Schedules.readRevisions(tx, scope.bookId, input.scheduleId),
    (row) => decode(Subledgers.ScheduleRevision, row.body),
  );

  const first = history[0];

  if (!first || first.revision !== 1 || first.terms.kind !== "asset")
    return yield* failure("UnsupportedProfile");
  const original = history.find((revision) => revision.digest === state.basis.scheduleDigest);

  if (!original || original.amendment) return yield* failure("UnsupportedProfile");

  const firstValuationRevision = Math.min(
    ...state.impairments.map((event) => event.scheduleRevision),
    ...events.map((event) => event.scheduleRevision),
    21,
  );

  const eligible = history.filter(
    (revision) =>
      revision.revision < firstValuationRevision &&
      revision.createdAt.slice(0, 10) <= input.postingDate,
  );

  const withoutImpairment = eligible.at(-1) ?? original;

  if (
    eligible.some(
      (revision) =>
        revision.amendment &&
        !["future_dates_v1", "remaining_estimate_v1", "remaining_lifetime_v1"].includes(
          revision.amendment.kind,
        ),
    )
  )
    return yield* failure("UnsupportedProfile");

  const ordinary = withoutImpairment.occurrences
    .filter((row) => row.postingDate <= input.postingDate)
    .reduce(
      (sum, row) => sum + BigInt(row.amountMinor),
      BigInt(state.basis.input.accumulatedMinor),
    );

  const counterfactual = Valuation.calculateCounterfactual({
    assetId: input.scheduleId,
    grossMinor: state.basis.input.originalCostMinor,
    counterfactualOrdinaryMinor: ordinary.toString(),
    permittedRevisionRefs: [withoutImpairment.scheduleId],
    completeCostEvidence: true,
    policyRelease: input.policyRelease,
  });

  if (Result.isFailure(counterfactual)) return yield* failure("UnsupportedProfile");

  return { carrying: counterfactual.success, revisionDigest: withoutImpairment.digest };
});

const correctionChange = Effect.fn("subledger.correctionChange")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  state: Captured,
  events: ReadonlyArray<Event>,
) {
  const target = BigInt(input.targetCarryingMinor);
  const corrected = events.find((event) => event.id === input.correctionOf);

  const reviewRow = corrected
    ? (yield* Db.readReview(tx, scope.bookId, corrected.reviewId))[0]
    : undefined;

  if (!corrected || !reviewRow) return yield* failure("NotFound");
  const review = yield* decode(Controls.AssetValuationReview, reviewRow.body);

  const closed = (yield* Ledger.readAllPeriods(tx, scope.bookId)).some(
    (period) =>
      period.locked &&
      corrected.postingDate >= period.startsOn &&
      corrected.postingDate <= period.endsOn,
  );

  const consumed =
    corrected.kind === "error_correction" ||
    state.schedule.revision !== corrected.scheduleRevision ||
    events.at(-1)?.id !== corrected.id ||
    closed ||
    state.recognized.toString() !== review.basis.recognizedMinor ||
    events.some((event) => event.correctionOf === corrected.id);

  const correctable = Valuation.assertCorrectableEvent({
    eventId: corrected.id,
    consequencesConsumed: consumed,
    replacementScheduleComplete:
      input.installments.reduce(
        (sum, row) => sum + BigInt(row.amountMinor),
        BigInt(input.residualMinor),
      ) === target,
  });

  if (Result.isFailure(correctable)) return yield* failure("UnsupportedProfile");

  if (
    input.targetCarryingMinor !== review.basis.currentCarryingMinor ||
    input.incomeOrLossAccountId !== corrected.incomeOrLossAccountId ||
    input.accumulatedImpairmentAccountId !== corrected.accumulatedImpairmentAccountId
  )
    return yield* failure("InvalidJournal");

  return {
    direction: corrected.direction === "increase" ? ("decrease" as const) : ("increase" as const),
    magnitude: BigInt(corrected.magnitudeMinor),
  };
});

const assertValuationAccounts = Effect.fn("subledger.assertValuationAccounts")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  state: Captured,
) {
  const accounts = yield* Ledger.readAccounts(tx, scope.bookId, [
    input.accumulatedImpairmentAccountId,
  ]);

  const reserved = new Set(
    (yield* Assets.readReservedAccounts(tx, scope.bookId)).map((row) => row.id),
  );

  const roles = new Set([
    state.schedule.terms.debitAccountId,
    state.schedule.terms.creditAccountId,
    ...state.basis.lines.map((line) => line.accountId),
  ]);

  if (
    accounts.length !== 1 ||
    !accounts[0]?.active ||
    reserved.has(input.accumulatedImpairmentAccountId) ||
    roles.has(input.accumulatedImpairmentAccountId) ||
    roles.has(input.incomeOrLossAccountId) ||
    input.accumulatedImpairmentAccountId === input.incomeOrLossAccountId ||
    state.assetEffects.some(
      (event) => event.accumulatedImpairmentAccountId !== input.accumulatedImpairmentAccountId,
    )
  )
    return yield* failure("InvalidJournal");
});

const installmentPeriods = Effect.fn("subledger.valuationInstallmentPeriods")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
) {
  const periods = yield* Schedules.readPeriods(tx, scope.bookId, [
    ...new Set(input.installments.map((row) => row.accountingPeriodId)),
  ]);

  const years = yield* Ledger.readAllFiscalYears(tx, scope.bookId);

  let last =
    [(yield* isoNow(tx)).slice(0, 10), input.postingDate].sort().at(-1) ?? input.postingDate;

  for (const installment of input.installments) {
    const period = periods.find((row) => row.id === installment.accountingPeriodId);
    const year = years.find((row) => row.id === period?.fiscalYearId);

    if (
      !period ||
      !year ||
      !Accounting.isCalendarDate(installment.postingDate) ||
      installment.postingDate <= last ||
      installment.postingDate < period.startsOn ||
      installment.postingDate > period.endsOn ||
      period.startsOn < year.startsOn ||
      period.endsOn > year.endsOn
    )
      return yield* failure("InvalidJournal");

    if (period.locked) return yield* failure("PeriodLocked");
    last = installment.postingDate;
  }

  return periods.map((row) => ({
    id: row.id,
    fiscalYearId: row.fiscalYearId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    version: row.version,
  }));
});

export const valuationBasis = Effect.fn("subledger.valuationBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
) {
  const book = yield* readBook(tx, scope);
  const futurePeriods = yield* installmentPeriods(tx, scope, input);

  const state = yield* captureAssetBasis(tx, scope, {
    ...input,
    lossAccountId: input.incomeOrLossAccountId,
  });

  if (
    input.profile !== "synthetic_asset_valuation_v1" ||
    input.policyRelease !== "synthetic_without_impairment_v1" ||
    !(yield* readPostingBasis(tx, scope, state.schedule)).supported
  )
    return yield* failure("UnsupportedProfile");

  const events = yield* Effect.forEach(
    yield* Db.events(tx, scope.bookId, input.scheduleId),
    (row) => decode(Subledgers.AssetValuationEvent, row.body),
  );

  yield* assertValuationAccounts(tx, scope, input, state);
  const counterfactual = yield* counterfactualBasis(tx, scope, input, state, events);
  const target = BigInt(input.targetCarryingMinor);

  const basis = {
    assetId: input.scheduleId,
    grossMinor: state.basis.input.originalCostMinor,
    ordinaryAccumulationMinor: (
      BigInt(state.basis.input.accumulatedMinor) + state.recognized
    ).toString(),
    impairmentContraMinor: state.prior.toString(),
    owned: true,
    scheduleState: state.schedule.state ?? "active",
  };

  let direction: "increase" | "decrease";
  let magnitude: bigint;

  if (input.kind === "economic_reversal") {
    if (input.correctionOf !== null) return yield* failure("InvalidJournal");

    const compiled = Valuation.compileEconomicReversal({
      basis,
      decision: {
        assetId: input.scheduleId,
        kind: input.kind,
        assessmentOn: input.postingDate,
        targetCarryingMinor: input.targetCarryingMinor,
        counterfactualCarryingMinor: counterfactual.carrying,
        futureInstallmentsMinor: input.installments.map((row) => row.amountMinor),
        futureResidualMinor: input.residualMinor,
      },
      accumulatedImpairmentAccountId: input.accumulatedImpairmentAccountId,
      reversalIncomeAccountId: input.incomeOrLossAccountId,
    });

    if (Result.isFailure(compiled)) return yield* failure("InvalidJournal");
    direction = "decrease";
    magnitude = BigInt(compiled.success.reversalMinor);
  } else if (input.kind === "full_impairment") {
    if (
      input.correctionOf !== null ||
      target !== 0n ||
      input.residualMinor !== "0" ||
      input.installments.length !== 0
    )
      return yield* failure("InvalidJournal");

    const compiled = Valuation.compileZeroCarryingDecision({
      basis,
      qualifiedWriteDown: true,
      impairmentLossAccountId: input.incomeOrLossAccountId,
      accumulatedImpairmentAccountId: input.accumulatedImpairmentAccountId,
    });

    if (Result.isFailure(compiled)) return yield* failure("InvalidJournal");
    direction = "increase";
    magnitude = BigInt(compiled.success.writeDownMinor);
  } else {
    ({ direction, magnitude } = yield* correctionChange(tx, scope, input, state, events));
  }

  const net = state.prior + (direction === "increase" ? magnitude : -magnitude);

  if (
    magnitude <= 0n ||
    net < 0n ||
    state.carrying + (direction === "increase" ? -magnitude : magnitude) !== target ||
    input.installments.reduce(
      (sum, row) => sum + BigInt(row.amountMinor),
      BigInt(input.residualMinor),
    ) !== target ||
    (target > 0n && input.installments.length === 0)
  )
    return yield* failure("InvalidJournal");

  return yield* decode(Controls.AssetValuationBasis, {
    installmentPeriods: futurePeriods,
    profileWitness: {
      profile: book.profile,
      profileVersion: book.profileVersion.toString(),
      writerEpoch: book.writerEpoch.toString(),
      authority: book.authority,
      policyRelease: input.policyRelease,
    },
    schedule: state.schedule,
    carryingBasis: state.basis,
    occurrences: state.occurrences,
    currentCarryingMinor: state.carrying.toString(),
    recognizedMinor: state.recognized.toString(),
    netImpairmentMinor: state.prior.toString(),
    counterfactualCarryingMinor: counterfactual.carrying,
    counterfactualRevisionDigests: [counterfactual.revisionDigest],
    sourceSha256: state.source.sha256,
    reviewSha256: state.review.sha256,
    direction,
    magnitudeMinor: magnitude.toString(),
    resultingImpairmentMinor: net.toString(),
    state: target === 0n ? "zero_carrying_in_use" : "active",
  });
});

export const checkedValuation = Effect.fn("subledger.checkedValuation")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest: string,
) {
  const row = (yield* Db.readReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* decode(Controls.AssetValuationReview, row.body);

  if (
    review.digest !== expectedDigest ||
    (yield* digest(yield* valuationBasis(tx, scope, review.input))) !==
      (yield* digest(review.basis))
  )
    return yield* failure("StaleDependency");

  return review;
});

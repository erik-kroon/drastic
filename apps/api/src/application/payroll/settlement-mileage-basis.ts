import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Runs from "@open-erp/contracts/payroll-runs";
import { calculateMileage, correctTripAward } from "@open-erp/domain/mileage-reimbursement";
import * as Db from "../../db/payroll/mileage-corrections";
import * as InputDb from "../../db/payroll/inputs";
import * as SettlementDb from "../../db/payroll/settlements";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope, type Principal } from "../commerce/support";
import { readSourceBytesInTransaction } from "../source-retention";
import { digest } from "../json";
import { newId } from "../identifiers";
import { failure } from "../failures";
import { checkedInput } from "./inputs";
import { verifyVoucher } from "./settlement-ledger";
import { captureCalculationBasis } from "./calculations";
import { correctionPopulation, correctedMileageSnapshots } from "./paid-correction-population";
import { readMileageRecord } from "./mileage-correction-records";
import { seal, persist } from "./settlement-support";

type Blocker = typeof Mileage.MileageCorrectionBlocker.Type;

type Input = typeof Mileage.PrepareMileageCorrection.Type;

function blocked(
  blockers: Blocker[],
  code: string,
  message: string,
  sourceRef: string | null = null,
) {
  blockers.push({ code, message, sourceRef });
}

const source = Effect.fn("mileage.source")(function* (
  tx: Transaction,
  scope: Scope,
  selection: typeof Mileage.MileageSourceSelection.Type | null,
  code: string,
  blockers: Blocker[],
) {
  if (selection === null) {
    blocked(blockers, code, "Retain and select the exact supporting source.");

    return null;
  }

  const result = yield* Effect.result(
    readSourceBytesInTransaction(tx, scope, selection.occurrenceId),
  );

  if (Result.isFailure(result)) {
    if (
      !["NotFound", "MissingEvidence", "Unavailable", "UnsupportedProfile"].includes(
        "code" in result.failure ? result.failure.code : "",
      )
    )
      return yield* result.failure;

    blocked(blockers, code, "The selected original bytes are unavailable.", selection.occurrenceId);

    return null;
  }

  if (result.success.occurrence.sha256 !== selection.sha256)
    blocked(
      blockers,
      "SourceHashMismatch",
      "The selected source hash changed.",
      selection.occurrenceId,
    );

  return result.success.occurrence;
});

const originalRecognition = Effect.fn("mileage.originalRecognition")(function* (
  tx: Transaction,
  scope: Scope,
  inputId: string,
) {
  for (const row of yield* InputDb.readExecutions(tx, scope.bookId, inputId)) {
    const execution = yield* decode(Inputs.PayrollInputExecution, row.body);

    if (execution.kind !== "recognition") continue;

    const reviewRow = (yield* InputDb.readReview(tx, scope.bookId, execution.reviewId))[0];

    if (!reviewRow) return yield* failure("StaleDependency");

    const review = yield* decode(Inputs.PayrollInputReview, reviewRow.body);

    yield* verifyVoucher(tx, scope, review.postingPlan, execution.postingReceipt.voucherId);

    return { execution, review };
  }

  return null;
});

const predecessor = Effect.fn("mileage.predecessor")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  originalTrip: typeof Mileage.MileageCorrectionOriginal.Type.trip,
  originalSplit: NonNullable<typeof Mileage.MileageCorrectionOriginal.Type.split>,
  blockers: Blocker[],
) {
  const edges = yield* Db.successors(tx, scope.bookId, input.originalInputId);

  if (edges.length > 100) return yield* failure("UnsupportedProfile");

  const parents = new Set(edges.map((row) => row.previousExecutionId));
  const tips = edges.filter((row) => !parents.has(row.executionId));
  const tip = tips[0];

  if (tips.length > 1) return yield* failure("StaleDependency");

  if ((tip?.executionId ?? null) !== input.previousCorrectionExecutionId)
    blocked(blockers, "StalePredecessor", "Prepare from the current executed mileage revision.");

  if (!tip) return { trip: originalTrip, split: originalSplit, executionId: null };

  const proposal = yield* readMileageRecord(
    tx,
    scope,
    "payroll_mileage_correction_proposals",
    tip.proposalId,
    Mileage.MileageCorrectionProposal,
  );

  if (!proposal.comparison) return yield* failure("StaleDependency");

  return {
    trip: proposal.input.revisedTrip,
    split: proposal.comparison.revisedSplit,
    executionId: tip.executionId,
  };
});

const contributionWitness = Effect.fn("mileage.contributionWitness")(function* (
  captured: Effect.Success<ReturnType<typeof captureCalculationBasis>>,
  paid: typeof Settlement.PaidPayrollEvent.Type,
) {
  const selected = captured.prepared.employment.pensionAndOtherObligations
    .filter((row) => row.state === "applicable")
    .map((row) => row.selection.profileId);

  const profiles = captured.release.obligationProfiles.filter(
    (row) => row.obligationKind === "employer_contribution" && selected.includes(row.profileId),
  );

  const profile = profiles[0];

  if (profiles.length !== 1 || !profile) return yield* failure("UnsupportedProfile");

  return {
    ruleReleaseId: captured.basis.ruleReleaseId,
    ruleReleaseChecksum: captured.basis.ruleReleaseChecksum,
    calculatorVersion: captured.basis.calculatorVersion,
    profileId: profile.profileId,
    obligationReference: profile.obligationReference,
    bands: profile.bands,
    rounding: profile.rounding,
    openingBaseMinor: captured.basis.openingBaseMinor,
    originalBaseMinor: paid.contributionBaseMinor,
    revisedBaseMinor: captured.calculated.contributionBaseMinor,
    originalContributionMinor: paid.employerContributionMinor,
    revisedContributionMinor: captured.calculated.employerContributionMinor,
  };
});

type SubmittedMileage = typeof Inputs.PayrollInput.Type;

type MileageBasis = Extract<SubmittedMileage["input"]["basis"], { kind: "mileage" }>;

const paidQualification = Effect.fn("mileage.paidQualification")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: SubmittedMileage,
  blockers: Blocker[],
) {
  const recognition = yield* originalRecognition(tx, scope, submitted.id);
  const originalSplit = recognition?.review.outputs.mileage ?? null;
  const consumed = (yield* InputDb.readConsumption(tx, scope.bookId, submitted.id))[0];

  const paidRow = consumed
    ? (yield* SettlementDb.readPaidEmployee(
        tx,
        scope.bookId,
        consumed.runId,
        submitted.input.employeeId,
      ))[0]
    : null;

  const paid = paidRow ? yield* decode(Settlement.PaidPayrollEvent, paidRow.body) : null;

  if (!recognition || !originalSplit)
    blocked(
      blockers,
      "RecognitionMissing",
      "The original mileage award has no executed recognition.",
    );

  if (!paid)
    blocked(
      blockers,
      "PaidSourceMissing",
      "The mileage input must be consumed by an actually evidenced paid payroll run.",
    );

  const snapshot = paid?.originalEmployee.calculation.basis.payrollInputs?.find(
    (row) => row.inputId === submitted.id,
  );

  if (
    paid &&
    (!snapshot ||
      snapshot.inputDigest !== submitted.digest ||
      snapshot.executionId !== recognition?.execution.id ||
      snapshot.grossMinor !== originalSplit?.taxablePartMinor ||
      snapshot.reimbursementMinor !== originalSplit?.exemptPaidPartMinor)
  )
    blocked(
      blockers,
      "PaidSourceMismatch",
      "The paid run did not consume this exact retained mileage award.",
    );

  return { recognition, originalSplit, consumed, paid };
});

const routeSources = Effect.fn("mileage.routeSources")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  submitted: SubmittedMileage,
  blockers: Blocker[],
) {
  const originalRoute = yield* source(
    tx,
    scope,
    input.originalRouteSource,
    "OriginalRouteEvidenceMissing",
    blockers,
  );

  const revisedRoute = yield* source(
    tx,
    scope,
    input.routeSource,
    "RouteEvidenceMissing",
    blockers,
  );

  const recoveryBasis = yield* source(
    tx,
    scope,
    input.recoveryBasisSource,
    "RecoveryBasisMissing",
    blockers,
  );

  if (originalRoute && originalRoute.sha256 !== `sha256:${submitted.input.evidence.sha256}`)
    blocked(
      blockers,
      "OriginalSourceMismatch",
      "Original route bytes must match the recognized input evidence.",
      originalRoute.id,
    );

  if (revisedRoute && input.revisedTrip.routeEvidenceRef !== revisedRoute.id)
    blocked(
      blockers,
      "RouteSourceMismatch",
      "The revised trip must reference the selected retained route source.",
      revisedRoute.id,
    );

  if (!input.recoveryReason)
    blocked(
      blockers,
      "RecoveryBasisMissing",
      "Retain the explicit reason for the lawful recovery basis.",
    );

  return { originalRoute, revisedRoute, recoveryBasis, recoveryReason: input.recoveryReason };
});

const revisedAward = Effect.fn("mileage.revisedAward")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  submitted: SubmittedMileage,
  basis: MileageBasis,
  originalSplit: typeof Mileage.MileageCorrectionOriginal.Type.split,
  recoveryBasis: typeof Mileage.MileageCorrectionProposal.Type.sources.recoveryBasis,
  blockers: Blocker[],
) {
  const predecessorBasis = originalSplit
    ? yield* predecessor(tx, scope, input, basis.trip, originalSplit, blockers)
    : null;

  const calculated = calculateMileage({ trip: input.revisedTrip, release: basis.release });

  if (Result.isFailure(calculated))
    blocked(blockers, calculated.failure.code, calculated.failure.message);

  if (
    input.revisedTrip.claimantId !== submitted.input.employeeId ||
    input.revisedTrip.reference !== basis.trip.reference ||
    input.revisedTrip.departureOn !== basis.trip.departureOn ||
    input.revisedTrip.arrivalOn !== basis.trip.arrivalOn ||
    input.revisedTrip.origin !== basis.trip.origin ||
    input.revisedTrip.destination !== basis.trip.destination
  )
    blocked(
      blockers,
      "TripIdentityMismatch",
      "The revision must describe the same employee and economic trip.",
    );

  if (predecessorBasis) {
    const corrected = correctTripAward({
      plan: {
        awardId: submitted.id,
        tripRevisionId: predecessorBasis.trip.id,
        ruleReleaseId: basis.release.releaseId,
        split: predecessorBasis.split,
        exemptSourceIdentity: `${submitted.id}-exempt`,
        taxableSourceIdentity: `${submitted.id}-taxable`,
        payoutRoute: "payroll",
        payrollProfilePresent: true,
      },
      revisedTrip: input.revisedTrip,
      release: basis.release,
      handoffConsumed: true,
      lawfulRecoveryBasis: recoveryBasis?.id ?? null,
      correctionId: input.revisedTrip.id,
    });

    if (Result.isFailure(corrected))
      blocked(blockers, corrected.failure.code, corrected.failure.message);
  }

  return { predecessorBasis, calculated };
});

const postingBasis = Effect.fn("mileage.postingBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  basis: MileageBasis,
  blockers: Blocker[],
) {
  const accounts = yield* Ledger.readAccounts(tx, scope.bookId, [
    input.recoveryReceivableAccountId,
    basis.expenseAccountId,
    basis.taxableExpenseAccountId,
  ]);

  const period = (yield* Ledger.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];

  if (
    accounts.length !== 3 ||
    accounts.some((row) => !row.active) ||
    new Set(accounts.map((row) => row.id)).size !== 3
  )
    blocked(
      blockers,
      "AccountUnavailable",
      "Select distinct active original expense and employee recovery accounts.",
    );

  if (
    !period ||
    period.locked ||
    input.postingDate < period.startsOn ||
    input.postingDate > period.endsOn
  )
    blocked(
      blockers,
      "PeriodUnavailable",
      "Choose an open adjustment period containing the posting date.",
    );

  return { accounts, period };
});

const originalHistory = Effect.fn("mileage.originalHistory")(function* (
  tx: Transaction,
  scope: Scope,
  paid: typeof Settlement.PaidPayrollEvent.Type | null,
) {
  const payslips = [];
  const declarations = [];

  if (paid) {
    for (const row of yield* Db.originalPayslips(tx, scope.bookId, paid.runId, paid.employeeId)) {
      const document = yield* decode(Runs.PayrollPayslipDocument, row.body);

      const artifact = row.artifact
        ? yield* decode(Runs.PayrollPayslipArtifact, row.artifact)
        : null;

      payslips.push({
        documentId: document.id,
        documentDigest: document.digest,
        artifactId: artifact?.id ?? null,
        sha256: artifact ? `sha256:${artifact.sha256}` : null,
      });
    }

    for (const row of yield* Db.periodHistory(tx, scope.bookId, paid.reportingPeriod)) {
      const declaration = yield* decode(Settlement.PayrollPeriod, row.body);

      declarations.push({
        id: declaration.id,
        digest: declaration.digest,
        reportingPeriod: declaration.reportingPeriod,
      });
    }
  }

  return { payslips, declarations };
});

function retainedOriginal(
  submitted: SubmittedMileage,
  basis: MileageBasis,
  qualification: Effect.Success<ReturnType<typeof paidQualification>>,
  history: Effect.Success<ReturnType<typeof originalHistory>>,
) {
  const { recognition, originalSplit, consumed, paid } = qualification;
  const { payslips, declarations } = history;

  const original = {
    reference: basis.trip.reference ?? basis.trip.id,
    trip: basis.trip,
    split: originalSplit,
    release: basis.release,
    inputId: submitted.id,
    inputDigest: submitted.digest,
    recognitionReviewId: recognition?.review.id ?? null,
    recognitionExecutionId: recognition?.execution.id ?? null,
    recognitionVoucherId: recognition?.execution.postingReceipt.voucherId ?? null,
    consumedRunId: consumed?.runId ?? null,
    paidEventId: paid?.id ?? null,
    paidEventDigest: paid?.digest ?? null,
    paidOn: paid?.paidOn ?? null,
    earningsPeriod: paid?.originalEmployee.calculation.calculation.earningsPeriod ?? null,
    reportingPeriod: paid?.reportingPeriod ?? null,
    runId: paid?.runId ?? null,
    runDigest: paid?.originalRun.digest ?? null,
    payslips,
    declarations,
  };

  const employee = {
    id: submitted.input.employeeId,
    personRef:
      paid?.originalEmployee.calculation.basis.reviewedInput.employment.employeeId ??
      submitted.input.employeeId,
  };

  if (paid)
    employee.personRef =
      paid.originalRun.employees.find((row) => row.calculation.employeeId === employee.id)
        ?.personRef ?? employee.id;

  return { original, employee };
}

export const captureMileageCorrection = Effect.fn("mileage.capture")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
) {
  const submitted = yield* checkedInput(
    tx,
    scope,
    input.originalInputId,
    input.originalInputDigest,
  );

  if (submitted.input.basis.kind !== "mileage" || submitted.input.recordClass !== "synthetic")
    return yield* failure("UnsupportedProfile");

  const basis = submitted.input.basis;
  const blockers: Blocker[] = [];
  const qualification = yield* paidQualification(tx, scope, submitted, blockers);
  const { recognition, originalSplit, consumed, paid } = qualification;

  const { originalRoute, revisedRoute, recoveryBasis } = yield* routeSources(
    tx,
    scope,
    input,
    submitted,
    blockers,
  );

  const { predecessorBasis, calculated } = yield* revisedAward(
    tx,
    scope,
    input,
    submitted,
    basis,
    originalSplit,
    recoveryBasis,
    blockers,
  );

  const { accounts, period } = yield* postingBasis(tx, scope, input, basis, blockers);
  const book = (yield* Ledger.readBook(tx, scope))[0];

  const population = paid ? yield* correctionPopulation(tx, scope, paid) : null;

  if (population?.instructions.some((row) => row.netRecovery === undefined))
    blocked(
      blockers,
      "UnsupportedRecoveryPopulation",
      "Existing future gross instructions require their own qualified correction path.",
    );

  const { original, employee } = retainedOriginal(
    submitted,
    basis,
    qualification,
    yield* originalHistory(tx, scope, paid),
  );

  return {
    submitted,
    basis,
    blockers,
    recognition,
    paid,
    original,
    employee,
    predecessor: predecessorBasis,
    revisedSplit: Result.isSuccess(calculated) ? calculated.success : null,
    population,
    sources: { originalRoute, revisedRoute, recoveryBasis, recoveryReason: input.recoveryReason },
    accounts,
    period,
    dependencyDigest: yield* digest({
      originalInput: submitted.digest,
      recognition: recognition?.execution.id ?? null,
      consumed: consumed?.runId ?? null,
      paid: paid?.digest ?? null,
      predecessor: predecessorBasis,
      population: population?.digest ?? null,
      sources: [originalRoute, revisedRoute, recoveryBasis],
      accounts: accounts.map((account) => ({ ...account, version: account.version.toString() })),
      period: period ? { ...period, version: period.version.toString() } : null,
      book: book
        ? {
            id: book.id,
            profile: book.profile,
            profileVersion: book.profileVersion.toString(),
            writerEpoch: book.writerEpoch.toString(),
            authority: book.authority,
          }
        : null,
      input,
    }),
  };
});

export const prepareMileageComparison = Effect.fn("mileage.prepareComparison")(function* (
  tx: Transaction,
  scope: Scope,
  principal: Principal,
  key: string,
  captured: Effect.Success<ReturnType<typeof captureMileageCorrection>>,
) {
  const { paid, population, revisedSplit, predecessor: previous } = captured;

  if (!paid || !population || !revisedSplit || !previous || captured.blockers.length) return null;

  const entitlementDelta =
    BigInt(revisedSplit.entitlementMinor) - BigInt(previous.split.entitlementMinor);

  const taxableDelta =
    BigInt(revisedSplit.taxablePartMinor) - BigInt(previous.split.taxablePartMinor);

  const exemptDelta =
    BigInt(revisedSplit.exemptPaidPartMinor) - BigInt(previous.split.exemptPaidPartMinor);

  if (entitlementDelta >= 0n || taxableDelta > 0n || exemptDelta > 0n) {
    blocked(
      captured.blockers,
      "UnsupportedCorrectionDirection",
      "This recovery profile requires a reduced entitlement with nonincreasing components.",
    );

    return null;
  }

  const mileageCorrections = [
    ...population.mileageCorrections.filter((row) => row.originalInputId !== captured.submitted.id),
    {
      originalInputId: captured.submitted.id,
      originalInputDigest: captured.submitted.digest,
      split: revisedSplit,
    },
  ].sort((left, right) => left.originalInputId.localeCompare(right.originalInputId));

  const input =
    population.latestComparison?.input ?? paid.originalEmployee.calculation.basis.reviewedInput;

  const calculation = yield* Effect.result(
    captureCalculationBasis(tx, scope, input, {
      kind: "paid_comparison",
      originalBasis: paid.originalEmployee.calculation.basis,
      mileageInputs: correctedMileageSnapshots(paid, mileageCorrections),
    }),
  );

  if (Result.isFailure(calculation)) {
    if (
      !["NotFound", "UnsupportedProfile", "StaleDependency", "MissingEvidence"].includes(
        "code" in calculation.failure ? calculation.failure.code : "",
      )
    )
      return yield* calculation.failure;

    blocked(
      captured.blockers,
      "PayrollQualificationMissing",
      "The paid payroll basis needs current source and rule qualification.",
    );

    return null;
  }

  const calculated = calculation.success;

  if (
    calculated.basis.ruleReleaseId !== paid.originalEmployee.calculation.basis.ruleReleaseId ||
    calculated.basis.ruleReleaseChecksum !==
      paid.originalEmployee.calculation.basis.ruleReleaseChecksum ||
    calculated.basis.openingBaseMinor !== paid.originalEmployee.calculation.basis.openingBaseMinor
  )
    return yield* failure("StaleDependency");

  const comparison = yield* seal(
    tx,
    scope,
    principal,
    "payroll_prepare_mileage_correction",
    key,
    Settlement.CorrectionComparison,
    {
      id: newId("payroll_comparison"),
      kind: "paid_correction_comparison",
      paidEventId: paid.id,
      input,
      originalPaidDigest: paid.digest,
      basis: calculated.basis,
      calculation: calculated.calculated,
      grossDeltaMinor: (
        BigInt(calculated.calculated.grossMinor) - BigInt(paid.grossCashMinor)
      ).toString(),
      contributionDeltaMinor: (
        BigInt(calculated.calculated.employerContributionMinor) -
        BigInt(paid.employerContributionMinor)
      ).toString(),
      correctionPopulationDigest: population.digest,
      mileageCorrections,
      noFinancialEffect: true,
    },
  );

  yield* persist(tx, "payroll_correction_comparisons", comparison);

  const priorContribution = population.corrections
    .filter((row) => row.kind === "gross_recovery")
    .reduce((sum, row) => sum + BigInt(row.contributionDeltaMinor), 0n);

  return {
    originalDistanceMeters: captured.basis.trip.distanceInMeters,
    predecessorDistanceMeters: previous.trip.distanceInMeters,
    revisedDistanceMeters: captured.revisedSplit
      ? captured.revisedSplit.distanceUnitsNumerator
      : "0",
    distanceDeltaMeters: (
      BigInt(revisedSplit.distanceUnitsNumerator) - BigInt(previous.trip.distanceInMeters)
    ).toString(),
    originalSplit: captured.original.split ?? previous.split,
    predecessorSplit: previous.split,
    revisedSplit,
    entitlementDeltaMinor: entitlementDelta.toString(),
    exemptDeltaMinor: exemptDelta.toString(),
    taxableDeltaMinor: taxableDelta.toString(),
    paidComparisonId: comparison.id,
    paidComparisonDigest: comparison.digest,
    contributionCorrectionMinor: (
      BigInt(comparison.contributionDeltaMinor) - priorContribution
    ).toString(),
    contributionIncludedInJournal: false as const,
    contributionWitness: yield* contributionWitness(calculated, paid),
  };
});

export function mileageJournal(
  input: Input,
  captured: Effect.Success<ReturnType<typeof captureMileageCorrection>>,
  comparison: typeof Mileage.MileageCorrectionComparison.Type | null,
) {
  if (!comparison) return null;

  const receivable = (-BigInt(comparison.entitlementDeltaMinor)).toString();

  const rows = [
    { accountId: input.recoveryReceivableAccountId, debitMinor: receivable, creditMinor: "0" },
    {
      accountId: captured.basis.expenseAccountId,
      debitMinor: "0",
      creditMinor: (-BigInt(comparison.exemptDeltaMinor)).toString(),
    },
    {
      accountId: captured.basis.taxableExpenseAccountId,
      debitMinor: "0",
      creditMinor: (-BigInt(comparison.taxableDeltaMinor)).toString(),
    },
  ].filter((row) => row.debitMinor !== "0" || row.creditMinor !== "0");

  return {
    lines: rows.map((row) => ({
      ...row,
      accountCode: captured.accounts.find((account) => account.id === row.accountId)?.code ?? "",
      accountName: captured.accounts.find((account) => account.id === row.accountId)?.name ?? "",
    })),
    debitMinor: receivable,
    creditMinor: receivable,
    receivableMinor: receivable,
    claimedGrossMinor: (-BigInt(comparison.taxableDeltaMinor)).toString(),
  };
}

export const currentMileageProposal = Effect.fn("mileage.currentProposal")(function* (
  tx: Transaction,
  scope: Scope,
  proposal: typeof Mileage.MileageCorrectionProposal.Type,
) {
  const captured = yield* captureMileageCorrection(tx, scope, proposal.input);

  if (
    captured.dependencyDigest !== proposal.dependencyDigest ||
    captured.blockers.length ||
    !proposal.comparison ||
    !proposal.journal
  )
    return yield* failure("StaleDependency");

  return captured;
});

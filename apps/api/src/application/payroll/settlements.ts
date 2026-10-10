import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Domain from "@open-erp/domain/payroll-runs";
import * as Recovery from "@open-erp/domain/paid-payroll-recovery";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/payroll/settlements";
import * as Ledger from "../../db/posting";
import * as Foundation from "../../db/payroll-foundation";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  readEvidenceReference,
  toJsonObject,
  withBook,
  type Scope,
  type Principal,
} from "../commerce/support";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  prepareJournalInTransaction,
} from "../posting";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { failure } from "../failures";
import { addMatch } from "../banking/matches";
import { captureCalculationBasis } from "./calculations";
import { correctionPopulation, correctedMileageSnapshots } from "./paid-correction-population";
import { requireMileageSubmission, recordMileageSuccessor } from "./mileage-correction-lifecycle";
import { readMileageRecord } from "./mileage-correction-records";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import { compileSettlement, validateComparison } from "./settlement-basis";
import { claimOffsetComparison } from "./settlement-net-recovery";
import {
  readRetained,
  requireSettlementAccess,
  seal,
  persist,
  claimBalance,
  ClaimRecord,
  InstructionRecord,
  AllocationRecord,
  ReportingCorrection,
  type RetainedFields,
} from "./settlement-support";
import { authorizePresent } from "../authority";

export { preparePeriod, getPeriod } from "./settlement-periods";

export { cancelAdjustmentInstruction } from "./settlement-instruction-lifecycle";

import {
  requireInstructionAuthority,
  netInstructionState,
} from "./settlement-instruction-lifecycle";

type SettlementPostingOwner = {
  readonly kind: "payroll_payment" | "payroll_recovery";
  readonly id: string;
};

type Command<I> = { readonly scope: Scope; readonly idempotencyKey: string; readonly input: I };

function owner(review: typeof Settlement.SettlementReview.Type): SettlementPostingOwner {
  return {
    kind: review.input.kind === "gross_recovery" ? "payroll_recovery" : "payroll_payment",
    id: review.id,
  };
}

const currentReview = Effect.fn("payroll.currentSettlementReview")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
) {
  const review = yield* readRetained(
    tx,
    scope,
    "payroll_settlement_reviews",
    id,
    Settlement.SettlementReview,
  );

  if (expectedDigest !== undefined && expectedDigest !== review.digest)
    return yield* failure("StaleDependency");

  if ((yield* Db.readReviewExecution(tx, scope.bookId, id)).length)
    return yield* failure("AlreadyPosted");
  const compiled = yield* compileSettlement(tx, scope, review.input);

  for (const field of [
    "reportingReplacement",
    "originalRun",
    "paidEvent",
    "comparison",
    "lawfulBasis",
    "claim",
    "cash",
    "capacityDigest",
    "economicKey",
    "outputs",
  ] as const)
    if (!equalJson(compiled[field], review[field])) return yield* failure("StaleDependency");
  const planLines = review.postingPlan?.groups[0]?.actions[0]?.lines ?? [];

  if (
    !equalJson(
      planLines.map(({ accountId, debitMinor, creditMinor, description }) => ({
        accountId,
        debitMinor,
        creditMinor,
        description,
      })),
      compiled.lines,
    )
  )
    return yield* failure("StaleDependency");

  return review;
});

function capacityKeys(review: typeof Settlement.SettlementReview.Type) {
  const keys = [review.economicKey];

  if (review.cash) keys.push(`cash:${review.cash.statementId}:${review.cash.rowOrdinal}`);

  if (review.paidEvent) keys.push(`compensation:${review.paidEvent.id}`);

  if (review.claim) keys.push(`claim:${review.claim.id}`);

  return [...new Set(keys)];
}

const requireCapacity = Effect.fn("payroll.requireSettlementCapacity")(function* (
  tx: Transaction,
  review: typeof Settlement.SettlementReview.Type,
) {
  for (const key of capacityKeys(review)) {
    const reserved = yield* Db.readCapacityReservations(tx, review.scope.bookId, key);

    if (reserved.some((row) => row.reviewId !== review.id)) return yield* failure("AlreadyPosted");
  }
});

export const prepareComparison = Effect.fn("payroll.preparePaidComparison")(function* (
  token: string,
  command: Command<typeof Calculations.PreparePayRun.Type> & { readonly paidEventId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireSettlementAccess(tx, command.scope, principal.actorId, true);
      const operation = "payroll_prepare_comparison";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { paidEventId: command.paidEventId, input: command.input },
        Settlement.CorrectionComparison,
      );

      if (request.previous) return request.previous;

      const paid = yield* readRetained(
        tx,
        command.scope,
        "payroll_paid_events",
        command.paidEventId,
        Settlement.PaidPayrollEvent,
      );

      const original = paid.originalEmployee.calculation;

      if (
        command.input.recordClass !== "synthetic" ||
        command.input.employment.employeeId !== paid.employeeId ||
        !equalJson(command.input.work.earningsPeriod, original.basis.earningsPeriod) ||
        command.input.work.expectedPaymentOn !== original.basis.expectedPaymentOn ||
        !equalJson(
          (command.input.adjustmentIds ?? []).slice().sort(),
          (original.basis.adjustmentInstructions ?? []).map((row) => row.id).sort(),
        )
      )
        return yield* failure("UnsupportedProfile");

      const population = yield* correctionPopulation(tx, command.scope, paid);

      const captured = yield* captureCalculationBasis(tx, command.scope, command.input, {
        kind: "paid_comparison",
        originalBasis: original.basis,
        mileageInputs: correctedMileageSnapshots(paid, population.mileageCorrections),
      });

      if (
        captured.basis.ruleReleaseId !== original.basis.ruleReleaseId ||
        captured.basis.ruleReleaseChecksum !== original.basis.ruleReleaseChecksum ||
        captured.basis.openingBaseMinor !== original.basis.openingBaseMinor
      )
        return yield* failure("StaleDependency");

      const result = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Settlement.CorrectionComparison,
        {
          id: newId("payroll_comparison"),
          kind: "paid_correction_comparison",
          input: command.input,
          paidEventId: paid.id,
          originalPaidDigest: paid.digest,
          basis: captured.basis,
          calculation: captured.calculated,
          grossDeltaMinor: (
            BigInt(captured.calculated.grossMinor) - BigInt(paid.grossCashMinor)
          ).toString(),
          contributionDeltaMinor: (
            BigInt(captured.calculated.employerContributionMinor) -
            BigInt(paid.employerContributionMinor)
          ).toString(),
          noFinancialEffect: true,
          correctionPopulationDigest: population.digest,
          mileageCorrections: population.mileageCorrections,
        },
      );

      yield* persist(tx, "payroll_correction_comparisons", result);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const recordAdjustmentBasis = Effect.fn("payroll.recordAdjustmentBasis")(function* (
  token: string,
  command: Command<typeof Settlement.RecordAdjustmentBasis.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireSettlementAccess(tx, command.scope, principal.actorId, true);
      const operation = "payroll_record_adjustment_basis";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Settlement.AdjustmentBasis,
      );

      if (request.previous) return request.previous;

      const { comparison } = command.input.recoveryClaimId
        ? yield* claimOffsetComparison(
            tx,
            command.scope,
            command.input.recoveryClaimId,
            command.input.comparisonId,
          )
        : yield* validateComparison(tx, command.scope, command.input.comparisonId);

      if (command.input.recoveryClaimId && command.input.kind !== "future_pay")
        return yield* failure("UnsupportedProfile");

      if (comparison.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

      const evidence = yield* readEvidenceReference(
        tx,
        command.scope.bookId,
        command.input.evidenceId,
      );

      const result = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Settlement.AdjustmentBasis,
        {
          id: newId("payroll_adjustment_basis"),
          input: command.input,
          comparisonDigest: comparison.digest,
          evidence,
          qualification: "synthetic_only",
        },
      );

      yield* persist(tx, "payroll_adjustment_bases", result);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const prepareSettlementInTransaction = Effect.fn("payroll.prepareSettlementInTransaction")(
  function* (
    tx: Transaction,
    principal: Principal,
    command: Command<typeof Settlement.PrepareSettlement.Type>,
  ) {
    yield* requireSettlementAccess(tx, command.scope, principal.actorId, true);
    const operation = "payroll_prepare_settlement";

    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      command.input,
      Settlement.SettlementReview,
    );

    if (request.previous) return request.previous;
    const compiled = yield* compileSettlement(tx, command.scope, command.input);
    const id = newId("payroll_settlement_review");

    const postingPlan = compiled.lines.length
      ? yield* prepareJournalInTransaction(tx, principal, {
          scope: command.scope,
          idempotencyKey: `${id}_plan`,
          input: {
            kind: "manual_journal",
            evidenceId: command.input.evidenceId,
            eventKey: id,
            accountingPeriodId: command.input.accountingPeriodId,
            postingDate: command.input.postingDate,
            series: command.input.series,
            description: "Reviewed synthetic payroll settlement or adjustment",
            rationale: command.input.reason,
            taxAssessment: "not_applicable",
            lines: compiled.lines,
          },
        })
      : null;

    const basis = {
      reportingReplacement: compiled.reportingReplacement,
      originalRun: compiled.originalRun,
      paidEvent: compiled.paidEvent,
      comparison: compiled.comparison,
      lawfulBasis: compiled.lawfulBasis,
      claim: compiled.claim,
      cash: compiled.cash,
      capacityDigest: compiled.capacityDigest,
      economicKey: compiled.economicKey,
      outputs: compiled.outputs,
    };

    const result = yield* seal(
      tx,
      command.scope,
      principal,
      operation,
      command.idempotencyKey,
      Settlement.SettlementReview,
      { ...basis, id, input: command.input, postingPlan },
    );

    yield* Db.insertReview(tx, result, postingPlan?.groups[0]?.actions[0]?.eventId ?? null);
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(result),
    );

    return result;
  },
);

export const prepareSettlement = Effect.fn("payroll.prepareSettlement")(function* (
  token: string,
  command: Command<typeof Settlement.PrepareSettlement.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      return yield* prepareSettlementInTransaction(tx, principal, command);
    },
    "update",
  );
});

export const approveSettlement = Effect.fn("payroll.approveSettlement")(function* (
  token: string,
  command: Command<typeof Settlement.ApproveSettlement.Type> & { readonly reviewId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireSettlementAccess(tx, command.scope, principal.actorId, true);
      const operation = "payroll_approve_settlement";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { reviewId: command.reviewId, input: command.input },
        Settlement.SettlementApproval,
      );

      if (request.previous) return request.previous;

      const review = yield* currentReview(
        tx,
        command.scope,
        command.reviewId,
        command.input.reviewDigest,
      );

      yield* requireCapacity(tx, review);

      yield* requireMileageSubmission(tx, command.scope, review, principal.actorId);

      if (!review.postingPlan && review.input.kind !== "reporting_only") {
        yield* authorizePresent(
          tx,
          principal,
          command.scope,
          "approve_payroll_settlement_instruction",
          {
            idempotencyKey: command.idempotencyKey,
            id: command.reviewId,
            input: yield* toJsonObject(command.input),
          },
        );
        yield* requireInstructionAuthority(tx, command.scope, review, principal.actorId);
      }

      const kernel = review.postingPlan
        ? yield* approveChangeInTransaction(tx, principal, {
            scope: command.scope,
            changeSetId: review.postingPlan.id,
            idempotencyKey: `${command.idempotencyKey}_approval`,
            owner: owner(review),
            input: { version: 1, planDigest: review.postingPlan.planDigest },
          })
        : null;

      const now = yield* isoNow(tx);

      const result = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Settlement.SettlementApproval,
        {
          id: newId("payroll_settlement_approval"),
          reviewId: review.id,
          reviewDigest: review.digest,
          actorId: principal.actorId,
          kernelApprovalId: kernel?.id ?? null,
          expiresAt: kernel?.expiresAt ?? new Date(Date.parse(now) + 3600000).toISOString(),
        },
      );

      yield* persist(tx, "payroll_settlement_approvals", result);

      for (const key of capacityKeys(review))
        yield* Db.insertCapacityReservation(tx, command.scope.bookId, key, review.id, result.id);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

const commitConsequences = Effect.fn("payroll.commitSettlementConsequences")(function* (
  tx: Transaction,
  scope: Scope,
  principal: Principal,
  review: typeof Settlement.SettlementReview.Type,
  executionId: string,
  key: string,
) {
  const input = review.input;
  const operation = "payroll_execute_settlement";
  let paidEvent: typeof Settlement.PaidPayrollEvent.Type | null = null;
  let recoveryClaim: typeof Settlement.RecoveryClaim.Type | null = null;
  let instruction: typeof Settlement.AdjustmentInstruction.Type | null = null;

  if (input.kind === "payment") {
    const run = review.originalRun;
    const cash = review.cash;
    const employee = run?.employees.find((row) => row.calculation.employeeId === input.employeeId);
    const obligation = run?.employeeObligations.find((row) => row.employeeId === input.employeeId);

    if (
      !run ||
      !cash ||
      !employee ||
      !obligation ||
      review.outputs.reportingReadiness === "not_applicable"
    )
      return yield* failure("InternalError");
    const calculated = employee.calculation.calculation;
    paidEvent = yield* seal(tx, scope, principal, operation, key, Settlement.PaidPayrollEvent, {
      id: newId("payroll_paid_event"),
      runId: run.id,
      employeeId: input.employeeId,
      paidOn: cash.observedOn,
      paidMinor: review.outputs.amountMinor,
      evidenceId: cash.evidence.evidenceId,
      reportingPeriod: Domain.resolveReportingPeriod(cash.observedOn),
      grossCashMinor: calculated.grossMinor,
      withholdingMinor: obligation.withholdingMinor,
      contributionBaseMinor: obligation.contributionBaseMinor,
      employerContributionMinor: obligation.employerContributionMinor,
      specificationNumber: `spec_${(yield* digest({ employer: scope.entityId, employee: input.employeeId, period: Domain.resolveReportingPeriod(cash.observedOn) })).slice(7, 39)}`,
      originalRun: run,
      originalEmployee: employee,
      reportingReadiness: review.outputs.reportingReadiness,
      sourceDigest: review.capacityDigest,
      settlementExecutionId: executionId,
    });
    yield* persist(tx, "payroll_paid_events", paidEvent);
  } else if (input.kind === "cash_recovery") {
    const allocation = yield* seal(tx, scope, principal, operation, key, AllocationRecord, {
      id: newId("payroll_recovery_allocation"),
      claimId: input.claimId,
      executionId,
      amountMinor: review.outputs.amountMinor,
    });

    yield* persist(tx, "payroll_recovery_allocations", allocation);
  } else {
    const paid = review.paidEvent;
    const comparison = review.comparison;

    if (!paid || !comparison) return yield* failure("InternalError");

    if (input.kind === "gross_recovery") {
      if (!input.recoveryReceivableAccountId) return yield* failure("InternalError");

      const claimFields: RetainedFields<typeof ClaimRecord.Type> = {
        id: newId("payroll_recovery_claim"),
        paidEventId: paid.id,
        comparisonId: comparison.id,
        claimedGrossMinor: (-BigInt(review.outputs.signedGrossDeltaMinor)).toString(),
        receivableMinor: review.outputs.amountMinor,
        recoveryReceivableAccountId: input.recoveryReceivableAccountId,
        originalSpecificationNumber: paid.specificationNumber,
        reportingPeriod: paid.reportingPeriod,
        executionId,
      };

      if (input.mileageSource) {
        const source = yield* readMileageRecord(
          tx,
          scope,
          "payroll_mileage_correction_proposals",
          input.mileageSource.proposalId,
          Mileage.MileageCorrectionProposal,
        );

        claimFields.mileageSource = {
          proposalId: source.id,
          originalInputId: source.input.originalInputId,
        };
      }

      const claim = yield* seal(tx, scope, principal, operation, key, ClaimRecord, claimFields);

      yield* persist(tx, "payroll_recovery_claims", claim);
      recoveryClaim = claim;
    } else if (input.kind === "future_pay" || input.kind === "additional_compensation") {
      const instructionFields: RetainedFields<typeof InstructionRecord.Type> = {
        id: newId("payadj"),
        paidEventId: paid.id,
        employeeId: paid.employeeId,
        month: input.futureMonth,
        kind: input.kind,
        signedGrossDeltaMinor: review.outputs.signedGrossDeltaMinor,
        evidence: yield* readEvidenceReference(tx, scope.bookId, input.evidenceId),
        executionId,
      };

      if (input.kind === "future_pay" && input.recoveryClaimId && review.claim)
        instructionFields.netRecovery = {
          claimId: input.recoveryClaimId,
          amountMinor: review.outputs.amountMinor,
          receivableAccountId: review.claim.recoveryReceivableAccountId,
        };

      const retained = yield* seal(
        tx,
        scope,
        principal,
        operation,
        key,
        InstructionRecord,
        instructionFields,
      );

      yield* persist(tx, "payroll_adjustment_instructions", retained);
      instruction = retained;
    }

    if (input.kind === "gross_recovery" || input.kind === "reporting_only") {
      const identity = Recovery.assertAgiReplacementIdentity({
        originalSpecificationId: paid.specificationNumber,
        replacementSpecificationId: paid.specificationNumber,
      });

      if (Result.isFailure(identity)) return yield* failure("InternalError");

      const amendment = Domain.prepareAgiAmendment({
        employerId: scope.entityId,
        reportingPeriod: paid.reportingPeriod,
        payeeId: paid.employeeId,
        specificationNumber: paid.specificationNumber,
        original: {
          employerId: scope.entityId,
          reportingPeriod: paid.reportingPeriod,
          payeeId: paid.employeeId,
          specificationNumber: paid.specificationNumber,
          grossCashMinor: paid.grossCashMinor,
          withholdingMinor: paid.withholdingMinor,
          contributionBaseMinor: paid.contributionBaseMinor,
        },
        correctedWithholdingMinor: paid.withholdingMinor,
        withholdingCorrectionQualified: false,
      });

      if (Result.isFailure(amendment)) return yield* failure("UnsupportedProfile");

      const correction = yield* seal(tx, scope, principal, operation, key, ReportingCorrection, {
        id: newId("payroll_reporting_correction"),
        paidEventId: paid.id,
        executionId,
        kind: input.kind,
        grossCashMinor:
          review.reportingReplacement?.grossCashMinor ?? comparison.calculation.grossMinor,
        withholdingMinor: review.reportingReplacement?.withholdingMinor ?? paid.withholdingMinor,
        contributionBaseMinor:
          review.reportingReplacement?.contributionBaseMinor ??
          comparison.calculation.contributionBaseMinor,
        contributionDeltaMinor: review.outputs.contributionCorrectionMinor,
        specificationNumber: paid.specificationNumber,
      });

      yield* persist(tx, "payroll_reporting_corrections", correction);
    }
  }

  return { paidEvent, recoveryClaim, instruction };
});

export const executeSettlement = Effect.fn("payroll.executeSettlement")(function* (
  token: string,
  command: Command<typeof Settlement.ExecuteSettlement.Type> & { readonly reviewId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requireSettlementAccess(tx, command.scope, principal.actorId, true);
      const operation = "payroll_execute_settlement";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { reviewId: command.reviewId, input: command.input },
        Settlement.SettlementExecution,
      );

      if (request.previous) return request.previous;

      const review = yield* currentReview(
        tx,
        command.scope,
        command.reviewId,
        command.input.reviewDigest,
      );

      yield* requireCapacity(tx, review);

      const approval = yield* readRetained(
        tx,
        command.scope,
        "payroll_settlement_approvals",
        command.input.approvalId,
        Settlement.SettlementApproval,
      );

      if (
        approval.reviewId !== review.id ||
        approval.reviewDigest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(tx)) ||
        (yield* Ledger.readOperatorMembership(tx, command.scope.bookId, approval.actorId))
          .length !== 1 ||
        (yield* Foundation.readPayrollAccess(tx, command.scope.bookId, approval.actorId)).length !==
          1 ||
        (yield* Ledger.readActorAdmission(tx, approval.actorId))[0]?.enabled === false
      )
        return yield* failure("ApprovalRequired");
      yield* requireSettlementAccess(tx, command.scope, approval.actorId, false);

      yield* requireMileageSubmission(tx, command.scope, review, approval.actorId);

      if (!review.postingPlan && review.input.kind !== "reporting_only")
        yield* requireInstructionAuthority(tx, command.scope, review, approval.actorId);

      const postingReceipt =
        review.postingPlan && approval.kernelApprovalId
          ? yield* executeChangeInTransaction(tx, principal, {
              scope: command.scope,
              changeSetId: review.postingPlan.id,
              idempotencyKey: `${review.id}_post`,
              owner: owner(review),
              input: {
                version: 1,
                planDigest: review.postingPlan.planDigest,
                approvalId: approval.kernelApprovalId,
              },
            })
          : null;

      if (review.postingPlan !== null && postingReceipt === null)
        return yield* failure("ApprovalRequired");

      if (review.cash) {
        const bankLine = review.postingPlan?.groups[0]?.actions[0]?.lines.find(
          (line) => line.accountId === review.cash?.accountId,
        );

        if (!postingReceipt || !bankLine) return yield* failure("InternalError");

        const leg = {
          statementId: review.cash.statementId,
          rowOrdinal: review.cash.rowOrdinal,
          voucherId: postingReceipt.voucherId,
          lineId: bankLine.lineId,
        };

        yield* addMatch(tx, command.scope.bookId, principal.actorId, leg, "explicit", review.id);
      }

      const id = newId("payroll_settlement_execution");

      const consequences = yield* commitConsequences(
        tx,
        command.scope,
        principal,
        review,
        id,
        command.idempotencyKey,
      );

      yield* recordMileageSuccessor(tx, command.scope, review, id);

      const result = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Settlement.SettlementExecution,
        {
          id,
          reviewId: review.id,
          approvalId: approval.id,
          kind: review.input.kind,
          ...consequences,
          remainingReceivableMinor: review.outputs.remainingReceivableMinor,
          postingReceipt,
        },
      );

      yield* persist(tx, "payroll_settlement_executions", result);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const getSettlement = Effect.fn("payroll.getSettlement")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reviewId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requireSettlementAccess(tx, command.scope, principal.actorId, false);

    const review = yield* readRetained(
      tx,
      command.scope,
      "payroll_settlement_reviews",
      command.reviewId,
      Settlement.SettlementReview,
    );

    const approvals = [];

    for (const row of yield* Db.readApprovalRows(tx, command.scope.bookId, review.id))
      approvals.push(yield* decode(Settlement.SettlementApproval, row.body));
    const executionRow = (yield* Db.readReviewExecution(tx, command.scope.bookId, review.id))[0];

    const execution = executionRow
      ? yield* decode(Settlement.SettlementExecution, executionRow.body)
      : null;

    const claimId = execution?.recoveryClaim?.id ?? review.claim?.id;

    const remainingReceivableMinor = claimId
      ? (yield* claimBalance(tx, command.scope, claimId)).remaining
      : "0";

    const netInstruction = execution?.instruction
      ? yield* netInstructionState(tx, command.scope, execution.instruction.id)
      : null;

    return { review, approvals, execution, remainingReceivableMinor, netInstruction };
  });
});

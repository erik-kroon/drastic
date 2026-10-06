import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Domain from "@open-erp/domain/payroll-runs";
import * as Recovery from "@open-erp/domain/paid-payroll-recovery";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Db from "../../db/payroll/settlements";
import * as RunDb from "../../db/payroll/runs";
import * as Bank from "../../db/banking/statements";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, readEvidenceReference, toJsonObject, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../posting";
import { admitAccountRole } from "../resource-admission";
import { capturePaymentReportingBasis } from "./settlement-payment-basis";
import { paidItemPopulation } from "./settlement-items";
import { verifyRunLedger, verifyRecoveryLedger } from "./settlement-ledger";
import { ReportingCorrection } from "./settlement-support";
import { checkedRun } from "./runs";
import { currentMileageProposal, mileageJournal } from "./settlement-mileage-basis";
import { readMileageRecord } from "./mileage-correction-records";
import { mileageLifecycle } from "./mileage-correction-lifecycle";
import { claimOffsetCapacity, compileClaimNetOffset } from "./settlement-net-recovery";
import { readRetained, ClaimRecord, InstructionRecord } from "./settlement-support";

import { validateComparison } from "./paid-comparison-basis";

export { validateComparison } from "./paid-comparison-basis";

type Input = typeof Settlement.PrepareSettlement.Type;

export type JournalLine = {
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
};

export const captureCash = Effect.fn("payroll.captureSettlementCash")(function* (
  tx: Transaction,
  scope: Scope,
  input: Pick<
    Extract<Input, { kind: "payment" | "cash_recovery" }>,
    "bankAccountId" | "statementId" | "rowOrdinal" | "evidenceId" | "postingDate"
  >,
) {
  yield* admitAccountRole(tx, scope.bookId, input.bankAccountId, "bank");

  const row = (yield* Bank.readObservation(
    tx,
    scope.bookId,
    input.statementId,
    input.rowOrdinal,
  ))[0];

  const statement = (yield* Bank.readStatement(tx, scope.bookId, input.statementId))[0];
  const account = (yield* Ledger.readAccounts(tx, scope.bookId, [input.bankAccountId]))[0];

  if (!row || !statement || !account?.active) return yield* failure("NotFound");

  if (
    row.accountId !== input.bankAccountId ||
    row.evidenceId !== input.evidenceId ||
    row.observedOn !== input.postingDate ||
    statement.source.kind !== "synthetic_bank_statement_v1" ||
    statement.source.currency !== "SEK"
  )
    return yield* failure("UnsupportedProfile");

  if ((yield* Db.readSourceUsage(tx, scope.bookId, input.statementId, input.rowOrdinal))[0]?.used)
    return yield* failure("AlreadyPosted");
  const evidence = yield* readEvidenceReference(tx, scope.bookId, row.evidenceId);

  return yield* decode(Settlement.CashSnapshot, {
    statementId: row.statementId,
    rowOrdinal: row.rowOrdinal,
    accountId: row.accountId,
    observedOn: row.observedOn,
    amountMinor: row.amountMinor,
    evidence,
    accountVersion: account.version.toString(),
  });
});

export const originalCapacity = Effect.fn("payroll.originalPaidCapacity")(function* (
  tx: Transaction,
  scope: Scope,
  paid: typeof Settlement.PaidPayrollEvent.Type,
) {
  const claims = [];

  for (const row of yield* Db.readRecords(tx, scope.bookId, "payroll_recovery_claims")) {
    const claim = yield* decode(ClaimRecord, row.body);

    if (claim.paidEventId === paid.id) claims.push(claim);
  }

  const instructions = [];

  for (const row of yield* Db.readRecords(tx, scope.bookId, "payroll_adjustment_instructions")) {
    const instruction = yield* decode(InstructionRecord, row.body);

    if (instruction.paidEventId === paid.id) instructions.push(instruction);
  }

  const gross =
    BigInt(paid.grossCashMinor) -
    claims.reduce((sum, row) => sum + BigInt(row.claimedGrossMinor), 0n) +
    instructions.reduce((sum, row) => sum + BigInt(row.signedGrossDeltaMinor), 0n);

  if (gross < 0n) return yield* failure("StaleDependency");

  return {
    gross: gross.toString(),
    claims,
    instructions,
    digest: yield* digest({ paid: paid.digest, claims, instructions }),
  };
});

const empty = {
  reportingReplacement: null,
  originalRun: null,
  paidEvent: null,
  comparison: null,
  lawfulBasis: null,
  claim: null,
  cash: null,
};

const outputs = {
  reportingReadiness: "not_applicable" as const,
  amountMinor: "0",
  remainingReceivableMinor: "0",
  signedGrossDeltaMinor: "0",
  contributionCorrectionMinor: "0",
};

const compilePayment = Effect.fn("payroll.compileSalaryPayment")(function* (
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "payment" }>,
) {
  const lines: JournalLine[] = [];
  const run = yield* checkedRun(tx, scope, input.runId);

  if ((yield* RunDb.readExecution(tx, scope.bookId, run.id)).length !== 1)
    return yield* failure("ApprovalRequired");

  if ((yield* Db.readPaidEmployee(tx, scope.bookId, run.id, input.employeeId)).length)
    return yield* failure("AlreadyPosted");
  const employee = run.employees.find((row) => row.calculation.employeeId === input.employeeId);
  const obligation = run.employeeObligations.find((row) => row.employeeId === input.employeeId);

  if (!employee || !obligation) return yield* failure("NotFound");
  yield* readEvidenceReference(tx, scope.bookId, input.payeeEvidenceId);
  const cash = yield* captureCash(tx, scope, input);
  const amount = -BigInt(cash.amountMinor);

  if (amount <= 0n || amount.toString() !== obligation.payableMinor)
    return yield* failure("UnsupportedProfile");
  const reporting = yield* capturePaymentReportingBasis(tx, scope, employee, cash.observedOn);

  const result = Domain.preparePayrollPayment(
    {
      runId: run.id,
      employeeId: input.employeeId,
      liabilityMinor: obligation.payableMinor,
      paymentMinor: amount.toString(),
      evidenceId: input.evidenceId,
      bankAccountId: input.bankAccountId,
      netPayLiabilityAccountId: run.input.roles.netPayLiabilityAccountId,
    },
    cash.observedOn,
  );

  if (Result.isFailure(result)) return yield* failure("UnsupportedProfile");
  lines.push(
    {
      accountId: run.input.roles.netPayLiabilityAccountId,
      debitMinor: amount.toString(),
      creditMinor: "0",
      description: "Full evidenced employee net settlement",
    },
    {
      accountId: input.bankAccountId,
      debitMinor: "0",
      creditMinor: amount.toString(),
      description: "Retained salary bank row",
    },
  );

  return {
    ...empty,
    originalRun: run,
    cash,
    economicKey: `payment:${run.id}:${input.employeeId}`,
    capacityDigest: yield* digest({ run: run.digest, cash, reporting }),
    outputs: {
      ...outputs,
      reportingReadiness: reporting.readiness,
      amountMinor: amount.toString(),
    },
    lines,
  };
});

const compileCashRecovery = Effect.fn("payroll.compileRecoveryReceipt")(function* (
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "cash_recovery" }>,
) {
  const capacity = yield* claimOffsetCapacity(tx, scope, input.claimId);

  if (capacity.pending.length) return yield* failure("AlreadyPosted");
  const cash = yield* captureCash(tx, scope, input);

  const result = Recovery.recordRecoveryCash({
    claimId: capacity.claim.id,
    remainingReceivableMinor: capacity.remaining,
    receivedMinor: cash.amountMinor,
    bankAccountId: cash.accountId,
    recoveryReceivableAccountId: capacity.claim.recoveryReceivableAccountId,
  });

  if (Result.isFailure(result)) return yield* failure("InvalidJournal");

  return {
    ...empty,
    claim: yield* decode(Settlement.RecoveryClaim, yield* toJsonObject(capacity.claim)),
    cash,
    economicKey: `cash:${cash.statementId}:${cash.rowOrdinal}`,
    capacityDigest: capacity.digest,
    outputs: {
      ...outputs,
      amountMinor: result.success.allocatedMinor,
      remainingReceivableMinor: result.success.remainingReceivableMinor,
    },
    lines: result.success.journal,
  };
});

const compileMileageRecovery = Effect.fn("payroll.compileMileageRecovery")(function* (
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "gross_recovery" }> & {
    readonly mileageSource: NonNullable<
      Extract<Input, { kind: "gross_recovery" }>["mileageSource"]
    >;
  },
  context: AdjustmentContext,
  lawfulBasis: typeof Settlement.AdjustmentBasis.Type,
) {
  const { comparison, paid, capacity, delta } = context;
  const economicKey = context.economicKey;

  const proposal = yield* readMileageRecord(
    tx,
    scope,
    "payroll_mileage_correction_proposals",
    input.mileageSource.proposalId,
    Mileage.MileageCorrectionProposal,
  );

  const lifecycle = yield* mileageLifecycle(tx, scope, proposal.id);

  if (lifecycle.cancellation) return yield* failure("ApprovalRequired");

  const captured = yield* currentMileageProposal(tx, scope, proposal);
  const exactJournal = mileageJournal(proposal.input, captured, proposal.comparison);

  if (
    proposal.digest !== input.mileageSource.proposalDigest ||
    proposal.comparison?.paidComparisonId !== comparison.id ||
    !proposal.journal ||
    !equalJson(exactJournal, proposal.journal) ||
    proposal.comparison.taxableDeltaMinor !== delta.toString() ||
    input.recoveryReceivableAccountId !== proposal.input.recoveryReceivableAccountId ||
    lawfulBasis?.evidence.sha256 !== proposal.sources.recoveryBasis?.sha256.slice(7) ||
    lawfulBasis?.input.reason !== proposal.sources.recoveryReason
  )
    return yield* failure("StaleDependency");

  const sourceLines = proposal.journal.lines.map(({ accountId, debitMinor, creditMinor }) => ({
    accountId,
    debitMinor,
    creditMinor,
    description: "Retained paid mileage source correction",
  }));

  return {
    ...empty,
    originalRun: paid.originalRun,
    paidEvent: paid,
    comparison,
    lawfulBasis,
    economicKey,
    capacityDigest: yield* digest({
      paidCapacity: capacity.digest,
      proposal: proposal.digest,
      dependency: captured.dependencyDigest,
    }),
    outputs: {
      ...outputs,
      reportingReadiness: "adjustment_required" as const,
      amountMinor: proposal.journal.receivableMinor,
      remainingReceivableMinor: proposal.journal.receivableMinor,
      signedGrossDeltaMinor: delta.toString(),
      contributionCorrectionMinor: proposal.comparison.contributionCorrectionMinor,
    },
    lines: sourceLines,
  };
});

export const compileSettlement = Effect.fn("payroll.compileSettlement")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
) {
  yield* requireAdjustmentDate(tx, scope, input);
  yield* readEvidenceReference(tx, scope.bookId, input.evidenceId);
  const book = (yield* Ledger.readBook(tx, scope))[0];

  if (!book || book.profile !== "synthetic-core-v1" || book.currency !== "SEK")
    return yield* failure("UnsupportedProfile");

  if (input.kind === "payment") return yield* compilePayment(tx, scope, input);

  if (input.kind === "cash_recovery") return yield* compileCashRecovery(tx, scope, input);

  if (input.kind === "future_pay" && input.recoveryClaimId)
    return yield* compileClaimNetOffset(tx, scope, input, input.recoveryClaimId);

  return yield* compileAdjustment(tx, scope, input);
});

const compileAdjustment = Effect.fn("payroll.compileAdjustment")(function* (
  tx: Transaction,
  scope: Scope,
  input: Exclude<Input, { kind: "payment" | "cash_recovery" }>,
) {
  const lines: JournalLine[] = [];

  const comparison = yield* readRetained(
    tx,
    scope,
    "payroll_correction_comparisons",
    input.comparisonId,
    Settlement.CorrectionComparison,
  );

  const economicKey =
    input.kind === "gross_recovery" && input.mileageSource
      ? `mileage:${input.mileageSource.proposalId}`
      : `adjustment:${comparison.paidEventId}:${input.kind}:${comparison.calculation.grossMinor}:${comparison.basis.employmentRevisionId}:${comparison.basis.workRevisionId}`;

  if (
    input.kind !== "reporting_only" &&
    (yield* Db.readEconomicExecution(tx, scope.bookId, economicKey)).length
  )
    return yield* failure("AlreadyPosted");
  const { paid } = yield* validateComparison(tx, scope, input.comparisonId);
  const capacity = yield* originalCapacity(tx, scope, paid);
  const delta = BigInt(comparison.calculation.grossMinor) - BigInt(capacity.gross);
  let lawfulBasis: typeof Settlement.AdjustmentBasis.Type | null = null;

  if (input.kind === "gross_recovery" || input.kind === "future_pay") {
    lawfulBasis = yield* readRetained(
      tx,
      scope,
      "payroll_adjustment_bases",
      input.lawfulBasisId,
      Settlement.AdjustmentBasis,
    );

    if (lawfulBasis.input.kind !== input.kind || lawfulBasis.comparisonDigest !== comparison.digest)
      return yield* failure("StaleDependency");
  }

  if (input.kind === "gross_recovery") {
    if (
      capacity.instructions.some((row) => row.netRecovery === undefined) ||
      delta > 0n ||
      (delta === 0n && !input.mileageSource) ||
      input.recoveryReceivableAccountId === null ||
      input.futureMonth !== null
    )
      return yield* failure("UnsupportedProfile");

    yield* admitRecoveryAccount(tx, scope, paid, input.recoveryReceivableAccountId);

    if (input.mileageSource && lawfulBasis)
      return yield* compileMileageRecovery(
        tx,
        scope,
        { ...input, mileageSource: input.mileageSource },
        { comparison, paid, capacity, economicKey, delta },
        lawfulBasis,
      );

    const claim = Recovery.compileGrossRecoveryClaim({
      claimId: "pending_claim",
      employeeId: paid.employeeId,
      originalPayRefs: [paid.id],
      enforceableClaimEvidence: lawfulBasis?.evidence.evidenceId ?? null,
      claimedGrossMinor: (-delta).toString(),
      unclaimedEligibleMinor: capacity.gross,
      recoveryReceivableAccountId: input.recoveryReceivableAccountId,
      wageCostAccountId: paid.originalRun.input.roles.salaryExpenseAccountId,
      originalSpecificationId: paid.specificationNumber,
    });

    if (Result.isFailure(claim)) return yield* failure("UnsupportedProfile");
    const previousContributionCorrection = yield* previousRecoveryContribution(tx, scope, paid.id);

    return {
      ...empty,
      originalRun: paid.originalRun,
      paidEvent: paid,
      comparison,
      lawfulBasis,
      economicKey,
      capacityDigest: capacity.digest,
      outputs: {
        ...outputs,
        amountMinor: claim.success.grossClaimedMinor,
        remainingReceivableMinor: claim.success.grossClaimedMinor,
        signedGrossDeltaMinor: delta.toString(),
        contributionCorrectionMinor: (
          BigInt(comparison.contributionDeltaMinor) - previousContributionCorrection
        ).toString(),
      },
      lines: claim.success.journal,
    };
  }

  if (input.kind === "future_pay" || input.kind === "additional_compensation") {
    if (
      !input.futureMonth ||
      input.futureMonth <= paid.reportingPeriod ||
      (input.kind === "future_pay" ? delta >= 0n : delta <= 0n)
    )
      return yield* failure("UnsupportedProfile");

    if (input.kind === "additional_compensation") {
      const additional = Recovery.compileAdditionalCompensation({
        adjustmentId: comparison.id,
        employeeId: paid.employeeId,
        earningPeriods: [paid.originalEmployee.calculation.basis.earningsPeriod.startsOn],
        additionalEntitlementMinor: delta.toString(),
        wageExpenseAccountId: paid.originalRun.input.roles.salaryExpenseAccountId,
        employeePayableAccountId: paid.originalRun.input.roles.netPayLiabilityAccountId,
      });

      if (Result.isFailure(additional)) return yield* failure("UnsupportedProfile");
    }

    return {
      ...empty,
      originalRun: paid.originalRun,
      paidEvent: paid,
      comparison,
      lawfulBasis,
      economicKey,
      capacityDigest: capacity.digest,
      outputs: {
        ...outputs,
        amountMinor: (delta < 0n ? -delta : delta).toString(),
        signedGrossDeltaMinor: delta.toString(),
      },
      lines,
    };
  }

  return yield* compileReportingCorrection(tx, scope, {
    comparison,
    paid,
    capacity,
    economicKey,
    delta,
  });
});

type AdjustmentContext = {
  readonly comparison: typeof Settlement.CorrectionComparison.Type;
  readonly paid: typeof Settlement.PaidPayrollEvent.Type;
  readonly capacity: Effect.Success<ReturnType<typeof originalCapacity>>;
  readonly economicKey: string;
  readonly delta: bigint;
};

const compileReportingCorrection = Effect.fn("payroll.compileReportingCorrection")(function* (
  tx: Transaction,
  scope: Scope,
  context: AdjustmentContext,
) {
  const { comparison, paid, capacity } = context;
  const delta = context.delta;
  const lines: JournalLine[] = [];

  if (delta !== 0n || comparison.calculation.withholdingMinor !== paid.withholdingMinor)
    return yield* failure("UnsupportedProfile");
  yield* verifyRunLedger(tx, scope, paid.originalRun);
  yield* verifyRecoveryLedger(tx, scope, capacity.claims);

  const reportedGross =
    BigInt(paid.grossCashMinor) -
    capacity.claims.reduce((sum, claim) => sum + BigInt(claim.claimedGrossMinor), 0n);

  if (comparison.calculation.grossMinor !== reportedGross.toString())
    return yield* failure("UnsupportedProfile");
  const row = (yield* Db.readLatestPeriod(tx, scope.bookId, paid.reportingPeriod))[0];

  if (!row) return yield* failure("UnsupportedProfile");
  const prior = yield* decode(Settlement.PayrollPeriod, row.body);
  const paidEvents = [];

  for (const row of yield* Db.readRecords(tx, scope.bookId, "payroll_paid_events")) {
    const event = yield* decode(Settlement.PaidPayrollEvent, row.body);

    if (event.reportingPeriod === paid.reportingPeriod) {
      if (event.reportingReadiness !== "ready") return yield* failure("UnsupportedProfile");
      yield* verifyRunLedger(tx, scope, event.originalRun);
      paidEvents.push(event);
    }
  }

  if (paidEvents.length > 400) return yield* failure("UnsupportedProfile");
  const claims = [];

  for (const row of yield* Db.readRecords(tx, scope.bookId, "payroll_recovery_claims"))
    claims.push(yield* decode(ClaimRecord, row.body));
  yield* verifyRecoveryLedger(tx, scope, claims);
  const current = yield* paidItemPopulation(scope.entityId, paidEvents, claims);

  const actual = current.items.find(
    (item) => item.specificationNumber === paid.specificationNumber,
  );

  if (!actual) return yield* failure("UnsupportedProfile");

  const retained = prior.items.find(
    (item) => item.specificationNumber === paid.specificationNumber,
  );

  const differs = !equalJson(actual, retained);

  const reporting = Recovery.compileReportingOnlyCorrection({
    correctionId: comparison.id,
    ledgerFactsCorrect: true,
    declarationDifferences: differs
      ? [{ itemIdentity: paid.specificationNumber, correctedValues: comparison.id }]
      : [],
  });

  if (Result.isFailure(reporting)) return yield* failure("UnsupportedProfile");
  const reportingKey = `reporting:${paid.reportingPeriod}:${paid.specificationNumber}:${prior.digest}:${yield* digest(current.items)}`;

  if ((yield* Db.readEconomicExecution(tx, scope.bookId, reportingKey)).length)
    return yield* failure("AlreadyPosted");

  return {
    ...empty,
    originalRun: paid.originalRun,
    paidEvent: paid,
    comparison,
    reportingReplacement: actual,
    economicKey: reportingKey,
    capacityDigest: yield* digest({
      originalCapacity: capacity.digest,
      priorPeriod: prior.digest,
      paidEvents,
      claims,
      items: current.items,
    }),
    outputs,
    lines,
  };
});

const previousRecoveryContribution = Effect.fn("payroll.previousRecoveryContribution")(function* (
  tx: Transaction,
  scope: Scope,
  paidEventId: string,
) {
  let previousContributionCorrection = 0n;

  for (const row of yield* Db.readRecords(tx, scope.bookId, "payroll_reporting_corrections")) {
    const correction = yield* decode(ReportingCorrection, row.body);

    if (correction.paidEventId === paidEventId && correction.kind === "gross_recovery")
      previousContributionCorrection += BigInt(correction.contributionDeltaMinor);
  }

  return previousContributionCorrection;
});

const admitRecoveryAccount = Effect.fn("payroll.admitRecoveryAccount")(function* (
  tx: Transaction,
  scope: Scope,
  paid: typeof Settlement.PaidPayrollEvent.Type,
  accountId: string,
) {
  const account = (yield* Ledger.readAccounts(tx, scope.bookId, [accountId]))[0];
  const roles = paid.originalRun.input.roles;

  const originalRoles = [
    roles.salaryExpenseAccountId,
    roles.reimbursementExpenseAccountId,
    roles.netPayLiabilityAccountId,
    roles.withholdingLiabilityAccountId,
    roles.employerContributionExpenseAccountId,
    roles.employerContributionLiabilityAccountId,
    ...roles.deductions.map((row) => row.accountId),
    ...roles.accruals.flatMap((row) => [row.expenseAccountId, row.liabilityAccountId]),
  ];

  if (!account?.active || originalRoles.includes(accountId))
    return yield* failure("InvalidJournal");
  yield* admitAccountRole(tx, scope.bookId, accountId, "payroll");
});

const requireAdjustmentDate = Effect.fn("payroll.requireAdjustmentDate")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
) {
  const period = (yield* Ledger.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];

  if (!period) return yield* failure("AccountingPeriodMissing");

  if (period.locked) return yield* failure("PeriodLocked");

  if (input.postingDate < period.startsOn || input.postingDate > period.endsOn)
    return yield* failure("PostingDateOutsidePeriod");
});

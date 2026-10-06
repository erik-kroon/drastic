import * as Accounting from "@open-erp/contracts/accounting";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import { equalJson } from "@open-erp/domain/canonicalization";
import { compilePayRunJournal } from "@open-erp/domain/payroll-runs";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Db from "../../db/payroll/calculations";
import * as RunDb from "../../db/payroll/runs";
import * as Foundation from "../../db/payroll-foundation";
import * as Profiles from "../../db/company-profiles";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, requireTableAccess, type Scope } from "../commerce/support";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import { failure } from "../failures";
import { captureInputs } from "./inputs";
import { captureClaimInstructions } from "./employee-claim-instructions";

import { captureAdjustmentInstructions } from "./settlement-instructions";

export const requirePayrollAccess = Effect.fn("payroll.runAccess")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  write: boolean,
) {
  if ((yield* Foundation.readPayrollAccess(tx, scope.bookId, actorId)).length !== 1)
    return yield* failure("Forbidden");
  yield* requireTableAccess(tx, RunDb.runTables, write);
});

const Identity = Schema.Struct({ personRef: Accounting.Description });

export const currentCalculation = Effect.fn("payroll.currentRunCalculation")(function* (
  tx: Transaction,
  scope: Scope,
  calculationId: string,
  runId?: string,
) {
  const row = (yield* Db.readCalculation(tx, scope.bookId, calculationId))[0];

  if (!row) return yield* failure("NotFound");
  const retained = yield* decode(Calculations.PayrollCalculation, row.body);
  const basis = retained.basis;
  const period = retained.calculation.earningsPeriod;

  if (
    retained.scope.bookId !== scope.bookId ||
    retained.scope.entityId !== scope.entityId ||
    retained.planDigest !== row.planDigest
  )
    return yield* failure("StaleDependency");

  const latest = (yield* Db.readLatestEarningRevision(
    tx,
    scope.bookId,
    retained.employeeId,
    period.startsOn,
    period.endsOn,
  ))[0];

  if (latest?.revision !== row.revision) return yield* failure("StaleDependency");

  const employment = yield* requireCurrentRevision(
    tx,
    scope,
    retained,
    "employment",
    basis.employmentRevisionId,
  );

  yield* requireCurrentRevision(tx, scope, retained, "work", basis.workRevisionId);
  yield* requireCurrentRevision(tx, scope, retained, "opening", basis.openingRevisionId);
  const { personRef } = yield* decode(Identity, employment.body);

  const book = (yield* Ledger.readBook(tx, scope))[0];

  if (!book || book.currency !== basis.currency || book.currencyScale !== basis.currencyScale)
    return yield* failure("StaleDependency");

  yield* requireCalculationProfile(tx, scope, basis);

  const inputs = yield* captureInputs(
    tx,
    scope,
    retained.employeeId,
    period.startsOn.slice(0, 7),
    (basis.payrollInputs ?? []).map((row) => row.inputId),
    runId,
  );

  if (!equalJson(inputs, basis.payrollInputs ?? [])) return yield* failure("StaleDependency");

  const claims = yield* captureClaimInstructions(
    tx,
    scope,
    retained.employeeId,
    period.startsOn.slice(0, 7),
    (basis.claimInstructions ?? []).map((row) => row.instructionId),
    runId,
  );

  if (!equalJson(claims, basis.claimInstructions ?? [])) return yield* failure("StaleDependency");

  const adjustments = yield* captureAdjustmentInstructions(
    tx,
    scope,
    retained.employeeId,
    period.startsOn.slice(0, 7),
    (basis.adjustmentInstructions ?? []).map((row) => row.id),
    runId,
  );

  if (!equalJson(adjustments, basis.adjustmentInstructions ?? []))
    return yield* failure("StaleDependency");

  if (
    (yield* RunDb.readReservedMonth(
      tx,
      scope.bookId,
      retained.employeeId,
      period.startsOn.slice(0, 7),
    )).length
  )
    return yield* failure("AlreadyPosted");

  return { calculation: retained, personRef };
});

const requireCurrentRevision = Effect.fn("payroll.currentRunRevision")(function* (
  tx: Transaction,
  scope: Scope,
  calculation: typeof Calculations.PayrollCalculation.Type,
  kind: "employment" | "work" | "opening",
  id: string,
) {
  const head = (yield* Db.readRevisionHead(
    tx,
    scope.bookId,
    calculation.employeeId,
    kind,
    calculation.calculation.earningsPeriod.startsOn,
  ))[0];

  if (
    !head ||
    head.id !== id ||
    (yield* Db.readCurrentRevisionAt(
      tx,
      scope.bookId,
      calculation.employeeId,
      kind,
      head.effectiveOn,
      "update",
    ))[0]?.revisionId !== id
  )
    return yield* failure("StaleDependency");

  return head;
});

const requireCalculationProfile = Effect.fn("payroll.currentCalculationProfile")(function* (
  tx: Transaction,
  scope: Scope,
  basis: typeof Calculations.PayrollCalculationBasis.Type,
) {
  const resolved = yield* resolveCompanyProfileInTransaction(
    tx,
    scope,
    basis.reviewedInput.recordClass,
    { postingOn: null, taxPointOn: null, paymentOn: basis.expectedPaymentOn, reportOn: null },
  );

  const witness = resolved.families.find((entry) => entry.family === "payroll")?.witness;
  const release = (yield* Db.readRuleRelease(tx, basis.ruleReleaseId))[0];
  const membership = (yield* Profiles.readFamilyMembership(tx, scope.bookId, "payroll"))[0];

  if (
    !witness ||
    !release ||
    release.version !== basis.ruleReleaseVersion ||
    release.checksum !== basis.ruleReleaseChecksum ||
    witness.ruleReleaseId !== basis.ruleReleaseId ||
    witness.ruleReleaseChecksum !== basis.ruleReleaseChecksum ||
    witness.activationId !== basis.companyActivationId ||
    (membership?.membershipEpoch.toString() ?? null) !== basis.familyMembershipEpoch ||
    !equalJson(witness.factRevisionIds, basis.factRevisionIds) ||
    !equalJson(witness.factReviewIds, basis.factReviewIds) ||
    !equalJson(witness.roleBindingIds, basis.roleBindingIds)
  )
    return yield* failure("StaleDependency");
});

export const compileRun = Effect.fn("payroll.compileRun")(function* (
  id: string,
  input: typeof Runs.PreparePayrollRun.Type,
  employees: ReadonlyArray<typeof Runs.PayrollRunEmployee.Type>,
) {
  const first = employees[0]?.calculation.calculation;

  if (!first || first.currency !== "SEK" || first.currencyScale !== 2)
    return yield* failure("UnsupportedProfile");
  const seen = new Set<string>();
  const mapped = [];

  if (
    new Set(input.roles.deductions.map((row) => row.roleKind)).size !==
      input.roles.deductions.length ||
    new Set(input.roles.accruals.map((row) => row.componentId)).size !== input.roles.accruals.length
  )
    return yield* failure("InvalidJournal");

  for (const employee of employees) {
    const source = employee.calculation;
    const calculated = source.calculation;

    if (
      seen.has(source.employeeId) ||
      calculated.currency !== first.currency ||
      calculated.currencyScale !== first.currencyScale ||
      !equalJson(calculated.earningsPeriod, first.earningsPeriod) ||
      calculated.expectedPaymentOn !== first.expectedPaymentOn
    )
      return yield* failure("UnsupportedProfile");
    seen.add(source.employeeId);

    if (
      calculated.benefitBases.some(
        (row) => row.costRecognition !== "already_recognized" || BigInt(row.cashMinor) !== 0n,
      )
    )
      return yield* failure("UnsupportedProfile");
    const deductions = [];

    for (const deduction of source.basis.reviewedInput.employment.deductionComponents) {
      const recovery = source.basis.adjustmentInstructions?.find(
        (row) => row.id === deduction.componentId && row.netRecovery !== undefined,
      );

      if (recovery?.netRecovery) {
        if (deduction.minor !== recovery.netRecovery.amountMinor)
          return yield* failure("StaleDependency");

        deductions.push({
          deductionId: deduction.componentId,
          amountMinor: deduction.minor,
          destinationAccountId: recovery.netRecovery.receivableAccountId,
        });

        continue;
      }

      const account = input.roles.deductions.find(
        (row) => row.roleKind === deduction.destinationRole,
      );

      if (!account) return yield* failure("UnsupportedProfile");
      deductions.push({
        deductionId: deduction.componentId,
        amountMinor: deduction.minor,
        destinationAccountId: account.accountId,
      });
    }

    if (
      deductions.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n).toString() !==
      calculated.netDeductionMinor
    )
      return yield* failure("UnsupportedProfile");
    const accruals = [];

    for (const accrual of calculated.extraAccruals) {
      const account = input.roles.accruals.find((row) => row.componentId === accrual.componentId);

      if (!account) return yield* failure("UnsupportedProfile");
      accruals.push({
        accrualId: accrual.componentId,
        amountMinor: accrual.minor,
        expenseAccountId: account.expenseAccountId,
        liabilityAccountId: account.liabilityAccountId,
      });
    }

    mapped.push({
      employeeId: source.employeeId,
      grossMinor: calculated.grossMinor,
      withholdingMinor: calculated.withholdingMinor,
      cashReimbursementMinor: calculated.cashReimbursementMinor,
      reimbursementAlreadyRecognized: false,
      fundingTransfers: [
        ...(source.basis.payrollInputs ?? []).flatMap((row) => [
          ...(row.reimbursementMinor === "0"
            ? []
            : [
                {
                  sourceId: `${row.inputId}_exempt`,
                  kind: "reimbursement" as const,
                  amountMinor: row.reimbursementMinor,
                  liabilityAccountId: row.liabilityAccountId,
                },
              ]),
          ...(row.grossRecognizedMinor === "0"
            ? []
            : [
                {
                  sourceId: `${row.inputId}_gross`,
                  kind: "gross" as const,
                  amountMinor: row.grossRecognizedMinor,
                  liabilityAccountId: row.taxableLiabilityAccountId ?? row.liabilityAccountId,
                },
              ]),
        ]),
        ...(source.basis.claimInstructions ?? []).map((row) => ({
          sourceId: row.instructionId,
          kind: "reimbursement" as const,
          amountMinor: row.amountMinor,
          liabilityAccountId: row.liabilityAccountId,
        })),
      ],
      deductions,
      employerContributionMinor: calculated.employerContributionMinor,
      accruals,
    });
  }

  const plan = compilePayRunJournal({
    runId: id,
    commandKey: id,
    knownCommandKeys: [],
    roles: input.roles,
    employees: mapped,
  });

  if (Result.isFailure(plan)) return yield* failure("InvalidJournal");

  if (
    plan.success.journal.length > 500 ||
    plan.success.journal.length < 2 ||
    plan.success.employeePayables.some(
      (row) =>
        row.payableMinor !==
        employees.find((entry) => entry.calculation.employeeId === row.employeeId)?.calculation
          .calculation.payableMinor,
    )
  )
    return yield* failure("InvalidJournal");

  return plan.success;
});

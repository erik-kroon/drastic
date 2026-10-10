import { runBookCommandWithReceipt } from "../book-commands";
import * as Runs from "@open-erp/contracts/payroll-runs";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/runs";
import * as Ledger from "../../db/posting";
import * as Foundation from "../../db/payroll-foundation";
import type { Transaction } from "../../db/transaction";
import { decode, toJsonObject, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  prepareJournalInTransaction,
} from "../posting";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { compileRun, currentCalculation, requirePayrollAccess } from "./run-basis";
import { reserveInputs, consumeInputs, reserveMonth } from "./inputs";
import { reserveClaimInstructions, consumeClaimInstructions } from "./employee-claim-instructions";
import {
  reserveAdjustmentInstructions,
  consumeAdjustmentInstructions,
} from "./settlement-instructions";

export const checkedRun = Effect.fn("payroll.checkedRun")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
  current = false,
) {
  const row = (yield* Db.readRun(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const run = yield* decode(Runs.PayrollRun, row.body);
  const body = Object.fromEntries(Object.entries(row.body).filter(([field]) => field !== "digest"));

  if (
    run.scope.entityId !== scope.entityId ||
    run.scope.bookId !== scope.bookId ||
    run.id !== id ||
    (expectedDigest !== undefined && run.digest !== expectedDigest) ||
    (yield* digest(body)) !== run.digest
  )
    return yield* failure("StaleDependency");

  if (current) {
    if ((yield* Db.readExecution(tx, scope.bookId, id)).length)
      return yield* failure("AlreadyPosted");

    for (const employee of run.employees) {
      const latest = yield* currentCalculation(tx, scope, employee.calculation.id, run.id);

      if (!equalJson(latest, employee)) return yield* failure("StaleDependency");
    }
  }

  return run;
});

export const prepareRun = Effect.fn("payroll.prepareRun")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Runs.PreparePayrollRun.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requirePayrollAccess(tx, command.scope, principal.actorId, true);
      const operation = "prepare_payroll_run";

      return yield* runBookCommandWithReceipt(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: command.input,
        },
        Runs.PayrollRun,
        Effect.gen(function* () {
          if (new Set(command.input.calculationIds).size !== command.input.calculationIds.length)
            return yield* failure("InvalidJournal");
          const employees = [];

          for (const id of command.input.calculationIds)
            employees.push(yield* currentCalculation(tx, command.scope, id));
          const id = newId("payroll_run");
          const journal = yield* compileRun(id, command.input, employees);

          const postingPlan = yield* prepareJournalInTransaction(tx, principal, {
            scope: command.scope,
            idempotencyKey: `${id}_prepare`,
            input: {
              kind: "manual_journal",
              evidenceId: command.input.evidenceId,
              eventKey: id,
              accountingPeriodId: command.input.accountingPeriodId,
              postingDate: command.input.postingDate,
              series: command.input.series,
              description: "Regular payroll accrual",
              rationale: command.input.reason,
              taxAssessment: "not_applicable",
              lines: journal.journal.map(({ accountId, debitMinor, creditMinor, description }) => ({
                accountId,
                debitMinor,
                creditMinor,
                description,
              })),
            },
          });

          const obligations = employees.map(({ calculation: source }) => ({
            employeeId: source.employeeId,
            calculationId: source.id,
            payableMinor: source.calculation.payableMinor,
            grossMinor: source.calculation.grossMinor,
            withholdingMinor: source.calculation.withholdingMinor,
            netDeductionMinor: source.calculation.netDeductionMinor,
            employerContributionMinor: source.calculation.employerContributionMinor,
            contributionBaseMinor: source.calculation.contributionBaseMinor,
          }));

          const body = {
            id,
            scope: command.scope,
            input: command.input,
            employees,
            employeeObligations: obligations,
            postingPlan,
            state: "prepared",
            createdBy: principal.actorId,
            createdAt: yield* isoNow(tx),
            receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
          };

          const run = yield* decode(
            Runs.PayrollRun,
            yield* toJsonObject({ ...body, digest: yield* digest(body) }),
          );

          const action = postingPlan.groups[0]?.actions[0];

          if (
            !action ||
            postingPlan.groups.length !== 1 ||
            postingPlan.groups[0]?.actions.length !== 1
          )
            return yield* failure("InternalError");
          yield* Db.insertRun(tx, run, action.eventId);

          return { receipt: yield* toJsonObject(run), result: run };
        }),
      );
    },
    "update",
  );
});

export const approveRun = Effect.fn("payroll.approveRun")(function* (
  token: string,
  command: {
    scope: Scope;
    runId: string;
    idempotencyKey: string;
    input: typeof Runs.ApprovePayrollRun.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requirePayrollAccess(tx, command.scope, principal.actorId, true);
      const operation = "approve_payroll_run";

      return yield* runBookCommandWithReceipt(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { runId: command.runId, input: command.input },
        },
        Runs.PayrollRunApproval,
        Effect.gen(function* () {
          const run = yield* checkedRun(
            tx,
            command.scope,
            command.runId,
            command.input.runDigest,
            true,
          );

          const approval = yield* approveChangeInTransaction(tx, principal, {
            scope: command.scope,
            changeSetId: run.postingPlan.id,
            idempotencyKey: `payroll_approve_${(yield* digest({ key: command.idempotencyKey })).slice(7)}`,
            owner: { kind: "payroll_run", id: run.id },
            input: { version: 1, planDigest: run.postingPlan.planDigest },
          });

          const result = yield* decode(Runs.PayrollRunApproval, {
            runId: run.id,
            runDigest: run.digest,
            id: approval.id,
            actorId: approval.actorId,
            expiresAt: approval.expiresAt,
            receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
          });

          yield* reserveInputs(
            tx,
            command.scope,
            run.id,
            run.employees.flatMap((employee) => employee.calculation.basis.payrollInputs ?? []),
            approval.id,
          );

          yield* reserveClaimInstructions(
            tx,
            command.scope,
            run.id,
            approval.id,
            run.employees.flatMap((employee) => employee.calculation.basis.claimInstructions ?? []),
          );

          yield* reserveAdjustmentInstructions(
            tx,
            command.scope,
            run.id,
            approval.id,
            run.employees.flatMap(
              (employee) => employee.calculation.basis.adjustmentInstructions ?? [],
            ),
          );

          for (const employee of run.employees)
            yield* reserveMonth(
              tx,
              command.scope,
              run.id,
              approval.id,
              employee.calculation.employeeId,
              employee.calculation.calculation.earningsPeriod.startsOn.slice(0, 7),
            );

          return { receipt: yield* toJsonObject(result), result: result };
        }),
      );
    },
    "update",
  );
});

export const executeRun = Effect.fn("payroll.executeRun")(function* (
  token: string,
  command: {
    scope: Scope;
    runId: string;
    idempotencyKey: string;
    input: typeof Runs.ExecutePayrollRun.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requirePayrollAccess(tx, command.scope, principal.actorId, true);
      const operation = "execute_payroll_run";

      return yield* runBookCommandWithReceipt(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { runId: command.runId, input: command.input },
        },
        Runs.PayrollRunExecution,
        Effect.gen(function* () {
          const run = yield* checkedRun(
            tx,
            command.scope,
            command.runId,
            command.input.runDigest,
            true,
          );

          const approval = (yield* Ledger.readApproval(
            tx,
            command.scope.bookId,
            command.input.approvalId,
          ))[0];

          if (
            !approval ||
            (yield* Foundation.readPayrollAccess(tx, command.scope.bookId, approval.actorId))
              .length !== 1
          )
            return yield* failure("ApprovalRequired");

          const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
            scope: command.scope,
            changeSetId: run.postingPlan.id,
            idempotencyKey: `payroll_post_${(yield* digest({ key: command.idempotencyKey })).slice(7)}`,
            owner: { kind: "payroll_run", id: run.id },
            input: {
              version: 1,
              planDigest: run.postingPlan.planDigest,
              approvalId: command.input.approvalId,
            },
          });

          const payslips = [];

          for (const employee of run.employees) {
            const calculated = employee.calculation.calculation;

            const body = {
              id: newId("payslip"),
              scope: command.scope,
              runId: run.id,
              runDigest: run.digest,
              calculationId: employee.calculation.id,
              employeeId: employee.calculation.employeeId,
              personRef: employee.personRef,
              earningsPeriod: calculated.earningsPeriod,
              expectedPaymentOn: calculated.expectedPaymentOn,
              currency: calculated.currency,
              currencyScale: calculated.currencyScale,
              grossMinor: calculated.grossMinor,
              cashReimbursementMinor: calculated.cashReimbursementMinor,
              withholdingMinor: calculated.withholdingMinor,
              netDeductionMinor: calculated.netDeductionMinor,
              payableMinor: calculated.payableMinor,
              employerContributionMinor: calculated.employerContributionMinor,
              withholdingBaseMinor: calculated.withholdingBaseMinor,
              contributionBaseMinor: calculated.contributionBaseMinor,
              benefitBases: calculated.benefitBases,
              extraAccruals: calculated.extraAccruals,
              deductions: employee.calculation.basis.reviewedInput.employment.deductionComponents,
              status: "posted_unpaid",
            };

            payslips.push(
              yield* decode(
                Runs.PayrollPayslipDocument,
                yield* toJsonObject({ ...body, digest: yield* digest(body) }),
              ),
            );
          }

          const result = yield* decode(
            Runs.PayrollRunExecution,
            yield* toJsonObject({
              id: newId("payroll_execution"),
              scope: command.scope,
              runId: run.id,
              runDigest: run.digest,
              approvalId: command.input.approvalId,
              postingReceipt,
              employeeObligations: run.employeeObligations,
              payslips,
              status: "posted_unpaid",
              createdAt: yield* isoNow(tx),
              receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
            }),
          );

          yield* Db.insertExecution(tx, result);

          for (const obligation of run.employeeObligations)
            yield* Db.insertObligation(tx, command.scope.bookId, run.id, obligation);

          for (const employee of run.employees)
            yield* Db.insertReservations(tx, command.scope.bookId, run.id, employee);

          yield* consumeInputs(
            tx,
            command.scope,
            run.id,
            run.employees.flatMap((employee) => employee.calculation.basis.payrollInputs ?? []),
          );

          yield* consumeClaimInstructions(
            tx,
            command.scope,
            run.id,
            run.employees.flatMap((employee) => employee.calculation.basis.claimInstructions ?? []),
          );

          yield* consumeAdjustmentInstructions(
            tx,
            command.scope,
            run.id,
            run.employees.flatMap(
              (employee) => employee.calculation.basis.adjustmentInstructions ?? [],
            ),
            principal,
          );

          for (const document of payslips) {
            yield* Db.insertDocument(tx, document);
            yield* Ledger.insertOutbox(tx, {
              bookId: command.scope.bookId,
              id: newId("payslip_render"),
              receiptId: postingReceipt.id,
              kind: Runs.payslipRenderEvent,
              payload: {
                documentId: document.id,
                documentDigest: document.digest,
                requiredRendererVersion: Runs.payslipRendererVersion,
              },
            });
          }

          return { receipt: yield* toJsonObject(result), result: result };
        }),
      );
    },
    "update",
  );
});

const runView = Effect.fn("payroll.runView")(function* (
  tx: Transaction,
  run: typeof Runs.PayrollRun.Type,
) {
  const row = (yield* Db.readExecution(tx, run.scope.bookId, run.id))[0];

  const approval = row ? undefined : (yield* Db.readActiveApproval(tx, run))[0];

  return {
    run,
    approval: approval
      ? yield* decode(Runs.PayrollRunActiveApproval, {
          ...approval,
          runId: run.id,
          runDigest: run.digest,
        })
      : null,
    execution: row ? yield* decode(Runs.PayrollRunExecution, row.body) : null,
  };
});

export const getRun = Effect.fn("payroll.getRun")(function* (
  token: string,
  command: { scope: Scope; runId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requirePayrollAccess(tx, command.scope, principal.actorId, false);

    return yield* runView(tx, yield* checkedRun(tx, command.scope, command.runId));
  });
});

export const listRuns = Effect.fn("payroll.listRuns")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requirePayrollAccess(tx, command.scope, principal.actorId, false);
    const rows = yield* Db.readRuns(tx, command.scope.bookId, command.after ?? "");
    const items = [];

    for (const row of rows.slice(0, 20)) {
      const run = yield* decode(Runs.PayrollRun, row.body);
      items.push(yield* runView(tx, yield* checkedRun(tx, command.scope, run.id)));
    }

    return { items, next: rows.length > 20 ? (items.at(-1)?.run.id ?? null) : null };
  });
});

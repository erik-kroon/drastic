import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Domain from "@open-erp/domain/payroll-runs";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/payroll/settlements";
import {
  decode,
  readEvidenceReference,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { paidItemPopulation } from "./settlement-items";
import { verifyRunLedger, verifyRecoveryLedger } from "./settlement-ledger";
import { digest, newId, replay, saveCommand, sha256Hex } from "../posting";
import { failure } from "../failures";
import {
  readRetained,
  requireSettlementAccess,
  seal,
  persist,
  ClaimRecord,
  ReportingCorrection,
} from "./settlement-support";

export const preparePeriod = Effect.fn("payroll.preparePaidPeriod")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Settlement.PreparePayrollPeriod.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireSettlementAccess(tx, command.scope, principal.actorId, true);
      const operation = "payroll_prepare_period";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Settlement.PayrollPeriod,
      );

      if (request.previous) return request.previous;
      yield* readEvidenceReference(tx, command.scope.bookId, command.input.evidenceId);
      const paidEvents = [];

      for (const row of yield* Db.readRecords(tx, command.scope.bookId, "payroll_paid_events"))
        paidEvents.push(yield* decode(Settlement.PaidPayrollEvent, row.body));

      if (paidEvents.length > 400) return yield* failure("UnsupportedProfile");

      const periodEvents = paidEvents.filter(
        (event) => event.reportingPeriod === command.input.reportingPeriod,
      );

      if (
        Result.isFailure(Domain.requirePaidRecord(periodEvents)) ||
        periodEvents.some((event) => event.reportingReadiness !== "ready")
      )
        return yield* failure("UnsupportedProfile");
      const claims = [];

      for (const row of yield* Db.readRecords(tx, command.scope.bookId, "payroll_recovery_claims"))
        claims.push(yield* decode(ClaimRecord, row.body));
      yield* verifyRecoveryLedger(tx, command.scope, claims);
      const corrections = [];

      for (const row of yield* Db.readRecords(
        tx,
        command.scope.bookId,
        "payroll_reporting_corrections",
      ))
        corrections.push(yield* decode(ReportingCorrection, row.body));

      const { items, adjustment } = yield* paidItemPopulation(
        command.scope.entityId,
        periodEvents,
        claims,
      );

      let contributionCorrection = 0n;

      for (const paid of periodEvents) {
        const pending = corrections.filter(
          (row) => row.paidEventId === paid.id && row.kind === "gross_recovery",
        );

        for (const correction of pending)
          contributionCorrection += BigInt(correction.contributionDeltaMinor);
      }

      const totals = Domain.aggregateAgiItems(items);
      let posted = 0n;
      let unpaid = 0n;
      let other = 0n;
      const postedRuns = [];

      for (const row of yield* Db.readPostedRuns(tx, command.scope.bookId)) {
        const run = yield* decode(Runs.PayrollRun, row.body);
        yield* verifyRunLedger(tx, command.scope, run);
        postedRuns.push(run);

        for (const obligation of run.employeeObligations) {
          posted += BigInt(obligation.grossMinor);

          const paid = paidEvents.find(
            (event) => event.runId === run.id && event.employeeId === obligation.employeeId,
          );

          if (!paid) unpaid += BigInt(obligation.grossMinor);
          else if (paid.reportingPeriod !== command.input.reportingPeriod)
            other += BigInt(obligation.grossMinor);
        }
      }

      if (postedRuns.length > 400) return yield* failure("UnsupportedProfile");

      const checked = Domain.assertAgiReconciliation({
        postedAccrualsMinor: posted.toString(),
        unpaidMinor: unpaid.toString(),
        otherPeriodMinor: other.toString(),
        adjustmentMinor: [adjustment.toString()],
        declaredMinor: totals.grossMinor,
      });

      if (Result.isFailure(checked)) return yield* failure("InvalidJournal");

      const reconciliation = {
        postedAccrualsMinor: posted.toString(),
        unpaidMinor: unpaid.toString(),
        otherPeriodMinor: other.toString(),
        adjustmentMinor: adjustment.toString(),
      };

      const content = JSON.stringify({
        profile: "synthetic_paid_semantics_v1",
        items,
        totals,
        reconciliation,
        externalState: "not_submitted",
      });

      const result = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Settlement.PayrollPeriod,
        {
          id: newId("payroll_paid_period"),
          reportingPeriod: command.input.reportingPeriod,
          profile: "synthetic_paid_semantics_v1",
          sourceDigest: yield* digest({ paidEvents, claims, corrections, postedRuns }),
          items,
          totals,
          reconciliation,
          contributionCorrectionMinor: contributionCorrection.toString(),
          contributionOutcome: "pending_qualification_or_reassessment",
          externalState: "not_submitted",
          artifact: {
            mediaType: "application/json",
            content,
            sha256: `sha256:${yield* sha256Hex(content)}`,
          },
        },
      );

      yield* persist(tx, "payroll_period_revisions", result);
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

export const getPeriod = Effect.fn("payroll.getPaidPeriod")(function* (
  token: string,
  command: { readonly scope: Scope; readonly periodId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requireSettlementAccess(tx, command.scope, principal.actorId, false);

    return yield* readRetained(
      tx,
      command.scope,
      "payroll_period_revisions",
      command.periodId,
      Settlement.PayrollPeriod,
    );
  });
});

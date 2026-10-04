import * as O from "@open-erp/contracts/onboarding";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../db/onboarding-imports";
import * as HistoricalDb from "../db/historical";
import * as LifecycleDb from "../db/onboarding-lifecycle";
import * as Ledger from "../db/posting";
import * as SourceDb from "../db/sie-import";
import type { Transaction } from "../db/transaction";
import { databaseFailure } from "../db/transaction";
import { decode, type Scope } from "./commerce/support";
import { failure } from "./failures";
import { withAdmittedPrincipal } from "./identity";
import {
  approveChangeInTransaction,
  digest,
  isoNow,
  newId,
  readBook,
  readExecutionApprovalInTransaction,
  replay,
  saveCommand,
} from "./posting";
import {
  advanceFinancialRunInTransaction,
  prepareFinancialVoucherInTransaction,
} from "./sie/historical-financial";
import { readPlan } from "./sie/historical-shared";

type Command<Input> = { scope: Scope; idempotencyKey: string; input: Input };

type Batch = typeof O.OnboardingImportBatch.Type;

const importMaterial = Effect.fn("onboarding.importMaterial")(function* (
  tx: Transaction,
  scope: Scope,
  runId: string,
) {
  const run = (yield* HistoricalDb.readRun(tx, scope.bookId, runId))[0];

  if (!run) return yield* failure("NotFound");
  const source = (yield* SourceDb.readRun(tx, scope.bookId, run.sourceRunId))[0];

  if (!source) return yield* failure("NotFound");
  const plan = yield* readPlan(tx, scope, source.planId);

  if (
    plan.digest !== run.planDigest ||
    (yield* Db.readQualifiedPlan(tx, scope.bookId, plan.id, plan.digest)).length === 0
  )
    return yield* failure("ApprovalRequired");

  return { run, plan };
});

const currentBatch = Effect.fn("onboarding.currentImportBatch")(function* (
  tx: Transaction,
  scope: Scope,
  batch: Batch,
) {
  const material = yield* importMaterial(tx, scope, batch.financialRunId);
  const { run, plan } = material;

  if (
    run.status !== "running" ||
    run.fence !== batch.fence ||
    run.nextOrdinal !== batch.firstOrdinal ||
    run.planDigest !== batch.sourcePlanDigest ||
    plan.id !== batch.sourcePlanId ||
    Date.parse(run.leaseUntil) <= Date.parse(yield* isoNow(tx))
  )
    return yield* failure("StaleDependency");

  if (
    (yield* readBook(tx, scope)).authority !== "native" ||
    (yield* LifecycleDb.readRecords(tx, "activations", scope.bookId)).length > 0
  )
    return yield* failure("StaleDependency");

  return material;
});

const readBatch = Effect.fn("onboarding.readImportBatch")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readImportBatchRecord(
    tx,
    scope.bookId,
    "prepare_onboarding_import_batch",
    id,
  ))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(O.OnboardingImportBatch, row.body);
});

export const prepareOnboardingImportBatch = Effect.fn("onboarding.import.prepareBatch")(function* (
  token: string,
  command: Command<typeof O.PrepareOnboardingImportBatch.Type>,
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const { scope, idempotencyKey, input } = command;
        const operation = "prepare_onboarding_import_batch";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          input,
          O.OnboardingImportBatch,
        );

        if (request.previous) return request.previous;
        const policies = yield* LifecycleDb.readRecords(tx, "responsibilities", scope.bookId);

        if (policies.length > 1000) return yield* failure("UnsupportedProfile");

        const retainedPolicies = yield* Effect.forEach(policies, (row) =>
          decode(O.OnboardingResponsibilities, row.body),
        );

        const policy = retainedPolicies.toSorted((a, b) => b.revision - a.revision)[0];

        if (!policy || policy.assignments.preparerId !== principal.actorId)
          return yield* failure("Forbidden");
        const { run, plan } = yield* importMaterial(tx, scope, input.financialRunId);

        if (
          run.fence !== input.expectedFence ||
          run.nextOrdinal !== input.expectedNextOrdinal ||
          plan.digest !== input.expectedSourcePlanDigest
        )
          return yield* failure("StaleDependency");
        const previewRecord = (yield* SourceDb.readPreview(tx, scope.bookId, plan.previewId))[0];

        if (!previewRecord) return yield* failure("NotFound");
        const preview = yield* decode(Sie.SiePreview, previewRecord.body);

        const vouchers = preview.vouchers
          .filter((voucher) => voucher.ordinal >= run.nextOrdinal)
          .slice(0, 20);

        if (vouchers.length === 0) return yield* failure("AlreadyPosted");
        const periods = yield* Ledger.readAllPeriods(tx, scope.bookId);
        const proposals: Array<Batch["proposals"][number]> = [];

        for (const voucher of vouchers) {
          const date = `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`;

          const matching = periods.filter(
            (period) =>
              period.fiscalYearId === run.fiscalYearId &&
              period.startsOn <= date &&
              period.endsOn >= date &&
              !period.locked,
          );

          const period = matching[0];

          if (!period || matching.length !== 1) return yield* failure("PeriodLocked");

          const change = yield* prepareFinancialVoucherInTransaction(
            tx,
            principal,
            {
              scope,
              id: run.id,
              idempotencyKey: `${idempotencyKey}_voucher_${voucher.ordinal}`,
              input: {
                fence: run.fence,
                planDigest: plan.digest,
                ordinal: voucher.ordinal,
                accountingPeriodId: period.id,
                series: voucher.series,
                rationale: input.rationale,
              },
            },
            { firstOrdinal: run.nextOrdinal, count: vouchers.length },
          );

          proposals.push({
            ordinal: voucher.ordinal,
            sourceReference: voucher.sourceReference,
            change,
          });
        }

        const material = {
          id: newId("onboardingbatch"),
          scope,
          financialRunId: run.id,
          sourcePlanId: plan.id,
          sourcePlanDigest: plan.digest,
          fence: run.fence,
          firstOrdinal: run.nextOrdinal,
          proposals,
          preparedBy: principal.actorId,
          preparedAt: yield* isoNow(tx),
        };

        const batch = yield* Schema.decodeEffect(O.OnboardingImportBatch)({
          ...material,
          digest: yield* digest(material),
        }).pipe(Effect.mapError((cause) => failure("InternalError", cause)));

        yield* currentBatch(tx, scope, batch);
        yield* saveCommand(
          tx,
          scope,
          idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          batch,
        );

        return batch;
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});

export const approveOnboardingImportBatch = Effect.fn("onboarding.import.approveBatch")(function* (
  token: string,
  command: Command<typeof O.ApproveOnboardingImportBatch.Type>,
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const { scope, idempotencyKey, input } = command;
        const operation = "approve_onboarding_import_batch";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          input,
          O.OnboardingImportBatchApproval,
        );

        if (request.previous) return request.previous;
        const batch = yield* readBatch(tx, scope, input.batchId);

        if (batch.digest !== input.expectedDigest) return yield* failure("StaleDependency");

        if (batch.preparedBy === principal.actorId) return yield* failure("Forbidden");
        yield* currentBatch(tx, scope, batch);

        const approvals = yield* Effect.forEach(batch.proposals, (proposal) =>
          approveChangeInTransaction(tx, principal, {
            scope,
            changeSetId: proposal.change.id,
            idempotencyKey: `${idempotencyKey}_${proposal.ordinal}`,
            input: { planDigest: proposal.change.planDigest, version: proposal.change.version },
          }),
        );

        const result = {
          id: newId("onboardingbatchapproval"),
          scope,
          batchId: batch.id,
          batchDigest: batch.digest,
          approvals,
          approvedBy: principal.actorId,
          approvedAt: yield* isoNow(tx),
        };

        yield* saveCommand(
          tx,
          scope,
          idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          result,
        );

        return result;
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});

export const executeOnboardingImportBatch = Effect.fn("onboarding.import.executeBatch")(function* (
  token: string,
  command: Command<typeof O.ExecuteOnboardingImportBatch.Type>,
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const { scope, idempotencyKey, input } = command;
        const operation = "execute_onboarding_import_batch";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          input,
          Historical.Chunk,
        );

        if (request.previous) return request.previous;
        const batch = yield* readBatch(tx, scope, input.batchId);

        if (batch.digest !== input.expectedDigest) return yield* failure("StaleDependency");
        yield* currentBatch(tx, scope, batch);

        const approvalRecord = (yield* Db.readImportBatchRecord(
          tx,
          scope.bookId,
          "approve_onboarding_import_batch",
          input.approvalId,
        ))[0];

        if (!approvalRecord) return yield* failure("NotFound");
        const approval = yield* decode(O.OnboardingImportBatchApproval, approvalRecord.body);

        if (
          approval.batchId !== batch.id ||
          approval.batchDigest !== batch.digest ||
          approval.approvedBy === batch.preparedBy
        )
          return yield* failure("ApprovalRequired");
        const items = [];

        for (const proposal of batch.proposals) {
          const binding = approval.approvals.find(
            (entry) =>
              entry.changeSetId === proposal.change.id &&
              entry.planDigest === proposal.change.planDigest,
          );

          if (!binding) return yield* failure("ApprovalRequired");
          items.push({
            changeSetId: proposal.change.id,
            planDigest: proposal.change.planDigest,
            approvalId: binding.id,
          });
        }

        const chunk = yield* advanceFinancialRunInTransaction(tx, principal, {
          scope,
          id: batch.financialRunId,
          idempotencyKey: `${idempotencyKey}_financial`,
          input: {
            fence: batch.fence,
            planDigest: batch.sourcePlanDigest,
            firstOrdinal: batch.firstOrdinal,
            items,
          },
        });

        yield* saveCommand(
          tx,
          scope,
          idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          chunk,
        );

        return chunk;
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});

export const getOnboardingImportBatch = Effect.fn("onboarding.import.batchWorkspace")(function* (
  token: string,
  command: { scope: Scope; financialRunId: string },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: false },
    (tx) =>
      Effect.gen(function* () {
        const { scope } = command;
        const { run, plan } = yield* importMaterial(tx, scope, command.financialRunId);
        const items = yield* HistoricalDb.readPostings(tx, scope.bookId, run.id);

        const row =
          run.status === "posted"
            ? undefined
            : (yield* Db.readCurrentBatch(tx, scope.bookId, run.id, run.fence, run.nextOrdinal))[0];

        const batch = row ? yield* decode(O.OnboardingImportBatch, row.body) : null;

        const approvalRow = batch
          ? (yield* Db.readBatchApproval(tx, scope.bookId, batch.id))[0]
          : undefined;

        const approval = approvalRow
          ? yield* decode(O.OnboardingImportBatchApproval, approvalRow.body)
          : null;

        const approvalChecks = approval
          ? yield* Effect.forEach(approval.approvals, (entry) =>
              readExecutionApprovalInTransaction(
                tx,
                scope,
                { id: entry.changeSetId, planDigest: entry.planDigest },
                entry.id,
              ).pipe(
                Effect.as(true),
                Effect.catchTag("AccountingError", (error) =>
                  error.code === "ApprovalRequired" ? Effect.succeed(false) : Effect.fail(error),
                ),
              ),
            )
          : [];

        const approvalCurrent =
          approvalChecks.length === batch?.proposals.length && approvalChecks.every(Boolean);

        return yield* Schema.decodeUnknownEffect(O.OnboardingImportBatchWorkspace)({
          run: { ...run, items },
          total: plan.voucherCount,
          batch,
          approval,
          approvalCurrent,
        }).pipe(Effect.mapError((cause) => failure("InternalError", cause)));
      }).pipe(Effect.mapError(databaseFailure)),
    "share",
  );
});

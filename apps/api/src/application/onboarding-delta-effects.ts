import * as A from "@open-erp/contracts/accounting";
import * as D from "@open-erp/contracts/onboarding-deltas";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Db from "../db/onboarding-deltas";
import * as LifecycleDb from "../db/onboarding-lifecycle";
import * as Ledger from "../db/posting";
import { databaseFailure, type Transaction } from "../db/transaction";
import { decode, toJsonObject, type Scope } from "./commerce/support";
import { failure } from "./failures";
import { withAdmittedPrincipal } from "./identity";
import { readOnboardingDeltaInTransaction } from "./onboarding-deltas";
import {
  approveChangeInTransaction,
  createEvidenceInTransaction,
  digest,
  executeChangeInTransaction,
  isoNow,
  newId,
  prepareCorrectionInTransaction,
  prepareJournalInTransaction,
  readBook,
  readExecutionApprovalInTransaction,
  readVoucher,
  replay,
  saveCommand,
} from "./posting";
import { linesFor } from "./sie/historical-financial";
import { readPlan } from "./sie/historical-shared";

function sourceDate(voucher: typeof Sie.Voucher.Type) {
  return `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`;
}

function validateMaterial(
  tx: Transaction,
  scope: Scope,
  deltaId: string,
  sourceReference: string,
  sourcePlanId: string,
  sourcePlanDigest: string,
) {
  return Effect.gen(function* () {
    if ((yield* LifecycleDb.readRecords(tx, "activations", scope.bookId)).length > 0)
      return yield* failure("StaleDependency");

    if ((yield* readBook(tx, scope)).authority !== "native")
      return yield* failure("StaleDependency");
    const view = yield* readOnboardingDeltaInTransaction(tx, scope, deltaId);
    const row = view.delta.rows.find((entry) => entry.sourceReference === sourceReference);

    const decision = view.decisions
      .filter((entry) => entry.sourceReference === sourceReference)
      .at(-1);

    if (!view.current || !row || row.kind === "unchanged" || decision?.choice !== "use_change")
      return yield* failure("StaleDependency");

    if (view.effects.some((entry) => entry.sourceReference === sourceReference))
      return yield* failure("AlreadyPosted");
    const plan = yield* readPlan(tx, scope, sourcePlanId);

    if (
      plan.digest !== sourcePlanDigest ||
      plan.previewId !== view.delta.candidatePreviewId ||
      plan.previewDigest !== view.delta.candidatePreviewDigest
    )
      return yield* failure("StaleDependency");

    const baseline = yield* Db.readBaselineMappings(
      tx,
      scope.bookId,
      view.delta.sourceSystem,
      view.delta.sourceAccountId,
    );

    if (baseline.length === 0 || baseline.length > 100) return yield* failure("UnsupportedProfile");

    for (const entry of baseline) {
      const previous = yield* decode(Sie.SiePlan, entry.body);

      for (const mapping of previous.input.mappings) {
        if (
          plan.input.mappings.find((item) => item.sourceAccount === mapping.sourceAccount)
            ?.accountId !== mapping.accountId
        )
          return yield* failure("StaleDependency");
      }
    }

    return { view, row, decision, plan };
  });
}

function readProposal(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const record = (yield* Db.readDeltaProposal(tx, scope.bookId, id))[0];

    if (!record) return yield* failure("NotFound");

    return yield* decode(D.OnboardingDeltaProposal, record.body);
  });
}

function currentProposal(
  tx: Transaction,
  scope: Scope,
  proposal: typeof D.OnboardingDeltaProposal.Type,
) {
  return Effect.gen(function* () {
    const material = yield* validateMaterial(
      tx,
      scope,
      proposal.deltaId,
      proposal.sourceReference,
      proposal.sourcePlanId,
      proposal.sourcePlanDigest,
    );

    if (
      material.view.delta.digest !== proposal.deltaDigest ||
      material.decision.id !== proposal.decisionId
    )
      return yield* failure("StaleDependency");

    return material;
  });
}

export const prepareOnboardingDeltaEffect = Effect.fn("onboarding.delta.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof D.PrepareOnboardingDeltaEffect.Type;
  },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const operation = "prepare_onboarding_delta_effect";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          command.input,
          D.OnboardingDeltaProposal,
        );

        if (request.previous) return request.previous;
        const { input, scope, idempotencyKey } = command;

        const material = yield* validateMaterial(
          tx,
          scope,
          input.deltaId,
          input.sourceReference,
          input.sourcePlanId,
          input.expectedSourcePlanDigest,
        );

        if (material.view.delta.digest !== input.expectedDeltaDigest)
          return yield* failure("StaleDependency");
        const period = (yield* Db.readDeltaPeriod(tx, scope.bookId, input.accountingPeriodId))[0];

        if (!period || period.basisMode !== "full_history")
          return yield* failure("UnsupportedProfile");
        const changes: Array<typeof A.ChangeSet.Type> = [];

        if (material.row.originalVoucherId) {
          const original = yield* readVoucher(tx, scope, material.row.originalVoucherId);

          if (
            original.action.accountingPeriodId !== input.accountingPeriodId ||
            !material.row.previous ||
            original.action.postingDate !== sourceDate(material.row.previous)
          )
            return yield* failure("StaleDependency");
          changes.push(
            yield* prepareCorrectionInTransaction(tx, principal, {
              scope,
              voucherId: original.id,
              idempotencyKey: `${idempotencyKey}_reversal`,
              input: {
                accountingPeriodId: input.accountingPeriodId,
                postingDate: original.action.postingDate,
                rationale: input.rationale,
              },
            }),
          );
        }

        const candidate = material.row.candidate;

        if (candidate) {
          const date = sourceDate(candidate);

          if (date < period.startsOn || date > period.endsOn)
            return yield* failure("InvalidJournal");

          const evidence = yield* createEvidenceInTransaction(tx, principal, {
            scope,
            idempotencyKey: `${idempotencyKey}_evidence`,
            input: {
              title: `SIE ${candidate.sourceReference}`,
              origin: "Retained onboarding delta source",
              mediaType: "application/json",
              content: JSON.stringify({
                deltaId: input.deltaId,
                decisionId: material.decision.id,
                sourcePlanId: material.plan.id,
                sourcePlanDigest: material.plan.digest,
                sourceSha256: material.plan.sourceSha256,
                voucher: candidate,
              }),
            },
          });

          changes.push(
            yield* prepareJournalInTransaction(tx, principal, {
              scope,
              idempotencyKey: `${idempotencyKey}_journal`,
              input: {
                kind: "manual_journal",
                evidenceId: evidence.id,
                eventKey: `onboarding_${material.decision.id}`,
                accountingPeriodId: input.accountingPeriodId,
                postingDate: date,
                series: candidate.series,
                description: `SIE ${candidate.sourceReference}`,
                rationale: input.rationale,
                taxAssessment: "not_applicable",
                lines: yield* linesFor(material.plan, candidate),
              },
            }),
          );
        }

        const body = {
          id: newId("onboardingdeltaproposal"),
          scope,
          deltaId: input.deltaId,
          deltaDigest: material.view.delta.digest,
          sourceReference: input.sourceReference,
          decisionId: material.decision.id,
          sourcePlanId: material.plan.id,
          sourcePlanDigest: material.plan.digest,
          changes,
          preparedBy: principal.actorId,
          preparedAt: yield* isoNow(tx),
        };

        const proposal = yield* decode(D.OnboardingDeltaProposal, {
          ...body,
          digest: yield* digest(body),
        });

        yield* Db.insertDeltaProposal(
          tx,
          scope.bookId,
          proposal.id,
          proposal.deltaId,
          proposal.sourceReference,
          proposal.decisionId,
          yield* toJsonObject(proposal),
        );
        yield* saveCommand(
          tx,
          scope,
          idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          proposal,
        );

        return proposal;
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});

export const getOnboardingDeltaProposal = Effect.fn("onboarding.delta.proposal")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withAdmittedPrincipal({ token }, command.scope, { operatorOnly: false }, (tx) =>
    Effect.gen(function* () {
      const proposal = yield* readProposal(tx, command.scope, command.id);

      const current = yield* currentProposal(tx, command.scope, proposal).pipe(
        Effect.mapError(databaseFailure),
        Effect.map(() => true),
        Effect.catchIf(
          (error) => ["StaleDependency", "AlreadyPosted", "NotFound"].includes(error.code),
          () => Effect.succeed(false),
        ),
      );

      const approvals: Array<typeof A.Approval.Type> = [];

      for (const change of proposal.changes) {
        const records = yield* Ledger.readApprovals(tx, command.scope.bookId, change.id);

        for (const record of records) {
          if (
            record.consumedAt === null &&
            record.actorId !== proposal.preparedBy &&
            record.digest === change.planDigest
          ) {
            const eligible = yield* readExecutionApprovalInTransaction(
              tx,
              command.scope,
              { id: change.id, planDigest: change.planDigest },
              record.id,
            ).pipe(
              Effect.as(true),
              Effect.catchTag("AccountingError", (error) =>
                error.code === "ApprovalRequired" ? Effect.succeed(false) : Effect.fail(error),
              ),
            );

            if (eligible)
              approvals.push(yield* decode(A.Approval, { ...record, planDigest: record.digest }));
          }
        }
      }

      return { proposal, approvals, current };
    }).pipe(Effect.mapError(databaseFailure)),
  );
});

export const approveOnboardingDeltaEffect = Effect.fn("onboarding.delta.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof D.ApproveOnboardingDeltaEffect.Type;
  },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const operation = "approve_onboarding_delta_effect";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          command.input,
          D.OnboardingDeltaApproval,
        );

        if (request.previous) return request.previous;
        const proposal = yield* readProposal(tx, command.scope, command.input.proposalId);

        if (proposal.digest !== command.input.expectedDigest)
          return yield* failure("StaleDependency");

        if (proposal.preparedBy === principal.actorId) return yield* failure("ApprovalRequired");
        yield* currentProposal(tx, command.scope, proposal);
        const approvals: Array<typeof A.Approval.Type> = [];

        for (const change of proposal.changes)
          approvals.push(
            yield* approveChangeInTransaction(tx, principal, {
              scope: command.scope,
              changeSetId: change.id,
              idempotencyKey: `${command.idempotencyKey}_${approvals.length}`,
              input: { planDigest: change.planDigest, version: change.version },
              owner: { kind: "onboarding_delta", id: proposal.id },
            }),
          );
        const result = { proposalId: proposal.id, approvals };
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
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

export const executeOnboardingDeltaEffect = Effect.fn("onboarding.delta.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof D.ExecuteOnboardingDeltaEffect.Type;
  },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const operation = "execute_onboarding_delta_effect";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          command.input,
          D.OnboardingDeltaEffect,
        );

        if (request.previous) return request.previous;
        const proposal = yield* readProposal(tx, command.scope, command.input.proposalId);

        if (proposal.digest !== command.input.expectedDigest)
          return yield* failure("StaleDependency");
        const material = yield* currentProposal(tx, command.scope, proposal);

        if (
          command.input.approvalIds.length !== proposal.changes.length ||
          new Set(command.input.approvalIds).size !== proposal.changes.length
        )
          return yield* failure("ApprovalRequired");
        const receipts: Array<typeof A.ExecutionReceipt.Type> = [];

        for (const [index, change] of proposal.changes.entries()) {
          const approvalId = command.input.approvalIds[index];

          if (!approvalId) return yield* failure("ApprovalRequired");

          const approval = yield* readExecutionApprovalInTransaction(
            tx,
            command.scope,
            change,
            approvalId,
          );

          if (approval.actorId === proposal.preparedBy) return yield* failure("ApprovalRequired");
          receipts.push(
            yield* executeChangeInTransaction(tx, principal, {
              scope: command.scope,
              changeSetId: change.id,
              idempotencyKey: `${command.idempotencyKey}_${index}`,
              input: { approvalId, planDigest: change.planDigest, version: change.version },
              owner: { kind: "onboarding_delta", id: proposal.id },
            }),
          );
        }

        const last = receipts.at(-1);
        const source = material.row.candidate ?? material.row.previous;

        if (!last || !source) return yield* failure("InternalError");

        const body = {
          id: newId("onboardingdeltaeffect"),
          scope: command.scope,
          deltaId: proposal.deltaId,
          proposalId: proposal.id,
          sourceSystem: material.view.delta.sourceSystem,
          sourceAccountId: material.view.delta.sourceAccountId,
          sourceReference: proposal.sourceReference,
          decisionId: proposal.decisionId,
          candidate: material.row.candidate,
          effectiveVoucherId: material.row.candidate ? last.voucherId : null,
          sourceDigest: yield* digest(material.row.candidate),
          sourceYear: source.date.slice(0, 4),
          executedSequence: last.sequence,
          receipts,
          executedBy: principal.actorId,
          executedAt: yield* isoNow(tx),
        };

        const result = yield* decode(D.OnboardingDeltaEffect, {
          ...body,
          digest: yield* digest(body),
        });

        yield* Db.insertDeltaEffect(
          tx,
          command.scope.bookId,
          result.id,
          result.deltaId,
          result.proposalId,
          result.sourceReference,
          result.executedSequence,
          yield* toJsonObject(result),
        );
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
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

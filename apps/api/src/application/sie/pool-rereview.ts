import * as Contracts from "@open-erp/contracts/historical-adoptions";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Db from "../../db/historical-adoptions";
import * as HistoricalDb from "../../db/historical";
import * as SourceDb from "../../db/sie-import";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { readPlan, requireStaged } from "./historical-shared";
import { readOriginalPool, readPool, readRevision, sourceResiduals } from "./adoption-basis";

const sourceIdentity = Effect.fn("historical.poolSourceIdentity")(function* (
  tx: Transaction,
  scope: Scope,
  sourcePlanId: string,
) {
  const plan = yield* readPlan(tx, scope, sourcePlanId);
  const row = (yield* SourceDb.readPreview(tx, scope.bookId, plan.previewId))[0];

  if (!row) return yield* failure("MissingEvidence");
  const preview = yield* decode(Sie.SiePreview, row.body);
  const source = (yield* SourceDb.readSource(tx, scope.bookId, preview.occurrenceId))[0];

  if (!source) return yield* failure("MissingEvidence");

  return { plan, source, occurrenceId: preview.occurrenceId };
});

export const rereviewHistoricalPool = Effect.fn("historical.rereviewPool")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Contracts.RereviewPool.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command;
      const operation = "rereview_historical_pool";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { poolId: id, input },
        Contracts.PoolRevision,
      );

      if (request.previous) return request.previous;

      if (principal.kind !== "betterAuthSession") return yield* failure("Forbidden");
      const pool = yield* readPool(tx, scope, id);

      if (pool.digest !== input.expectedPoolDigest) return yield* failure("StaleDependency");

      if ((yield* Db.readAdoptions(tx, scope.bookId, id)).length)
        return yield* failure("AlreadyPosted");
      const row = (yield* HistoricalDb.readItems(tx, scope.bookId, input.admissionId))[0];

      if (!row) return yield* failure("NotFound");
      const admission = yield* decode(Historical.ItemAdmission, row.body);

      if (admission.digest !== input.admissionDigest) return yield* failure("StaleDependency");

      if (admission.id === pool.input.admissionId) return yield* failure("IdempotencyConflict");
      yield* requireStaged(tx, scope, admission.sourcePlanId);
      const original = yield* sourceIdentity(tx, scope, pool.sourcePlanId);
      const reviewed = yield* sourceIdentity(tx, scope, admission.sourcePlanId);

      if (
        original.source.sha256 !== reviewed.source.sha256 ||
        original.source.sourceSystem !== reviewed.source.sourceSystem ||
        (yield* digest(original.plan.input.mappings)) !==
          (yield* digest(reviewed.plan.input.mappings)) ||
        (yield* digest(original.plan.input.openingControls)) !==
          (yield* digest(reviewed.plan.input.openingControls))
      )
        return yield* failure("StaleDependency");

      const items = admission.openItems.filter(
        (item) => item.sourceAccount === pool.input.sourceAccount,
      );

      const controls = admission.openItemControls.filter(
        (item) => item.sourceAccount === pool.input.sourceAccount,
      );

      if (
        controls.length !== 1 ||
        controls[0]!.currency !== pool.currency ||
        items.length !== pool.sourceItems.length ||
        items.some(
          (item) =>
            item.currency !== pool.currency ||
            item.asOf !== pool.input.cutoverOn ||
            !pool.sourceItems.some((saved) => saved.sourceIdentity === item.sourceIdentity) ||
            (pool.input.direction === "AR"
              ? BigInt(item.outstandingMinor) < 0n
              : BigInt(item.outstandingMinor) > 0n),
        )
      )
        return yield* failure("UnsupportedProfile");

      const sourceItems = yield* sourceResiduals(
        admission,
        items,
        pool.sourcePlanId,
        pool.input.direction,
        pool.currency,
        pool.controlAccountId,
      );

      const exact = sourceItems.reduce(
        (sum, item) =>
          sum +
          (item.residualAtCutover.kind === "evidenced"
            ? BigInt(item.residualAtCutover.amountMinor)
            : 0n),
        0n,
      );

      const signed = pool.input.direction === "AR" ? exact : -exact;

      if (exact <= 0n || signed !== BigInt(controls[0]!.independentOutstandingMinor))
        return yield* failure("InvalidJournal");
      const prior = yield* readRevision(tx, scope, id);
      const createdAt = yield* isoNow(tx);

      const poolBody = {
        id: pool.id,
        scope,
        sourcePlanId: pool.sourcePlanId,
        sourceSystem: pool.sourceSystem,
        basisMode: pool.basisMode,
        controlAccountId: pool.controlAccountId,
        currency: pool.currency,
        basisDigest: pool.basisDigest,
        input: {
          ...pool.input,
          admissionId: admission.id,
          admissionDigest: admission.digest,
          rationale: input.rationale,
        },
        sourceItems,
        exactResidualMinor: exact.toString(),
        partitionDigest: yield* digest({
          admissionDigest: admission.digest,
          sourceItems,
          control: controls[0]!,
        }),
        createdBy: principal.actorId,
        createdAt,
      };

      const current = yield* decode(Contracts.Pool, {
        ...poolBody,
        digest: yield* digest(poolBody),
      });

      const body = {
        id: newId("historicalrevision"),
        poolId: id,
        ordinal: (prior?.ordinal ?? 0) + 1,
        input,
        pool: current,
        createdBy: principal.actorId,
        createdAt,
      };

      const result = yield* decode(Contracts.PoolRevision, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertRevision(tx, scope.bookId, result);
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
    },
    "update",
  );
});

export const getHistoricalAdoptionWorkspace = Effect.fn("historical.getAdoptionWorkspace")(
  function* (token: string, command: { scope: Scope; id: string }) {
    return yield* withBook(token, command.scope, false, function* (tx) {
      const { scope, id } = command;
      const row = (yield* Db.readPlan(tx, scope.bookId, id))[0];

      if (!row) return yield* failure("NotFound");
      const plan = yield* decode(Contracts.AdoptionPlan, row.body);
      const currentPool = yield* readPool(tx, scope, plan.input.poolId);

      const preparedPool =
        plan.capturedPool ?? (yield* readOriginalPool(tx, scope, currentPool.id));

      const revision = yield* readRevision(tx, scope, currentPool.id);
      const approvalRows = yield* Db.readPlanApprovals(tx, scope.bookId, id);

      if (approvalRows.length > 20) return yield* failure("UnsupportedProfile");

      const approvals = yield* Effect.forEach(approvalRows, (record) =>
        decode(Contracts.Approval, record.body),
      );

      const adoptionRow = (yield* Db.readAdoptionForPlan(tx, scope.bookId, id))[0];
      const adoption = adoptionRow ? yield* decode(Contracts.Adoption, adoptionRow.body) : null;

      const glMinor =
        (yield* HistoricalDb.readBalances(
          tx,
          scope.bookId,
          currentPool.input.cutoverOn,
          true,
        )).find((balance) => balance.accountId === currentPool.controlAccountId)?.amount ?? "0";

      const signed =
        currentPool.input.direction === "AR"
          ? BigInt(currentPool.exactResidualMinor)
          : -BigInt(currentPool.exactResidualMinor);

      const currentSource = yield* sourceIdentity(
        tx,
        scope,
        (yield* decode(
          Historical.ItemAdmission,
          (yield* HistoricalDb.readItems(tx, scope.bookId, currentPool.input.admissionId))[0]!.body,
        )).sourcePlanId,
      );

      const source = yield* sourceIdentity(tx, scope, preparedPool.sourcePlanId);
      const adoptionRows = yield* Db.readAdoptions(tx, scope.bookId, currentPool.id);

      const adoptions = yield* Effect.forEach(adoptionRows, (record) =>
        decode(Contracts.Adoption, record.body),
      );

      const assignments = adoptions.map((record) => ({
        id: record.id,
        amountMinor: record.openingResidualMinor,
      }));

      const adopted = adoptions.reduce(
        (sum, record) => sum + BigInt(record.openingResidualMinor),
        0n,
      );

      const originalPool = yield* readOriginalPool(tx, scope, currentPool.id);

      const name = revision
        ? ((yield* Db.reviewerName(tx, revision.createdBy))[0]?.name ?? null)
        : null;

      const version = yield* digest(
        revision ? { poolDigest: currentPool.digest, assignments } : assignments,
      );

      return yield* decode(Contracts.AdoptionWorkspace, {
        plan,
        preparedPool,
        currentPool,
        revision,
        approvals,
        adoption,
        glMinor,
        differenceMinor: (BigInt(glMinor) - signed).toString(),
        stale: version !== plan.poolVersion,
        sourceOccurrenceId: source.occurrenceId,
        currentSourceOccurrenceId: currentSource.occurrenceId,
        currentSourcePlanId: currentSource.plan.id,
        currentPreviewId: currentSource.plan.previewId,
        reviewerName: name,
        adoptedMinor: adopted.toString(),
        originalUnadoptedMinor: (BigInt(originalPool.exactResidualMinor) - adopted).toString(),
      });
    });
  },
);

export const listHistoricalAdoptionPlans = Effect.fn("historical.listAdoptionPlans")(function* (
  token: string,
  command: { scope: Scope; query: typeof Contracts.AdoptionPageQuery.Type },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const { scope, query } = command;

    if (query.after && !(yield* Db.readPlan(tx, scope.bookId, query.after)).length)
      return yield* failure("NotFound");
    const rows = yield* Db.listPlans(tx, scope.bookId, query.after ?? null);

    const items = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      decode(Contracts.AdoptionPlan, row.body),
    );

    return { scope, items, next: rows.length > 20 ? items.at(-1)!.id : null };
  });
});

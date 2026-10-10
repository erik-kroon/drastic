import { runBookCommand } from "../book-commands";
import * as Contracts from "@open-erp/contracts/historical-adoptions";
import * as Domain from "@open-erp/domain/historical-adoptions";
import * as Effect from "effect/Effect";
import * as Db from "../../db/historical-adoptions";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "../commerce/support";
import { approvalExpiry } from "../commerce/approval";
import { readHistoricalObligation } from "../commerce/historical-obligations";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { readPool, domainPool, checkedAdoption } from "./adoption-basis";
import { authorize } from "../authority";

export {
  rereviewHistoricalPool,
  getHistoricalAdoptionWorkspace,
  listHistoricalAdoptionPlans,
} from "./pool-rereview";

export { createHistoricalPool } from "./adoption-basis";

type Command = { scope: Scope; id: string; idempotencyKey: string };

const readAdoptionPlan = Effect.fn("historical.readAdoptionPlan")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readPlan(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(Contracts.AdoptionPlan, row.body);
});

export const prepareHistoricalAdoption = Effect.fn("historical.prepareAdoption")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Contracts.PrepareAdoption.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_historical_adoption";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: input,
        },
        Contracts.AdoptionPlan,
        Effect.gen(function* () {
          const pool = yield* readPool(tx, scope, input.poolId);

          if (pool.digest !== input.poolDigest) return yield* failure("StaleDependency");

          const current = yield* domainPool(tx, scope, pool);

          const item = pool.sourceItems.find((row) => row.sourceIdentity === input.sourceIdentity);

          if (!item) return yield* failure("NotFound");

          const known = yield* Db.readKnownIdentities(tx, scope.bookId, pool.sourceSystem);

          const plan = yield* checkedAdoption(
            Domain.prepareAdoption({
              pool: current.control,
              item,
              fullHistorySelected: pool.basisMode === "full_history",
              openingSetSelected: pool.basisMode === "opening_set",
              assignedMinor: current.adoptions.map((row) => row.openingResidualMinor),
              knownSourceIdentities: known.map((row) => row.sourceIdentity),
              knownNativeObligationIds: [],
              nativeObligationId: null,
              adoptionId: newId("historicaladoption"),
              liveObligationId: newId("historicalobligation"),
            }),
          );

          const body = {
            id: newId("historicalplan"),
            scope,
            input,
            poolVersion: current.version,
            capturedPool: pool,
            plan,
            createdBy: principal.actorId,
            createdAt: yield* isoNow(tx),
          };

          const result = yield* decode(Contracts.AdoptionPlan, {
            ...body,
            digest: yield* digest(body),
          });

          yield* Db.insertPlan(tx, scope.bookId, result);

          return result;
        }),
      );
    },
    "update",
  );
});

export const getHistoricalAdoptionPlan = Effect.fn("historical.getAdoptionPlan")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    return yield* readAdoptionPlan(tx, command.scope, command.id);
  });
});

export const approveHistoricalAdoption = Effect.fn("historical.approveAdoption")(function* (
  token: string,
  command: Command & { input: typeof Contracts.Approve.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command,
        operation = "approve_historical_adoption";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { planId: id, input },
        },
        Contracts.Approval,
        Effect.gen(function* () {
          yield* authorize(principal, "approve_historical_adoption");
          const plan = yield* readAdoptionPlan(tx, scope, id);

          if (plan.digest !== input.digest) return yield* failure("StaleDependency");

          const pool = yield* readPool(tx, scope, plan.input.poolId),
            current = yield* domainPool(tx, scope, pool);

          if (current.version !== plan.poolVersion) return yield* failure("StaleDependency");

          const result = yield* decode(Contracts.Approval, {
            id: newId("historicalapproval"),
            planId: id,
            planDigest: plan.digest,
            actorId: principal.actorId,
            expiresAt: yield* approvalExpiry(tx),
            createdAt: yield* isoNow(tx),
          });

          yield* Db.insertApproval(tx, scope.bookId, result);

          return result;
        }),
      );
    },
    "update",
  );
});

export const executeHistoricalAdoption = Effect.fn("historical.executeAdoption")(function* (
  token: string,
  command: Command & { input: typeof Contracts.Execute.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command,
        operation = "execute_historical_adoption";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { planId: id, input },
        },
        Contracts.Adoption,
        Effect.gen(function* () {
          const plan = yield* readAdoptionPlan(tx, scope, id);

          if (plan.digest !== input.digest) return yield* failure("StaleDependency");

          if ((yield* Db.readAdoptionForPlan(tx, scope.bookId, id)).length)
            return yield* failure("AlreadyPosted");

          const pool = yield* readPool(tx, scope, plan.input.poolId),
            current = yield* domainPool(tx, scope, pool);

          const known = yield* Db.readKnownIdentities(tx, scope.bookId, pool.sourceSystem);
          yield* checkedAdoption(
            Domain.assertConservedPoolAssignment(plan.plan, current.control, {
              poolVersion: current.version,
              exactReviewedResidualMinor: pool.exactResidualMinor,
              assignedMinor: current.adoptions.map((row) => row.openingResidualMinor),
              knownSourceIdentities: known.map((row) => row.sourceIdentity),
              knownNativeObligationIds: [],
            }),
          );
          const row = (yield* Db.readApproval(tx, scope.bookId, input.approvalId))[0];

          if (!row) return yield* failure("ApprovalRequired");

          const approval = yield* decode(Contracts.Approval, row.body);

          if (approval.planId !== plan.id || approval.planDigest !== plan.digest)
            return yield* failure("ApprovalRequired");

          const item = pool.sourceItems.find(
            (row) => row.sourceIdentity === plan.plan.sourceIdentity,
          );

          if (!item) return yield* failure("InternalError");

          const result = yield* decode(Contracts.Adoption, {
            id: plan.plan.adoptionId,
            scope,
            planId: id,
            poolId: pool.id,
            sourceIdentity: item.sourceIdentity,
            liveObligationId: plan.plan.liveObligationId,
            openingResidualMinor: plan.plan.residualAtCutoverMinor,
            sourceItem: item,
            approvalId: approval.id,
            journalIds: [],
            glDeltaMinor: "0",
            createdAt: yield* isoNow(tx),
          });

          yield* Db.insertAdoption(tx, scope.bookId, pool.sourcePlanId, pool.sourceSystem, result);

          return result;
        }),
      );
    },
    "update",
  );
});

export const getHistoricalPool = Effect.fn("historical.getPool")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const pool = yield* readPool(tx, command.scope, command.id),
      current = yield* domainPool(tx, command.scope, pool);

    const adopted = current.adoptions.reduce(
        (sum, row) => sum + BigInt(row.openingResidualMinor),
        0n,
      ),
      unadopted = BigInt(pool.exactResidualMinor) - adopted;

    yield* checkedAdoption(
      Domain.assertPoolControl(pool.exactResidualMinor, adopted.toString(), unadopted.toString()),
    );

    const obligations = yield* Effect.forEach(current.adoptions, (row) =>
      readHistoricalObligation(tx, command.scope, row.id),
    );

    return yield* decode(Contracts.PoolControl, {
      pool,
      adoptedMinor: adopted.toString(),
      unadoptedMinor: unadopted.toString(),
      liveMinor: obligations.reduce((sum, row) => sum + BigInt(row.remainingMinor), 0n).toString(),
      settledMinor: obligations.reduce((sum, row) => sum + BigInt(row.settledMinor), 0n).toString(),
      complete: unadopted === 0n,
      version: current.version,
    });
  });
});

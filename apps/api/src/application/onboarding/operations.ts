import * as Db from "../../db/onboarding-operations";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as O from "@open-erp/contracts/onboarding";
import { Database } from "../../db/connection";
import { executeOnboardingActivationInTransaction, onboardingSnapshotCurrent } from "./lifecycle";
import { failure } from "../failures";
import { withTransaction, type Transaction } from "../../db/transaction";

export const fenceOnboardingTarget = Effect.fn("onboarding.operations.fenceTarget")(function* (
  bookId: string,
) {
  const database = yield* Database;

  return yield* database.transaction((tx) =>
    Effect.gen(function* () {
      yield* Db.admitOnboardingOperations(tx);

      const rows = yield* Db.fenceOnboardingTarget(tx, bookId);

      if (rows.length !== 1) return yield* failure("Forbidden");

      return rows[0];
    }),
  );
});

const retainOperationalProofInTransaction = Effect.fn(
  "onboarding.operations.retainProofInTransaction",
)(function* (
  tx: Transaction,
  proof: typeof O.OnboardingOperationalProof.Type,
  priorDatabase: string,
  priorWriterRoles: readonly string[],
) {
  return yield* Effect.gen(function* () {
    yield* Db.admitOnboardingOperations(tx);

    const fence = yield* Db.readPriorWriterFence(tx, priorDatabase, priorWriterRoles);

    if (fence[0]?.safe !== true) return yield* failure("StaleDependency");

    const snapshots = yield* Db.readActivationSnapshot(tx, proof);

    const snapshot = yield* Schema.decodeUnknownEffect(O.OnboardingSnapshot)(snapshots[0]?.body);

    if (
      snapshot.digest !== proof.snapshotDigest ||
      snapshot.scope.entityId !== proof.scope.entityId ||
      snapshot.purpose !== "activation" ||
      Date.parse(proof.expiresAt) <= Date.now() ||
      !(yield* onboardingSnapshotCurrent(tx, snapshot))
    )
      return yield* failure("StaleDependency");

    const retained = yield* Db.readOperationalProof(tx, proof);

    if (retained[0] !== undefined) {
      const existing = yield* Schema.decodeUnknownEffect(O.OnboardingOperationalProof)(
        retained[0].body,
      );

      if (
        existing.artifactDigest !== proof.artifactDigest ||
        existing.snapshotDigest !== proof.snapshotDigest
      )
        return yield* failure("IdempotencyConflict");
    } else {
      yield* Db.insertOperationalProof(tx, proof);
    }

    return proof;
  });
});

export const retainProofAndActivate = Effect.fn("onboarding.operations.activate")(function* (
  proof: typeof O.OnboardingOperationalProof.Type,
  intentId: string,
  priorDatabase: string,
  priorWriterRoles: readonly string[],
) {
  return yield* withTransaction((tx) =>
    Effect.gen(function* () {
      yield* retainOperationalProofInTransaction(tx, proof, priorDatabase, priorWriterRoles);

      return yield* executeOnboardingActivationInTransaction(tx, proof.scope, intentId, proof.id);
    }),
  );
});

export const retainOperationalProof = Effect.fn("onboarding.operations.retainProof")(function* (
  proof: typeof O.OnboardingOperationalProof.Type,
  priorDatabase: string,
  priorWriterRoles: readonly string[],
) {
  return yield* withTransaction((tx) =>
    retainOperationalProofInTransaction(tx, proof, priorDatabase, priorWriterRoles),
  );
});

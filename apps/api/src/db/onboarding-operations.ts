import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as O from "@open-erp/contracts/onboarding";
import { Database } from "./connection";
import { executeOnboardingActivationInTransaction } from "../application/onboarding-lifecycle";
import { failure } from "../application/failures";
import { withTransaction } from "./transaction";

export const fenceOnboardingTarget = Effect.fn("onboarding.operations.fenceTarget")(function* (
  bookId: string,
) {
  const database = yield* Database;

  return yield* database.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.execute(sql`set local role openerp_onboarding_operations`);

      const rows = yield* tx.execute<{ epoch: string }>(
        sql`
      update openerp.books b set authority='onboarding_fenced'
      where b.id=${bookId} and b.profile='synthetic-core-v1'
        and b.authority in ('native','onboarding_fenced')
        and exists(select from openerp.onboarding_cases c where c.book_id=b.id and c.record_class='synthetic')
        and not exists(select from openerp.onboarding_activation_receipts a where a.book_id=b.id)
      returning writer_epoch::text as epoch`,
        "objects",
      );

      if (rows.length !== 1) return yield* failure("Forbidden");

      return rows[0];
    }),
  );
});

export const retainProofAndActivate = Effect.fn("onboarding.operations.activate")(function* (
  proof: typeof O.OnboardingOperationalProof.Type,
  intentId: string,
  priorDatabase: string,
  priorWriterRoles: readonly string[],
) {
  return yield* withTransaction((tx) =>
    Effect.gen(function* () {
      yield* tx.execute(sql`set local role openerp_onboarding_operations`);

      const fence = yield* tx.execute<{ safe: boolean }>(
        sql`
      select not datallowconn and datconnlimit=0
        and not exists(select from pg_stat_activity where datname=${priorDatabase})
        and not exists(select from pg_roles where rolname=any(array[${sql.join(
          priorWriterRoles.map((value) => sql`${value}`),
          sql`, `,
        )}]::text[]) and (rolcanlogin or rolinherit or rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls))
        and not exists(select from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=any(array[${sql.join(
          priorWriterRoles.map((value) => sql`${value}`),
          sql`, `,
        )}]::text[])) as safe
      from pg_database where datname=${priorDatabase}`,
        "objects",
      );

      if (fence[0]?.safe !== true) return yield* failure("StaleDependency");

      const snapshots = yield* tx.execute<{ body: unknown }>(
        sql`
      select body from openerp.onboarding_snapshots where book_id=${proof.scope.bookId} and id=${proof.snapshotId}`,
        "objects",
      );

      const snapshot = yield* Schema.decodeUnknownEffect(O.OnboardingSnapshot)(snapshots[0]?.body);

      if (
        snapshot.digest !== proof.snapshotDigest ||
        snapshot.scope.entityId !== proof.scope.entityId ||
        snapshot.purpose !== "activation"
      )
        return yield* failure("StaleDependency");

      const retained = yield* tx.execute<{ body: unknown }>(
        sql`
      select body from openerp.onboarding_operational_proofs where book_id=${proof.scope.bookId} and id=${proof.id}`,
        "objects",
      );

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
        yield* tx.execute(sql`insert into openerp.onboarding_operational_proofs(book_id,id,snapshot_id,body)
        values(${proof.scope.bookId},${proof.id},${proof.snapshotId},${JSON.stringify(proof)}::jsonb)`);
      }

      return yield* executeOnboardingActivationInTransaction(tx, proof.scope, intentId, proof.id);
    }),
  );
});

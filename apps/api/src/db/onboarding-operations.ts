import { sql } from "drizzle-orm";
import type * as O from "@open-erp/contracts/onboarding";
import type { Transaction } from "./transaction";

export function admitOnboardingOperations(tx: Transaction) {
  return tx.execute(sql`set local role openerp_onboarding_operations`);
}

export function fenceOnboardingTarget(tx: Transaction, bookId: string) {
  return tx.execute<{ epoch: string }>(
    sql`
      update openerp.books b set authority='onboarding_fenced'
      where b.id=${bookId} and b.profile='synthetic-core-v1'
        and b.authority in ('native','onboarding_fenced')
        and exists(select from openerp.onboarding_cases c where c.book_id=b.id and c.record_class='synthetic')
        and not exists(select from openerp.onboarding_activation_receipts a where a.book_id=b.id)
      returning writer_epoch::text as epoch`,
    "objects",
  );
}

export function readPriorWriterFence(
  tx: Transaction,
  priorDatabase: string,
  priorWriterRoles: readonly string[],
) {
  return tx.execute<{ safe: boolean }>(
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
}

export function readActivationSnapshot(
  tx: Transaction,
  proof: typeof O.OnboardingOperationalProof.Type,
) {
  return tx.execute<{ body: unknown }>(
    sql`
      select body from openerp.onboarding_snapshots where book_id=${proof.scope.bookId} and id=${proof.snapshotId}`,
    "objects",
  );
}

export function readOperationalProof(
  tx: Transaction,
  proof: typeof O.OnboardingOperationalProof.Type,
) {
  return tx.execute<{ body: unknown }>(
    sql`
      select body from openerp.onboarding_operational_proofs where book_id=${proof.scope.bookId} and id=${proof.id}`,
    "objects",
  );
}

export function insertOperationalProof(
  tx: Transaction,
  proof: typeof O.OnboardingOperationalProof.Type,
) {
  return tx.execute(sql`insert into openerp.onboarding_operational_proofs(book_id,id,snapshot_id,body)
        values(${proof.scope.bookId},${proof.id},${proof.snapshotId},${JSON.stringify(proof)}::jsonb)`);
}

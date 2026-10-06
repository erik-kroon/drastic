import { randomUUID } from "node:crypto";
import * as Schema from "effect/Schema";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { withDisposableBrowserDatabase } from "./browser-database";

const TimingFixture = Schema.Struct({
  id: Schema.String,
  ordinal: Schema.Int,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  capturedBasisRetained: Schema.Literal(true),
});

export async function insertBoundedSupplierExpiry(
  sessionFile: string,
  origin: string,
  approval: typeof Acceptance.SupplierAcceptanceApproval.Type,
) {
  if (approval.scope.entityId !== "entity_synthetic" || approval.scope.bookId !== "book_synthetic")
    throw new Error("Bounded expiry requires the disposable synthetic approval scope");

  return withDisposableBrowserDatabase(sessionFile, origin, async (client) => {
    const inserted = await client.query(
      `with timing as (
        select date_trunc('milliseconds', clock_timestamp()) + interval '15 seconds' as expires_at
      ), source as (
        select a.* from openerp.supplier_acceptance_approvals a
        join openerp.books b on b.id=a.book_id
        where a.book_id=$1 and b.entity_id=$2 and a.id=$3 and a.review_id=$4
          and a.digest=$5 and a.actor_id=$6 and a.ordinal=$7
          and a.body->'authorityBasis' is not null
          and not exists(select 1 from openerp.supplier_acceptances s
            where s.book_id=a.book_id and s.review_id=a.review_id)
          and not exists(select 1 from openerp.supplier_acceptance_approvals later
            where later.book_id=a.book_id and later.review_id=a.review_id
              and later.ordinal>a.ordinal)
      ), inserted as (
        insert into openerp.supplier_acceptance_approvals
          (book_id,id,review_id,ordinal,actor_id,digest,expires_at,body)
        select s.book_id,$8,s.review_id,s.ordinal+1,s.actor_id,s.digest,t.expires_at,
          s.body || jsonb_build_object(
            'id',$8::text,'ordinal',s.ordinal+1,
            'createdAt',to_char((t.expires_at-interval '1 hour') at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'expiresAt',to_char(t.expires_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'receipt',jsonb_build_object('key',$9::text,
              'operation','approve_supplier_acceptance','actorId',s.actor_id))
        from source s cross join timing t
        returning id,ordinal,body
      )
      select i.id,i.ordinal,i.body->>'createdAt' as "createdAt",
        i.body->>'expiresAt' as "expiresAt",
        i.body->'authorityBasis'=s.body->'authorityBasis' as "capturedBasisRetained"
      from inserted i cross join source s`,
      [
        approval.scope.bookId,
        approval.scope.entityId,
        approval.id,
        approval.reviewId,
        approval.digest,
        approval.actorId,
        approval.ordinal,
        `supplier_approval_timer_${randomUUID().replaceAll("-", "")}`,
        randomUUID(),
      ],
    );

    if (inserted.rows.length !== 1)
      throw new Error("Bounded expiry fixture requires one unconsumed latest native approval");

    return {
      ...Schema.decodeUnknownSync(TimingFixture)(inserted.rows[0]),
      syntheticTimingFixture: true,
      limitation:
        "A separate short-lived approval is inserted only in the disposable cluster. Existing immutable grants and the captured principal basis are retained. Public renewal creates the grant used for execution.",
    };
  });
}

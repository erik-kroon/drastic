import { sql } from "drizzle-orm";
import type { Transaction } from "./transaction";
import type { AiCategory, IdentityKind } from "../adapters/ai-egress";

export type StoredAiIdentity = {
  readonly subjectKey: string;
  readonly kind: IdentityKind;
  readonly name: string;
  readonly alias: string;
};

export function readIdentities(tx: Transaction, bookId: string) {
  return tx.execute<StoredAiIdentity>(
    sql`
    with current_identities as (
    select 'client:' || e.id as "subjectKey", 'CLIENT' as kind, e.name, e.name as alias
    from openerp.books b join openerp.entities e on e.id=b.entity_id where b.id=${bookId}
    union all
    select 'client:' || b.entity_id, 'CLIENT', e.name, b.name
    from openerp.books b join openerp.entities e on e.id=b.entity_id where b.id=${bookId}
    union all
    select 'actor:' || a.id, 'PERSON', a.name, a.name
    from openerp.memberships m join openerp.actors a on a.id=m.actor_id where m.book_id=${bookId}
    union all
    select 'actor:' || a.id, 'PERSON', a.name, v.alias
    from openerp.memberships m join openerp.actors a on a.id=m.actor_id
    join openerp_auth."user" u on u.id=a.id cross join lateral (values (u.name),(u.email)) v(alias) where m.book_id=${bookId}
    union all
    select 'owner:' || o.id, 'PERSON', o.body->>'displayName', v.alias
    from openerp.owner_parties o cross join lateral (values (o.body->>'displayName'),(o.source_key)) v(alias)
    where o.book_id=${bookId}
    union all
    select 'employee:' || r.employee_id, 'PERSON', (select latest.body->>'personRef' from openerp.payroll_revisions latest where latest.book_id=r.book_id and latest.employee_id=r.employee_id and latest.kind='employment' order by latest.effective_on desc, latest.created_at desc, latest.id desc limit 1), r.body->>'personRef'
    from openerp.payroll_revisions r where r.book_id=${bookId} and r.kind='employment'
    union all
    select 'party:' || c.id, case when c.role='customer' then 'CUSTOMER' else 'SUPPLIER' end,
      head.body->>'displayName', v.alias
    from openerp.commerce_counterparties c
    join openerp.commerce_counterparty_revisions head on head.book_id=c.book_id and head.counterparty_id=c.id and head.revision=c.current_revision
    join openerp.commerce_counterparty_revisions r on r.book_id=c.book_id and r.counterparty_id=c.id
    left join openerp.ai_counterparty_classifications k on k.book_id=c.book_id and k.counterparty_id=c.id and k.revision=r.revision
    cross join lateral (values (r.body->>'displayName'),(c.external_key)) v(alias)
    where c.book_id=${bookId} and coalesce(k.kind,'unknown') <> 'company'
    union all
    select 'client:' || b.entity_id, 'CLIENT', e.name, v.alias
    from openerp.company_setup_commands command join openerp.books b on b.id=command.book_id
    join openerp.entities e on e.id=b.entity_id
    cross join lateral (values (command.payload->'details'->>'name'),(command.payload->'details'->>'organizationNumber')) v(alias)
    where command.book_id=${bookId} and v.alias is not null
    union all
    select 'owner-record-party:' || (o.body->'counterparty'->>'sourceKey'), 'SUPPLIER', o.body->'counterparty'->>'displayName', v.alias
    from openerp.owner_records o cross join lateral (values (o.body->'counterparty'->>'displayName'),(o.body->'counterparty'->>'sourceKey')) v(alias)
    where o.book_id=${bookId} and jsonb_typeof(o.body->'counterparty')='object'
    )
    select * from current_identities
    union all
    select a.subject_key,t.identity_kind,coalesce((select c.name from current_identities c where c."subjectKey"=a.subject_key limit 1),a.alias),a.alias
    from openerp.ai_identity_aliases a join openerp.ai_identity_tokens t using (book_id,subject_key)
    where a.book_id=${bookId}
    order by "subjectKey",alias
  `,
    "objects",
  );
}

export function allocateToken(
  tx: Transaction,
  bookId: string,
  subjectKey: string,
  kind: IdentityKind,
) {
  return tx.execute<{ readonly ordinal: string; readonly kind: IdentityKind }>(
    sql`
    with inserted as (
      insert into openerp.ai_identity_tokens(book_id,subject_key,identity_kind)
      values (${bookId},${subjectKey},${kind}) on conflict do nothing returning ordinal::text,identity_kind
    )
    select ordinal,identity_kind as kind from inserted
    union all select ordinal::text,identity_kind from openerp.ai_identity_tokens
    where book_id=${bookId} and subject_key=${subjectKey}
  `,
    "objects",
  );
}

export type EgressAdmission = {
  readonly bookId: string;
  readonly id: string;
  readonly actorId: string;
  readonly purpose: "decision" | "document" | "agent";
  readonly provider: string;
  readonly destination: string;
  readonly modelRelease: string;
  readonly operation: "structured" | "document_submit" | "document_poll";
  readonly disclosure: "tokenised" | "raw_document" | "operation_reference";
  readonly categories: ReadonlyArray<AiCategory>;
  readonly policy: string;
  readonly payloadDigest: string;
};

export function insertAdmission(tx: Transaction, row: EgressAdmission) {
  return tx.execute(sql`
    insert into openerp.ai_egress_admissions(book_id,id,actor_id,purpose,provider,destination,model_release,operation,disclosure,categories,policy,payload_digest)
    values (${row.bookId},${row.id},${row.actorId},${row.purpose},${row.provider},${row.destination},${row.modelRelease},${row.operation},${row.disclosure},${JSON.stringify(row.categories)}::jsonb,${row.policy},${row.payloadDigest})
  `);
}

export function readAdmissions(tx: Transaction, bookId: string, after: string) {
  return tx.execute<EgressAdmission & { readonly sequence: string; readonly recordedAt: string }>(
    sql`
    select book_id as "bookId",id,sequence::text as sequence,actor_id as "actorId",purpose,provider,destination,model_release as "modelRelease",operation,disclosure,categories,policy,payload_digest as "payloadDigest",recorded_at as "recordedAt"
    from openerp.ai_egress_admissions where book_id=${bookId} and sequence > ${after || "0"}::bigint
    order by sequence limit 200
  `,
    "objects",
  );
}

export function classifyCounterparty(
  tx: Transaction,
  bookId: string,
  actorId: string,
  input: {
    readonly counterpartyId: string;
    readonly revision: string;
    readonly kind: "company" | "person" | "sole_trader";
    readonly evidenceId: string;
  },
) {
  return tx.execute<{ readonly kind: string }>(
    sql`
    insert into openerp.ai_counterparty_classifications(book_id,counterparty_id,revision,kind,evidence_id,actor_id)
    select c.book_id,c.id,c.current_revision,${input.kind},${input.evidenceId},${actorId}
    from openerp.commerce_counterparties c
    join openerp.evidence e on e.book_id=c.book_id and e.id=${input.evidenceId}
    where c.book_id=${bookId} and c.id=${input.counterpartyId} and c.current_revision=${input.revision}::bigint
    on conflict do nothing returning kind
  `,
    "objects",
  );
}

export function retainAlias(tx: Transaction, bookId: string, subjectKey: string, alias: string) {
  return tx.execute(
    sql`insert into openerp.ai_identity_aliases(book_id,subject_key,alias) values (${bookId},${subjectKey},${alias}) on conflict do nothing`,
  );
}

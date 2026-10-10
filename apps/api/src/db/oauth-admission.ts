import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { sql } from "drizzle-orm";
import { failure } from "../application/failures";
import type { Transaction } from "./transaction";

export const McpReadResource = Context.Reference<string | null>("open-erp/McpReadResource", {
  defaultValue: () => null,
});

const Grant = Schema.Struct({
  actorId: Schema.String,
  grantId: Schema.String,
  bookId: Schema.String,
  entityId: Schema.String,
  expiresAt: Schema.String,
});

export function admitOAuthRead(transaction: Transaction, tokenHash: string) {
  return Effect.gen(function* () {
    const resource = yield* McpReadResource;

    if (resource === null) return yield* failure("Unauthorized");

    yield* transaction.execute(
      sql`select a.id from openerp.actors a join openerp.oauth_agent_grants g on g.actor_id = a.id join openerp_auth.oauth_access_token t on t.reference_id = g.id where t.token = ${tokenHash} for share of a`,
      "objects",
    );
    yield* transaction.execute(
      sql`select a.enabled from openerp.identity_admissions a join openerp.oauth_agent_grants g on g.actor_id = a.actor_id join openerp_auth.oauth_access_token t on t.reference_id = g.id where t.token = ${tokenHash} for share of a`,
      "objects",
    );

    const locked = yield* transaction.execute(
      sql`
      select g.id from openerp.oauth_agent_grants g
      join openerp_auth.oauth_access_token t on t.reference_id = g.id
      where t.token = ${tokenHash} for share of g
    `,
      "objects",
    );

    if (locked.length !== 1) return yield* failure("Unauthorized");

    const rows = yield* transaction.execute(
      sql`
      select g.actor_id as "actorId", g.id as "grantId", g.book_id as "bookId",
             b.entity_id as "entityId", t.expires_at as "expiresAt"
      from openerp.oauth_agent_grants g
      join openerp_auth.oauth_access_token t on t.reference_id = g.id and t.user_id = g.actor_id
      join openerp_auth.oauth_client c on c.client_id = t.client_id
      join openerp.firm_members fm on fm.firm_id = g.firm_id and fm.actor_id = g.actor_id and fm.active
      join openerp.firm_clients fc on fc.firm_id = g.firm_id and fc.book_id = g.book_id
      join openerp.memberships m on m.book_id = g.book_id and m.actor_id = g.actor_id and m.role = 'operator'
      join openerp.books b on b.id = g.book_id
      where t.token = ${tokenHash} and t.revoked is null and t.expires_at > clock_timestamp()
        and not exists (select 1 from openerp.identity_admissions a where a.actor_id = g.actor_id and not a.enabled)
        and c.disabled is distinct from true
        and t.resources = array[${resource}]::text[] and 'mcp:read' = any(t.scopes)
        and not exists (select 1 from openerp.oauth_agent_revocations r where r.grant_id = g.id)
        and not exists (select 1 from openerp_auth.oauth_refresh_token r where r.id = t.refresh_id and r.revoked is not null)
      for share of t, c, fm, fc, m, b
    `,
      "objects",
    );

    if (rows.length !== 1) return yield* failure("Unauthorized");

    const grant = yield* Schema.decodeUnknownEffect(Grant)(rows[0]).pipe(
      Effect.mapError(() => failure("InternalError")),
    );

    const clockRows = yield* transaction.execute(sql`select clock_timestamp() as now`, "objects");

    const clock = yield* Schema.decodeUnknownEffect(Schema.Struct({ now: Schema.String }))(
      clockRows[0],
    ).pipe(Effect.mapError(() => failure("InternalError")));

    if (
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= Date.parse(clock.now)
    )
      return yield* failure("Unauthorized");

    return grant;
  });
}

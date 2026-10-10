import { sql } from "drizzle-orm";
import type { Transaction } from "./transaction";

export type AuthorityPolicy = {
  readonly presenceRequired: boolean;
  readonly postingMandatesEnabled: boolean;
};

export function readAuthorityPolicy(tx: Transaction, bookId: string) {
  return tx.execute<AuthorityPolicy>(
    sql`select presence_required as "presenceRequired",
      posting_mandates_enabled as "postingMandatesEnabled"
      from openerp.book_authority_policies where book_id = ${bookId}`,
    "objects",
  );
}

export function readTicket(tx: Transaction, ticketHash: string) {
  return tx.execute<{
    readonly id: string;
    readonly actorId: string;
    readonly current: boolean;
    readonly redeemed: boolean;
  }>(
    sql`select t.id, t.actor_id as "actorId", t.expires_at > clock_timestamp() as current,
      exists(select 1 from openerp.presence_authenticators a where a.ticket_id = t.id) as redeemed
      from openerp.presence_enrollment_tickets t where t.ticket_hash = ${ticketHash}`,
    "objects",
  );
}

export function insertEnrollmentChallenge(
  tx: Transaction,
  row: {
    readonly id: string;
    readonly ticketId: string;
    readonly actorId: string;
    readonly sessionId: string;
    readonly challenge: string;
    readonly lifetimeSeconds: number;
  },
) {
  return tx.execute<{ readonly expiresAt: string }>(
    sql`insert into openerp.presence_enrollment_challenges
      (id, ticket_id, actor_id, session_id, challenge, expires_at)
      values (${row.id}, ${row.ticketId}, ${row.actorId}, ${row.sessionId}, ${row.challenge},
        clock_timestamp() + make_interval(secs => ${row.lifetimeSeconds}))
      returning expires_at::text as "expiresAt"`,
    "objects",
  );
}

export function readEnrollmentChallenge(tx: Transaction, id: string) {
  return tx.execute<{
    readonly ticketId: string;
    readonly actorId: string;
    readonly sessionId: string;
    readonly challenge: string;
    readonly current: boolean;
  }>(
    sql`select ticket_id as "ticketId", actor_id as "actorId", session_id as "sessionId",
      challenge, expires_at > clock_timestamp() as current
      from openerp.presence_enrollment_challenges where id = ${id}`,
    "objects",
  );
}

export function insertAuthenticator(
  tx: Transaction,
  row: {
    readonly credentialId: string;
    readonly actorId: string;
    readonly ticketId: string;
    readonly publicKey: string;
    readonly counter: number;
  },
) {
  return tx.execute(
    sql`insert into openerp.presence_authenticators
      (credential_id, actor_id, ticket_id, public_key, initial_counter)
      values (${row.credentialId}, ${row.actorId}, ${row.ticketId}, ${row.publicKey}, ${row.counter})`,
    "objects",
  );
}

// The authenticator row is locked so that two assertions from one key serialize
// their signature-counter comparison.
export function lockAuthenticator(tx: Transaction, credentialId: string) {
  return tx.execute<{
    readonly actorId: string;
    readonly publicKey: string;
    readonly counter: string;
    readonly revoked: boolean;
  }>(
    sql`select a.actor_id as "actorId", a.public_key as "publicKey",
      greatest(a.initial_counter, coalesce(
        (select max(s.counter) from openerp.presence_assertions s where s.credential_id = a.credential_id),
        0))::text as counter,
      exists(select 1 from openerp.presence_authenticator_revocations r
        where r.credential_id = a.credential_id) as revoked
      from openerp.presence_authenticators a where a.credential_id = ${credentialId} for update`,
    "objects",
  );
}

export function readActorAuthenticators(tx: Transaction, actorId: string) {
  return tx.execute<{ readonly credentialId: string }>(
    sql`select a.credential_id as "credentialId" from openerp.presence_authenticators a
      where a.actor_id = ${actorId} and not exists(select 1 from openerp.presence_authenticator_revocations r
        where r.credential_id = a.credential_id)
      order by a.enrolled_at limit 20`,
    "objects",
  );
}

export function insertChallenge(
  tx: Transaction,
  row: {
    readonly id: string;
    readonly actorId: string;
    readonly bookId: string;
    readonly sessionId: string;
    readonly gesture: string;
    readonly bindingDigest: string;
    readonly challenge: string;
    readonly lifetimeSeconds: number;
  },
) {
  return tx.execute<{ readonly expiresAt: string }>(
    sql`insert into openerp.presence_challenges
      (id, actor_id, book_id, session_id, gesture, binding_digest, challenge, expires_at)
      values (${row.id}, ${row.actorId}, ${row.bookId}, ${row.sessionId}, ${row.gesture},
        ${row.bindingDigest}, ${row.challenge},
        clock_timestamp() + make_interval(secs => ${row.lifetimeSeconds}))
      returning expires_at::text as "expiresAt"`,
    "objects",
  );
}

export function readChallenge(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{
    readonly actorId: string;
    readonly sessionId: string;
    readonly challenge: string;
    readonly current: boolean;
    readonly asserted: boolean;
  }>(
    sql`select c.actor_id as "actorId", c.session_id as "sessionId", c.challenge,
      c.expires_at > clock_timestamp() as current,
      exists(select 1 from openerp.presence_assertions a where a.challenge_id = c.id) as asserted
      from openerp.presence_challenges c where c.book_id = ${bookId} and c.id = ${id} for update`,
    "objects",
  );
}

export function insertAssertion(
  tx: Transaction,
  row: { readonly challengeId: string; readonly credentialId: string; readonly counter: number },
) {
  return tx.execute(
    sql`insert into openerp.presence_assertions (challenge_id, credential_id, counter)
      values (${row.challengeId}, ${row.credentialId}, ${row.counter})`,
    "objects",
  );
}

// Proofs for one exact binding. `consumed` distinguishes a replay of a committed
// gesture from a fresh proof. A proof from a revoked key or past its use window
// is not offered.
export function readProofs(
  tx: Transaction,
  row: {
    readonly actorId: string;
    readonly bookId: string;
    readonly sessionId: string;
    readonly gesture: string;
    readonly bindingDigest: string;
    readonly useWindowSeconds: number;
  },
) {
  return tx.execute<{ readonly challengeId: string; readonly consumed: boolean }>(
    sql`select c.id as "challengeId",
      exists(select 1 from openerp.presence_consumptions u where u.challenge_id = c.id) as consumed
      from openerp.presence_challenges c
      join openerp.presence_assertions a on a.challenge_id = c.id
      where c.actor_id = ${row.actorId} and c.book_id = ${row.bookId}
        and c.session_id = ${row.sessionId} and c.gesture = ${row.gesture}
        and c.binding_digest = ${row.bindingDigest}
        and not exists(select 1 from openerp.presence_authenticator_revocations r
          where r.credential_id = a.credential_id)
        and (exists(select 1 from openerp.presence_consumptions u where u.challenge_id = c.id)
          or a.verified_at + make_interval(secs => ${row.useWindowSeconds}) > clock_timestamp())
      order by consumed desc, a.verified_at
      for update of c`,
    "objects",
  );
}

export function insertConsumption(tx: Transaction, challengeId: string) {
  return tx.execute(
    sql`insert into openerp.presence_consumptions (challenge_id) values (${challengeId})`,
    "objects",
  );
}

export const presenceTables = [
  "presence_enrollment_challenges",
  "presence_authenticators",
  "presence_challenges",
  "presence_assertions",
  "presence_consumptions",
] as const;

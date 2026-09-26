import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import * as Schema from "effect/Schema";
import { Client } from "pg";
import { expect, inject } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import type { E2EEnvironment } from "./environment";

export const run = promisify(execFile);

export const apiDirectory = resolve(import.meta.dirname, "../..");

export const environment = (): E2EEnvironment => inject("e2e");

export const key = () => randomUUID();

export async function database() {
  const client = new Client({ connectionString: environment().adminUrl });
  await client.connect();

  return client;
}

export async function createSession(book: BookFixture) {
  const id = `session_${randomBytes(8).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const admin = await database();

  try {
    await admin.query(
      `INSERT INTO openerp_auth."user"(id, name, email)
      VALUES ($1, 'E2E session operator', $2)
      ON CONFLICT (id) DO NOTHING`,
      [book.actorId, `${book.actorId}@e2e.invalid`],
    );
    await admin.query(
      `INSERT INTO openerp.identity_admissions(actor_id, provider_id, subject, enabled)
      VALUES ($1, 'e2e-current-session', $2, true)
      ON CONFLICT (actor_id) DO UPDATE SET enabled = true`,
      [book.actorId, book.actorId],
    );
    await admin.query(
      `INSERT INTO openerp_auth.session(id, token, user_id, expires_at)
      VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [id, token, book.actorId],
    );
  } finally {
    await admin.end();
  }

  return { id, token };
}

export async function deleteSession(id: string) {
  const admin = await database();

  try {
    const deleted = await admin.query("DELETE FROM openerp_auth.session WHERE id = $1", [id]);

    return deleted.rowCount;
  } finally {
    await admin.end();
  }
}

export async function fixture() {
  const id = randomBytes(8).toString("hex");
  const token = randomBytes(32).toString("hex");
  const agentToken = randomBytes(32).toString("hex");
  const entityId = `entity_${id}`;
  const bookId = `book_${id}`;
  const actorId = `operator_${id}`;
  const agentId = `agent_${id}`;

  const config = {
    entity: { id: entityId, name: "Synthetic E2E entity" },
    book: { id: bookId, name: "Synthetic E2E book", currency: "SEK", profile: "synthetic-core-v1" },
    actor: {
      id: actorId,
      name: "E2E operator",
      role: "operator",
      tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    fiscalYear: { id: "fy_2026", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    periods: [{ id: "period_2026", startsOn: "2026-01-01", endsOn: "2026-12-31" }],
    accounts: [
      { id: "account_bank", code: "1930", name: "Bank" },
      { id: "account_clearing", code: "2999", name: "Clearing" },
    ],
  };

  const path = join(environment().scratch, `${bookId}.json`);
  await writeFile(path, JSON.stringify(config));
  await run("bun", ["scripts/provision.ts", path], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: environment().adminUrl,
      OPENERP_ACCESS_TOKEN: token,
    },
  });
  const admin = await database();

  try {
    await admin.query("INSERT INTO openerp.actors(id, name) VALUES ($1, 'E2E agent')", [agentId]);
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'agent')",
      [bookId, agentId],
    );
    await admin.query(
      "INSERT INTO openerp.credentials(token_hash, actor_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [createHash("sha256").update(agentToken).digest("hex"), agentId],
    );
  } finally {
    await admin.end();
  }

  return {
    entityId,
    bookId,
    actorId,
    agentId,
    token,
    agentToken,
    path: `/api/v1/entities/${entityId}/books/${bookId}`,
  };
}

export type BookFixture = Awaited<ReturnType<typeof fixture>>;

export function request(book: BookFixture, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${book.token}`);

  if (init.body) headers.set("content-type", "application/json");

  if (init.method === "POST" && !headers.has("idempotency-key"))
    headers.set("idempotency-key", key());

  return fetch(`${environment().baseUrl}${book.path}${path}`, { ...init, headers });
}

export async function decoded<S extends Schema.Top & { readonly DecodingServices: never }>(
  response: Response,
  schema: S,
): Promise<S["Type"]> {
  const body = await response.text();
  expect(response.status, body).toBe(200);

  return Schema.decodeSync(Schema.fromJsonString(schema))(body);
}

export async function failure(
  response: Response,
  status: number,
  code: typeof Accounting.FailureCode.Type,
) {
  const body = await response.text();
  expect(response.status, body).toBe(status);
  expect(Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(body).code).toBe(
    code,
  );
}

export async function evidence(book: BookFixture) {
  return decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "Synthetic opening transfer",
        content: "Återföring: räksmörgås, 125,00 SEK. Synthetic only.",
        mediaType: "text/plain",
        origin: "Vitest E2E fixture",
      }),
    }),
    Accounting.Evidence,
  );
}

export function journal(
  evidenceId: string,
  amount = "12500",
): typeof Accounting.PrepareJournal.Type {
  return {
    kind: "manual_journal",
    evidenceId,
    eventKey: key(),
    accountingPeriodId: "period_2026",
    postingDate: "2026-09-22",
    series: "A",
    description: "Synthetic transfer",
    rationale: "Exercise the complete posting boundary",
    taxAssessment: "not_applicable",
    lines: [
      {
        accountId: "account_bank",
        debitMinor: amount,
        creditMinor: "0",
        description: "Bank debit",
      },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: amount,
        description: "Clearing credit",
      },
    ],
  };
}

export async function prepare(book: BookFixture, amount = "12500") {
  const source = await evidence(book);

  return decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify(journal(source.id, amount)),
    }),
    Accounting.ChangeSet,
  );
}

export async function approve(book: BookFixture, plan: typeof Accounting.ChangeSet.Type) {
  return decoded(
    await request(book, `/change-sets/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ planDigest: plan.planDigest, version: plan.version }),
    }),
    Accounting.Approval,
  );
}

export function execution(
  plan: typeof Accounting.ChangeSet.Type,
  approval: typeof Accounting.Approval.Type,
) {
  return { planDigest: plan.planDigest, version: plan.version, approvalId: approval.id };
}

export async function execute(book: BookFixture, plan: typeof Accounting.ChangeSet.Type) {
  const approval = await approve(book, plan);

  return decoded(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(plan, approval)),
    }),
    Accounting.ExecutionReceipt,
  );
}

export async function ledger(book: BookFixture) {
  return decoded(await request(book, "/ledger"), Accounting.LedgerSnapshot);
}

export async function sealedPlans(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.change_sets WHERE book_id = $1",
      [book.bookId],
    );

    return result.rows[0]?.count ?? 0;
  } finally {
    await admin.end();
  }
}

export async function persisted(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query<{
      sequence: string;
      vouchers: number;
      lines: number;
      receipts: number;
      outbox: number;
      consumed: number;
      counter: string;
    }>(
      `SELECT
      committed_sequence::text AS sequence,
      (SELECT count(*)::int FROM openerp.vouchers WHERE book_id = $1) AS vouchers,
      (SELECT count(*)::int FROM openerp.journal_lines WHERE book_id = $1) AS lines,
      (SELECT count(*)::int FROM openerp.execution_receipts WHERE book_id = $1) AS receipts,
      (SELECT count(*)::int FROM openerp.outbox WHERE book_id = $1) AS outbox,
      (SELECT count(*)::int FROM openerp.approvals WHERE book_id = $1 AND consumed_at IS NOT NULL) AS consumed,
      (SELECT coalesce(sum(last_number), 0)::text FROM openerp.series_counters WHERE book_id = $1) AS counter
      FROM openerp.books WHERE id = $1`,
      [book.bookId],
    );

    expect(result.rows).toHaveLength(1);

    return result.rows[0];
  } finally {
    await admin.end();
  }
}

export const emptyPosting = {
  sequence: "0",
  vouchers: 0,
  lines: 0,
  receipts: 0,
  outbox: 0,
  consumed: 0,
  counter: "0",
};

export const onePosting = {
  sequence: "1",
  vouchers: 1,
  lines: 2,
  receipts: 1,
  outbox: 1,
  consumed: 1,
  counter: "1",
};

export async function saveEvidence(name: string, book: BookFixture) {
  await writeFile(
    join(environment().artifacts, `${name}.json`),
    JSON.stringify(
      { bookId: book.bookId, ledger: await ledger(book), persisted: await persisted(book) },
      null,
      2,
    ),
  );
}

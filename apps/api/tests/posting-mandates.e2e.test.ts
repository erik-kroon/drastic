import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Mandates from "@open-erp/contracts/posting-mandates";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  apiDirectory,
  createSession,
  database,
  decoded,
  environment,
  failure,
  key,
  persisted,
  post,
  request,
  run,
  type BookFixture,
} from "./support/fixtures";
import { createDraft, purchaseEvidence, supplierFixture } from "./support/supplier-review";

// ADR 0020 / PST-05 standing posting mandates. The failure contract precedes this
// journey in the ADR. The seam is HTTP into the real Worker and PostgreSQL; database
// access is limited to fixture setup, failure injection (admission, an insert fault)
// and independent observation.

type Supplier = Awaited<ReturnType<typeof supplierFixture>>;

async function admin<T>(use: (client: Awaited<ReturnType<typeof database>>) => Promise<T>) {
  const client = await database();

  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

async function policy(bookId: string, presence: "required" | "off", mandates: "enabled" | "off") {
  await run("bun", ["scripts/authority.ts", "policy", bookId, presence, mandates], {
    cwd: apiDirectory,
    env: { ...process.env, DATABASE_ADMIN_URL: environment().adminUrl },
  });
}

async function count(sql: string, values: ReadonlyArray<string>) {
  return admin(async (client) => Number((await client.query(sql, [...values])).rows[0]?.count));
}

const consumptions = (bookId: string) =>
  count("SELECT count(*) FROM openerp.posting_mandate_consumptions WHERE book_id = $1", [bookId]);

const mandateRows = (bookId: string) =>
  count("SELECT count(*) FROM openerp.posting_mandates WHERE book_id = $1", [bookId]);

const acceptances = (bookId: string, reviewId: string) =>
  count("SELECT count(*) FROM openerp.supplier_acceptances WHERE book_id = $1 AND review_id = $2", [
    bookId,
    reviewId,
  ]);

const approvals = (bookId: string, reviewId: string) =>
  count(
    "SELECT count(*) FROM openerp.supplier_acceptance_approvals WHERE book_id = $1 AND review_id = $2",
    [bookId, reviewId],
  );

// A prepared, sealed supplier review of one invoice for `amount` minor units.
async function sealedReview(
  context: Supplier,
  amount: string,
  counterparty: { readonly id: string; readonly revision: string } = context.supplier,
) {
  // Each invoice is its own retained source; a shared source would be one event.
  const source = await purchaseEvidence(context.book, Math.floor(Math.random() * 1_000_000));

  const content = {
    ...context.content,
    sourceEvidenceId: source.id,
    counterpartyId: counterparty.id,
    counterpartyRevision: counterparty.revision,
    supplierDocumentNumber: `MANDATE-${key()}`,
    sourceTotalMinor: amount,
    lines: context.content.lines.map((line) => ({
      ...line,
      unitPriceMinor: amount,
      baseMinor: amount,
      sourceGrossMinor: amount,
    })),
  } satisfies typeof Drafts.SupplierDraftContent.Type;

  const draft = await createDraft(context.book, content);

  return post(
    context.book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-manual-supplier-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic mandate review",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );
}

function terms(
  context: Supplier,
  overrides: Partial<typeof Mandates.GrantPostingMandate.Type> = {},
): typeof Mandates.GrantPostingMandate.Type {
  return {
    granteeId: context.book.agentId,
    family: "supplier_acceptance",
    profiles: ["synthetic-manual-supplier-v1"],
    counterparties: [{ counterpartyId: context.supplier.id, revision: context.supplier.revision }],
    currency: "SEK",
    perEventLimitMinor: "10000",
    aggregateLimitMinor: "25000",
    maxEvents: 5,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    reason: "Routine supplier invoices from one named supplier",
    acknowledgeSyntheticOnly: true,
    ...overrides,
  };
}

function grant(book: BookFixture, input: typeof Mandates.GrantPostingMandate.Type) {
  return request(book, "/posting-mandates", { method: "POST", body: JSON.stringify(input) });
}

function execute(
  book: BookFixture,
  review: typeof Acceptance.SupplierAcceptanceReview.Type,
  mandate: typeof Mandates.PostingMandate.Type,
  idempotencyKey = key(),
) {
  return request(book, `/commerce/supplier-acceptance-reviews/${review.id}/mandate-executions`, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({
      version: 1,
      digest: review.digest,
      mandateId: mandate.id,
      mandateDigest: mandate.digest,
      acknowledgeSyntheticOnly: true,
    }),
  });
}

async function sessions(context: Supplier) {
  return {
    operator: { ...context.book, token: (await createSession(context.book)).token },
    agent: { ...context.book, token: context.book.agentToken },
  };
}

test("mandates stay refused until the operator console enables them for the book", async () => {
  const context = await supplierFixture();
  const { operator, agent } = await sessions(context);

  await failure(await grant(operator, terms(context)), 403, "Forbidden");
  expect(await mandateRows(context.book.bookId)).toBe(0);

  // Enabling mandates does not waive presence when the book also requires it.
  await policy(context.book.bookId, "required", "enabled");
  await failure(await grant(operator, terms(context)), 403, "PresenceRequired");
  expect(await mandateRows(context.book.bookId)).toBe(0);

  await policy(context.book.bookId, "off", "off");
  const review = await sealedReview(context, "1000");
  const fake = { id: "posting_mandate_absent", digest: review.digest };
  await failure(
    await execute(agent, review, fake as typeof Mandates.PostingMandate.Type),
    403,
    "Forbidden",
  );
  expect(await consumptions(context.book.bookId)).toBe(0);
});

test("an agent executes bounded supplier acceptances under a human mandate and nothing more", async () => {
  const context = await supplierFixture();
  const { operator, agent } = await sessions(context);
  const bookId = context.book.bookId;

  const observations: Array<{
    readonly step: string;
    readonly status: number;
    readonly code?: string;
  }> = [];

  const refused = async (step: string, response: Response, status: number, code: string) => {
    observations.push({ step, status: response.status, code });
    await failure(response, status, code as Parameters<typeof failure>[2]);
  };

  await policy(bookId, "off", "enabled");

  // Grant is an interactive operator gesture: not an operator API credential, not the agent.
  await refused("credential grant", await grant(context.book, terms(context)), 403, "Forbidden");
  await refused("agent grant", await grant(agent, terms(context)), 403, "Forbidden");
  await refused(
    "self-grant",
    await grant(operator, terms(context, { granteeId: context.book.actorId })),
    422,
    "InvalidJournal",
  );

  const mandate = await decoded(await grant(operator, terms(context)), Mandates.PostingMandate);
  expect(mandate.grantorId).toBe(context.book.actorId);
  expect(mandate.consumedEvents).toBe(0);

  // Only the named grantee may use it.
  const first = await sealedReview(context, "10000");
  await refused("non-grantee", await execute(context.book, first, mandate), 403, "Forbidden");

  // Within bounds: one posting, one consumption; an unchanged replay returns it.
  const before = await persisted(context.book);
  const firstKey = key();

  const executed = await decoded(
    await execute(agent, first, mandate, firstKey),
    Mandates.MandateExecution,
  );

  const replayed = await decoded(
    await execute(agent, first, mandate, firstKey),
    Mandates.MandateExecution,
  );

  expect(executed).toEqual(replayed);
  expect(executed.remainingGrossMinor).toBe("15000");
  expect(executed.acceptance.approvalId).toBeDefined();
  const after = await persisted(context.book);
  expect(after?.vouchers).toBe((before?.vouchers ?? 0) + 1);
  expect(await consumptions(bookId)).toBe(1);
  observations.push({ step: "within bounds", status: 200 });

  // Over the per-event limit: refused, and the same review stays open to exact human approval.
  const large = await sealedReview(context, "12000");
  await refused("per-event limit", await execute(agent, large, mandate), 403, "ApprovalRequired");
  expect(await approvals(bookId, large.id)).toBe(0);

  const human = await post(
    context.book,
    `/commerce/supplier-acceptance-reviews/${large.id}/approvals`,
    { version: 1, digest: large.digest, acknowledgeSyntheticOnly: true },
    Acceptance.SupplierAcceptanceApproval,
  );

  await post(
    context.book,
    `/commerce/supplier-acceptance-reviews/${large.id}/execute`,
    { version: 1, digest: large.digest, acknowledgeSyntheticOnly: true, approvalId: human.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  // Two executions compete for the remaining 15000: exactly one of 10000 + 10000 commits.
  const left = await sealedReview(context, "10000");
  const right = await sealedReview(context, "10000");
  const raced = await Promise.all([execute(agent, left, mandate), execute(agent, right, mandate)]);
  const statuses = raced.map((response) => response.status).sort((a, b) => a - b);
  expect(statuses).toEqual([200, 403]);
  observations.push({ step: "competing executions", status: statuses[0] ?? 0 });
  const loser = raced.find((response) => response.status === 403);

  if (loser) await failure(loser, 403, "ApprovalRequired");
  expect(await consumptions(bookId)).toBe(2);

  // The grantor's authority is current: a disabled grantor admission refuses use.
  const small = await sealedReview(context, "3000");
  await admin((client) =>
    client.query("UPDATE openerp.identity_admissions SET enabled = false WHERE actor_id = $1", [
      context.book.actorId,
    ]),
  );
  await refused("grantor disabled", await execute(agent, small, mandate), 403, "ApprovalRequired");
  await admin((client) =>
    client.query("UPDATE openerp.identity_admissions SET enabled = true WHERE actor_id = $1", [
      context.book.actorId,
    ]),
  );

  // A failure after the consumption insert rolls the approval, posting and acceptance back.
  const beforeFault = await persisted(context.book);
  await admin((client) =>
    client.query(`
      CREATE FUNCTION pg_temp_fault_${small.id.replaceAll("-", "_")}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.review_id = '${small.id}' THEN RAISE EXCEPTION 'Synthetic consumption fault'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fault_${small.id.replaceAll("-", "_")} BEFORE INSERT ON openerp.posting_mandate_consumptions
        FOR EACH ROW EXECUTE FUNCTION pg_temp_fault_${small.id.replaceAll("-", "_")}();`),
  );
  const faulted = await execute(agent, small, mandate);
  expect(faulted.status).toBeGreaterThanOrEqual(500);
  observations.push({ step: "consumption fault", status: faulted.status });
  await admin((client) =>
    client.query(`DROP TRIGGER fault_${small.id.replaceAll("-", "_")} ON openerp.posting_mandate_consumptions;
      DROP FUNCTION pg_temp_fault_${small.id.replaceAll("-", "_")}();`),
  );
  expect(await persisted(context.book)).toEqual(beforeFault);
  expect(await approvals(bookId, small.id)).toBe(0);
  expect(await acceptances(bookId, small.id)).toBe(0);
  expect(await consumptions(bookId)).toBe(2);

  // With the fault removed the same review executes: 20000 + 3000 of 25000.
  const third = await decoded(await execute(agent, small, mandate), Mandates.MandateExecution);
  expect(third.ordinal).toBe(3);
  expect(third.remainingGrossMinor).toBe("2000");

  // A mandate that is not yet valid authorizes nothing.
  const later = await decoded(
    await grant(
      operator,
      terms(context, {
        validFrom: new Date(Date.now() + 3_600_000).toISOString(),
        validUntil: new Date(Date.now() + 7_200_000).toISOString(),
      }),
    ),
    Mandates.PostingMandate,
  );

  const early = await sealedReview(context, "1000");
  await refused("not yet valid", await execute(agent, early, later), 403, "ApprovalRequired");

  // Changed facts: a supplier revised after the grant is outside the mandate.
  const revised = await post(
    context.book,
    `/commerce/counterparties/${context.supplier.id}/revisions`,
    {
      expectedRevision: context.supplier.revision,
      displayName: "Architecture review supplier, new bank details",
      evidenceId: context.source.id,
      reason: "Synthetic changed supplier facts",
    },
    Commerce.CounterpartyRevision,
  );

  const changed = await sealedReview(context, "1000", revised);
  const changedResponse = await execute(agent, changed, mandate);
  expect(changedResponse.status).toBe(403);
  observations.push({ step: "changed supplier facts", status: changedResponse.status });
  expect(await approvals(bookId, changed.id)).toBe(0);

  // Any operator may revoke, including with an API credential. Revocation stops
  // later use and leaves earlier postings untouched.
  const revoked = await post(
    context.book,
    `/posting-mandates/${mandate.id}/revocation`,
    { digest: mandate.digest, reason: "Synthetic revocation" },
    Mandates.PostingMandate,
  );

  expect(revoked.revocation?.actorId).toBe(context.book.actorId);
  expect(revoked.consumedEvents).toBe(3);
  const beforeRevokedUse = await persisted(context.book);
  const afterRevocation = await sealedReview(context, "1000", revised);
  await refused("revoked", await execute(agent, afterRevocation, mandate), 403, "ApprovalRequired");
  expect(await persisted(context.book)).toEqual(beforeRevokedUse);
  expect(await consumptions(bookId)).toBe(3);

  await writeFile(
    join(environment().artifacts, "posting-mandates.json"),
    JSON.stringify(
      {
        bookId,
        mandateId: mandate.id,
        mandateDigest: mandate.digest,
        consumedEvents: revoked.consumedEvents,
        consumedGrossMinor: revoked.consumedGrossMinor,
        observations,
        ledger: await persisted(context.book),
      },
      null,
      2,
    ),
  );
});

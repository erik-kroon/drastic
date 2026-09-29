import { createHash } from "node:crypto";
import * as Accounting from "@open-erp/contracts/accounting";
import { expect, test } from "vitest";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Connector from "@open-erp/contracts/bank-connector";
import * as Revisions from "@open-erp/contracts/bank-source-revisions";
import * as Sync from "@open-erp/contracts/bank-sync-windows";
import {
  database,
  decoded,
  evidence,
  failure,
  fixture,
  key,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

// NEXT-10 provider revisions to reviewed bank observations, proven over real
// HTTP against the restricted runtime role and a real PostgreSQL.
//
// The load-bearing claim is that the amount is never taken from the request.
// Every case below writes a provider page whose bytes carry an exact decimal
// lexeme, then checks the interpreted cash movement against that lexeme
// converted by hand. The expected values are derived here, not read back from
// the owner, and a byte that says one thing while the request claims another
// must be refused.

const path = "/banking/provider-observations";

const windowPath = "/banking/sync-windows";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// The retained provider page. Its records array is what the owner parses.
function providerPage(
  records: ReadonlyArray<{ id: string; amount: string; pending?: boolean; pendingId?: string }>,
) {
  return JSON.stringify({
    added: records.map((record) => record.id),
    modified: [],
    removed: [],
    records: records.map((record) => ({
      transaction_id: record.id,
      // A decimal lexeme, deliberately not a number: "12.50" must not become
      // 12.5 and then 1250 by accident.
      amount: record.amount,
      pending: record.pending ?? false,
      ...(record.pendingId === undefined ? {} : { pending_transaction_id: record.pendingId }),
    })),
  });
}

async function consent(book: BookFixture, externalAccountId: string) {
  return post(
    book,
    "/bank-connector-consents",
    {
      providerId: "plaid",
      externalAccountId,
      sourceAccountId: `source_${externalAccountId.toLowerCase()}`,
      accountId: "account_bank",
      consentReference: `ref_${externalAccountId}`,
      rationale: "Synthetic connector consent for the provider revision workflow",
    },
    Connector.ConnectorConsent,
  );
}

// Claim a window, retain one page carrying the provider bytes, and publish it,
// so the page's bytes are canonical and interpretable.
async function publishedWindow(
  book: BookFixture,
  consentId: string,
  raw: string,
  changes: ReadonlyArray<{ kind: "added" | "modified" | "removed"; sourceId: string }>,
) {
  const claimed = await decoded(
    await request(book, windowPath, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ consentId }),
    }),
    Sync.WindowClaimState,
  );

  // The page must be requested from the cursor the claim derived. After an
  // earlier window published, that is the published cursor, not the empty one.
  const nextCursor = `C${claimed.publicationVersion === "0" ? 1 : Number(claimed.publicationVersion) + 1}`;

  await decoded(
    await request(book, `${windowPath}/pages`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        generationId: claimed.generationId,
        fence: claimed.fence,
        ordinal: 0,
        requestCursor: claimed.requestCursor,
        nextCursor,
        hasMore: false,
        raw,
        changes: changes.map((change, index) => ({
          ...change,
          rawLocator: `raw_0_${index}`,
        })),
      }),
    }),
    Sync.RetainedSyncPage,
  );

  const publication = await decoded(
    await request(book, `${windowPath}/publications`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ generationId: claimed.generationId, fence: claimed.fence }),
    }),
    Sync.WindowPublication,
  );

  return { claimed, publication };
}

function apply(book: BookFixture, input: Revisions.ApplyProviderRevision, commandKey = key()) {
  return request(book, path, {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(input),
  });
}

function observe(book: BookFixture, consentId: string, providerTransactionId: string) {
  return request(book, `${path}/state`, {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ consentId, providerTransactionId }),
  });
}

// A statement-backed observation to adopt. The bank owner requires the
// retained statement to foot and requires its evidence to be the exact
// canonical statement source, so both are built here rather than hand-waved.
async function statementObservation(
  book: BookFixture,
  sourceBankAccountId: string,
  date: string,
  amountMinor: string,
) {
  const source = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: `stmt_${sourceBankAccountId}_${date}`,
    sourceBankAccountId,
    accountId: "account_bank",
    currency: "SEK",
    startsOn: date,
    endsOn: date,
    openingMinor: "0",
    closingMinor: amountMinor,
    completeness: {
      declaredComplete: true,
      basis: "Synthetic single-row statement for the provider revision workflow",
    },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date,
        description: "Synthetic provider observation",
        amountMinor,
      },
    ],
  };

  const statementEvidence = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "Synthetic statement source",
        mediaType: "application/json",
        content: JSON.stringify(source),
        origin: "NEXT-10 E2E",
      }),
    }),
    Accounting.Evidence,
  );

  const receipt = await decoded(
    await request(book, "/bank-statements", {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        ...source,
        evidenceId: statementEvidence.id,
        existingMatches: [],
      }),
    }),
    Bank.StatementImportReceipt,
  );

  return { statementId: receipt.statement.id, rowOrdinal: 1, evidenceId: statementEvidence.id };
}

test("a provider change is interpreted from its retained bytes, with the sign flipped and nothing defaulted", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_interpret");

  // "12.50" at scale 2 is 1250 minor units. The Transactions API's positive
  // means money leaving the account, so the cash movement is -1250.
  const raw = providerPage([{ id: "tx_out", amount: "12.50" }]);

  const { claimed } = await publishedWindow(book, granted.id, raw, [
    { kind: "added", sourceId: "tx_out" },
  ]);

  const receipt = await decoded(
    await apply(book, {
      generationId: claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_out",
      bookingDate: "2026-03-04",
      authorizationDate: "2026-03-03",
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    Revisions.ApplyProviderRevisionReceipt,
  );

  expect(receipt.facts.cashMovementMinor).toBe("-1250");
  expect(receipt.facts.currency).toBe("SEK");
  expect(receipt.facts.providerAmountLexeme).toBe("12.50");
  // The digest is recomputed here over the same bytes.
  expect(receipt.facts.rawContentSha256).toBe(sha256(raw));
  expect(receipt.facts.bookingDate).toBe("2026-03-04");
  expect(receipt.facts.authorizationDate).toBe("2026-03-03");
  expect(receipt.outcome.kind).toBe("new_head");
  // Ingesting posts nothing.
  expect(receipt.journalIds).toHaveLength(0);

  // A second currency scale: "0.05" at scale 2 is 5, a value a float would
  // have rounded away.
  const otherRaw = providerPage([{ id: "tx_small", amount: "0.05" }]);

  const other = await publishedWindow(book, granted.id, otherRaw, [
    { kind: "added", sourceId: "tx_small" },
  ]);

  const small = await decoded(
    await apply(book, {
      generationId: other.claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_small",
      bookingDate: "2026-03-05",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    Revisions.ApplyProviderRevisionReceipt,
  );

  expect(small.facts.cashMovementMinor).toBe("-5");
}, 180000);

test("a fractional minor unit and an unsupported currency scale both refuse", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_refuse");

  // "12.505" at scale 2 has no whole-minor-unit representation.
  const fractionalRaw = providerPage([{ id: "tx_frac", amount: "12.505" }]);

  const fractional = await publishedWindow(book, granted.id, fractionalRaw, [
    { kind: "added", sourceId: "tx_frac" },
  ]);

  await failure(
    await apply(book, {
      generationId: fractional.claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_frac",
      bookingDate: "2026-03-04",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    422,
    "InvalidJournal",
  );

  // An identity the retained bytes do not carry is a conflict, not an empty
  // match: the owner will not interpret a record that is not there.
  await failure(
    await apply(book, {
      generationId: fractional.claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_not_in_bytes",
      bookingDate: "2026-03-04",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    409,
    "IdempotencyConflict",
  );

  // A generation with no publication marker is raw provider delivery.
  const unclaimed = await decoded(
    await request(book, windowPath, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ consentId: granted.id }),
    }),
    Sync.WindowClaimState,
  );

  await decoded(
    await request(book, `${windowPath}/pages`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        generationId: unclaimed.generationId,
        fence: unclaimed.fence,
        ordinal: 0,
        requestCursor: unclaimed.requestCursor,
        nextCursor: `${unclaimed.requestCursor}C1`,
        hasMore: true,
        raw: providerPage([{ id: "tx_staged", amount: "5.00" }]),
        changes: [{ kind: "added", sourceId: "tx_staged", rawLocator: "raw_0_0" }],
      }),
    }),
    Sync.RetainedSyncPage,
  );

  await failure(
    await apply(book, {
      generationId: unclaimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_staged",
      bookingDate: "2026-03-04",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    409,
    "StaleDependency",
  );
}, 180000);

test("admission adopts a statement-backed observation exactly once, with cited evidence", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_admit");
  const source = await evidence(book);
  // SEK scale 2: the provider sends -1250, so the observation is -1250 too.
  const raw = providerPage([{ id: "tx_admit", amount: "12.50" }]);

  const { claimed } = await publishedWindow(book, granted.id, raw, [
    { kind: "added", sourceId: "tx_admit" },
  ]);

  const revision = await decoded(
    await apply(book, {
      generationId: claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_admit",
      bookingDate: "2026-04-10",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    Revisions.ApplyProviderRevisionReceipt,
  );

  // Admitting an observation that does not exist refuses.
  await failure(
    await request(book, `${path}/admissions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        revisionId: revision.facts.revisionId,
        statementId: "statement_does_not_exist",
        rowOrdinal: 1,
        evidenceId: source.id,
        rationale: "Synthetic admission naming an observation that was never retained",
        decidedOn: "2026-04-11",
      }),
    }),
    404,
    "NotFound",
  );

  // Admitting without cited retained evidence refuses.
  await failure(
    await request(book, `${path}/admissions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        revisionId: revision.facts.revisionId,
        statementId: "statement_x",
        rowOrdinal: 1,
        evidenceId: "evidence_does_not_exist",
        rationale: "Synthetic admission citing evidence that was never retained",
        decidedOn: "2026-04-11",
      }),
    }),
    422,
    "MissingEvidence",
  );

  const observation = await statementObservation(
    book,
    granted.sourceAccountId,
    "2026-04-10",
    "-1250",
  );

  const admitted = await decoded(
    await request(book, `${path}/admissions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        revisionId: revision.facts.revisionId,
        statementId: observation.statementId,
        rowOrdinal: observation.rowOrdinal,
        evidenceId: source.id,
        rationale: "Reviewed: the provider change and the statement row are one event",
        decidedOn: "2026-04-11",
      }),
    }),
    Revisions.ProviderAdmission,
  );

  expect(admitted.relation).toBe("same_event");
  expect(admitted.statementId).toBe(observation.statementId);
  // One observation, not a duplicated cash capacity.
  expect(admitted.resolvedObservationCount).toBe(1);
  expect(admitted.reviewDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  // Adopting adds provenance. It posts nothing.
  expect(admitted.journalIds).toHaveLength(0);

  const state = await decoded(
    await observe(book, granted.id, "tx_admit"),
    Revisions.ProviderObservationState,
  );

  expect(state.admitted?.statementId).toBe(observation.statementId);
  expect(state.admitted?.relation).toBe("same_event");
  expect(state.revisions).toHaveLength(1);
  expect(state.revisions[0]?.cashMovementMinor).toBe("-1250");
  expect(state.openCases).toHaveLength(0);

  // The same revision admitted again is refused: one revision, one admission.
  await failure(
    await request(book, `${path}/admissions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        revisionId: revision.facts.revisionId,
        statementId: observation.statementId,
        rowOrdinal: observation.rowOrdinal,
        evidenceId: source.id,
        rationale: "Reviewed: the provider change and the statement row are one event",
        decidedOn: "2026-04-11",
      }),
    }),
    409,
    "AlreadyPosted",
  );

  // Independent read of the retained evidence: one admission row, and the
  // statement owner still holds exactly one observation.
  const admin = await database();

  try {
    const admissions = await admin.query<{ count: string; relation: string }>(
      `SELECT count(*)::text AS count, min(relation) AS relation
       FROM openerp.bank_source_admissions WHERE book_id = $1`,
      [book.bookId],
    );

    expect(admissions.rows[0]?.count).toBe("1");
    expect(admissions.rows[0]?.relation).toBe("same_event");

    const observations = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.bank_observations WHERE book_id = $1",
      [book.bookId],
    );

    expect(observations.rows[0]?.count).toBe("1");

    // No journal was written by any of this.
    const vouchers = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.vouchers WHERE book_id = $1",
      [book.bookId],
    );

    expect(vouchers.rows[0]?.count).toBe("0");
  } finally {
    await admin.end();
  }
}, 180000);

test("a removed booked observation becomes a case and the ledger does not move", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_removed");
  const source = await evidence(book);
  const raw = providerPage([{ id: "tx_removed", amount: "12.50" }]);

  const { claimed } = await publishedWindow(book, granted.id, raw, [
    { kind: "added", sourceId: "tx_removed" },
  ]);

  const added = await decoded(
    await apply(book, {
      generationId: claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_removed",
      bookingDate: "2026-05-10",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    Revisions.ApplyProviderRevisionReceipt,
  );

  expect(added.facts.cashMovementMinor).toBe("-1250");

  const observation = await statementObservation(
    book,
    granted.sourceAccountId,
    "2026-05-10",
    "-1250",
  );

  await decoded(
    await request(book, `${path}/admissions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        revisionId: added.facts.revisionId,
        statementId: observation.statementId,
        rowOrdinal: observation.rowOrdinal,
        evidenceId: source.id,
        rationale: "Reviewed: the provider change and the statement row are one event",
        decidedOn: "2026-05-11",
      }),
    }),
    Revisions.ProviderAdmission,
  );

  // A later published generation removes the same provider transaction.
  const removalRaw = providerPage([]);

  const removal = await publishedWindow(book, granted.id, removalRaw, [
    { kind: "removed", sourceId: "tx_removed" },
  ]);

  // The staged candidate's own kind is the removal; the owner's leaf reads it
  // from the window rather than from the request.
  const removed = await decoded(
    await apply(book, {
      generationId: removal.claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_removed",
      bookingDate: "2026-05-10",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    Revisions.ApplyProviderRevisionReceipt,
  );

  expect(removed.outcome.kind).toBe("removal_investigation");
  expect(removed.facts.changeKind).toBe("removed");
  // A removal schema carries no amount, so none is invented.
  expect(removed.facts.cashMovementMinor).toBeNull();
  expect(removed.journalIds).toHaveLength(0);

  const state = await decoded(
    await observe(book, granted.id, "tx_removed"),
    Revisions.ProviderObservationState,
  );

  expect(state.openCases).toHaveLength(1);
  expect(state.openCases[0]?.caseKind).toBe("removed_booked_observation");
  // The observation it was admitted as survives untouched.
  expect(state.admitted?.statementId).toBe(observation.statementId);
  expect(state.revisions).toHaveLength(2);

  const admin = await database();

  try {
    // The observation and its admission are both still there: a removal is an
    // investigation, never an automatic deletion.
    const retained = await admin.query<{
      observations: string;
      admissions: string;
      vouchers: string;
    }>(
      `SELECT (SELECT count(*)::text FROM openerp.bank_observations WHERE book_id = $1) AS observations,
              (SELECT count(*)::text FROM openerp.bank_source_admissions WHERE book_id = $1) AS admissions,
              (SELECT count(*)::text FROM openerp.vouchers WHERE book_id = $1) AS vouchers`,
      [book.bookId],
    );

    expect(retained.rows[0]?.observations).toBe("1");
    expect(retained.rows[0]?.admissions).toBe("1");
    expect(retained.rows[0]?.vouchers).toBe("0");

    const caseRow = await admin.query<{ ledger_effect: string }>(
      "SELECT body->>'ledgerEffect' AS ledger_effect FROM openerp.bank_source_cases WHERE book_id = $1",
      [book.bookId],
    );

    expect(caseRow.rows[0]?.ledger_effect).toBe("none_no_automatic_deletion_or_reversal");
  } finally {
    await admin.end();
  }
}, 180000);

test("a pending change stays a non-financial observation and is never admitted as final", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_pending");
  // The retained bytes say pending, not the request.
  const raw = providerPage([{ id: "tx_pending", amount: "7.25", pending: true }]);

  const { claimed } = await publishedWindow(book, granted.id, raw, [
    { kind: "added", sourceId: "tx_pending" },
  ]);

  const receipt = await decoded(
    await apply(book, {
      generationId: claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_pending",
      bookingDate: "2026-06-10",
      authorizationDate: null,
      currency: "SEK",
      // The request claims not-pending. The retained bytes say otherwise, and
      // the bytes win: this is why the request carries no amount or status.
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    Revisions.ApplyProviderRevisionReceipt,
  );

  expect(receipt.facts.pending).toBe(true);
  expect(receipt.outcome.kind).toBe("pending_observation");
  // It is not admitted and nothing is banked from it.
  expect(receipt.journalIds).toHaveLength(0);

  const state = await decoded(
    await observe(book, granted.id, "tx_pending"),
    Revisions.ProviderObservationState,
  );

  expect(state.admitted).toBeNull();
  expect(state.matched).toBe(false);
  expect(state.accountingComplete).toBe(false);
}, 180000);

test("an agent reads a provider observation but cannot interpret or admit one", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_agent");
  const raw = providerPage([{ id: "tx_agent", amount: "3.00" }]);

  const { claimed } = await publishedWindow(book, granted.id, raw, [
    { kind: "added", sourceId: "tx_agent" },
  ]);

  const operator = await decoded(
    await apply(book, {
      generationId: claimed.generationId,
      pageOrdinal: 0,
      recordOrdinal: 0,
      providerTransactionId: "tx_agent",
      bookingDate: "2026-07-10",
      authorizationDate: null,
      currency: "SEK",
      currencyScale: 2,
      pending: false,
      pendingReference: null,
    }),
    Revisions.ApplyProviderRevisionReceipt,
  );

  expect(operator.facts.cashMovementMinor).toBe("-300");

  const state = await decoded(
    await observe(book, granted.id, "tx_agent"),
    Revisions.ProviderObservationState,
  );

  expect(state.revisions[0]?.revisionId).toBe(operator.facts.revisionId);
  expect(state.admitted).toBeNull();
}, 180000);

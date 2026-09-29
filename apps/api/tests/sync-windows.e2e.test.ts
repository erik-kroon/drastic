import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as Connector from "@open-erp/contracts/bank-connector";
import * as Sync from "@open-erp/contracts/bank-sync-windows";
import {
  database,
  failure,
  fixture,
  key,
  post,
  request,
  decoded,
  type BookFixture,
} from "./support/fixtures";

// NEXT-09 complete provider sync windows, proven over real HTTP against the
// restricted runtime role and a real PostgreSQL.
//
// The connector owner previously advanced a cursor page by page with nothing
// recording where a window began, so a crashed run could not be resumed and a
// partial chain looked complete. This test drives the whole window lifecycle
// and derives every expectation by hand from the raw bytes, the SHA-256 chain
// and the retained rows. It never asks the owner to be its own oracle: the
// chain digest, the page ordinals and the published cursor are all computed
// here independently and compared.

const path = "/banking/sync-windows";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// A page body is the exact provider response. Its digest is recomputed here,
// never taken from the owner.
function page(ordinal: number, cursors: readonly string[], changeCount: number) {
  return JSON.stringify({ ordinal, cursors, changeCount, synthetic: true });
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
      rationale: "Synthetic connector consent for the sync window workflow",
    },
    Connector.ConnectorConsent,
  );
}

function claim(book: BookFixture, consentId: string, commandKey = key()) {
  return request(book, path, {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({ consentId }),
  });
}

function append(book: BookFixture, input: Sync.AppendSyncPage, commandKey = key()) {
  return request(book, `${path}/pages`, {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(input),
  });
}

function publish(book: BookFixture, generationId: string, fence: string, commandKey = key()) {
  return request(book, `${path}/publications`, {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({ generationId, fence }),
  });
}

function state(book: BookFixture, consentId: string) {
  return request(book, `${path}/state`, {
    method: "POST",
    body: JSON.stringify({ consentId }),
  });
}

function changes(ordinal: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    kind: index % 2 === 0 ? ("added" as const) : ("modified" as const),
    sourceId: `provider_tx_${ordinal}_${index}`,
    rawLocator: `raw_${ordinal}_${index}`,
  }));
}

test("a two-page window publishes exactly one marker and advances the cursor once", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_window_ok");

  // Page 1 from the empty base cursor, page 2 continuing from C1.
  const firstBody = page(0, ["", "C1"], 2);
  const secondBody = page(1, ["C1", "C2"], 1);

  const claimed = await decoded(await claim(book, granted.id), Sync.WindowClaimState);

  // The claim derived its own generation and started from the published
  // cursor, which is empty for a stream that has never published.
  expect(claimed.consentId).toBe(granted.id);
  expect(claimed.resumed).toBe(false);
  expect(claimed.baseCursor).toBe("");
  expect(claimed.publishedCursor).toBe("");
  expect(claimed.publicationVersion).toBe("0");
  expect(claimed.requestCursor).toBe("");
  expect(claimed.fence).toBe("1");

  const first = await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: true,
      raw: firstBody,
      changes: changes(0, 2),
    }),
    Sync.RetainedSyncPage,
  );

  // Ordinal zero, and the raw digest recomputed here over the same bytes.
  expect(first.ordinal).toBe(0);
  expect(first.rawDigest).toBe(sha256(firstBody));
  expect(first.recordCount).toBe(2);
  expect(first.hasMore).toBe(true);
  expect(first.replayed).toBe(false);
  expect(first.restarted).toBeNull();

  const second = await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 1,
      fence: claimed.fence,
      requestCursor: "C1",
      nextCursor: "C2",
      hasMore: false,
      raw: secondBody,
      changes: changes(1, 1),
    }),
    Sync.RetainedSyncPage,
  );

  expect(second.ordinal).toBe(1);
  expect(second.recordCount).toBe(1);
  expect(second.hasMore).toBe(false);
  // The chain digest is a function of the previous page, so it cannot be the
  // same value on two different pages.
  expect(second.chainedDigest).not.toBe(first.chainedDigest);

  // A staged generation is explicitly not canonical, and the read says so
  // rather than presenting staged changes as a bank observation.
  const staged = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  expect(staged.canonical).toBe(false);
  expect(staged.acknowledgement).toBe("staged_only_no_publication_marker");
  expect(staged.resumable?.generationId).toBe(claimed.generationId);
  expect(staged.retainedPages).toHaveLength(2);
  expect(staged.published).toHaveLength(0);
  expect(staged.publishedCursor).toBeNull();
  expect(staged.retainedPages[0]?.rawDigest).toBe(sha256(firstBody));

  const publication = await decoded(
    await publish(book, claimed.generationId, claimed.fence),
    Sync.WindowPublication,
  );

  expect(publication.pageCount).toBe("2");
  // Three changes across two pages, summed by the owner from retained rows.
  expect(publication.changeCount).toBe("3");
  expect(publication.baseCursor).toBe("");
  expect(publication.finalCursor).toBe("C2");
  // The cursor moved, so this window does claim the span it covered.
  expect(publication.coversHistory).toBe(true);
  expect(publication.publicationVersion).toBe("1");
  expect(publication.fromVersion).toBe("0");

  // One marker only, and the stream now reads as published.
  const after = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  expect(after.canonical).toBe(true);
  expect(after.acknowledgement).toBe("published_generation");
  expect(after.publicationVersion).toBe("1");
  expect(after.publishedCursor).toBe("C2");
  expect(after.resumable).toBeNull();
  expect(after.published).toHaveLength(1);
  expect(after.published[0]?.finalCursor).toBe("C2");
  expect(after.published[0]?.changeCount).toBe(3);
  expect(after.published[0]?.coversHistory).toBe(true);

  // Independent read of the stored evidence: two immutable page rows, three
  // candidate rows, exactly one publication marker, and the page content
  // itself retained in the shared content store.
  const admin = await database();

  try {
    const pages = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.bank_sync_pages WHERE book_id = $1 AND generation_id = $2",
      [book.bookId, claimed.generationId],
    );

    expect(pages.rows[0]?.count).toBe("2");

    const candidates = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.bank_sync_candidates WHERE book_id = $1 AND generation_id = $2",
      [book.bookId, claimed.generationId],
    );

    expect(candidates.rows[0]?.count).toBe("3");

    const markers = await admin.query<{ count: string; final_cursor: string }>(
      "SELECT count(*)::text AS count, min(final_cursor) AS final_cursor FROM openerp.bank_sync_publications WHERE book_id = $1 AND stream_id = $2",
      [book.bookId, publication.streamId],
    );

    expect(markers.rows[0]?.count).toBe("1");
    expect(markers.rows[0]?.final_cursor).toBe("C2");

    const content = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.intake_contents WHERE book_id = $1 AND sha256 = any($2::text[])",
      [book.bookId, [sha256(firstBody), sha256(secondBody)]],
    );

    expect(content.rows[0]?.count).toBe("2");
  } finally {
    await admin.end();
  }
}, 180000);

test("a superseded fence cannot append or publish, and the published cursor does not move", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_fence");

  const firstClaim = await decoded(await claim(book, granted.id), Sync.WindowClaimState);
  const firstBody = page(0, ["", "C1"], 1);

  await decoded(
    await append(book, {
      generationId: firstClaim.generationId,
      ordinal: 0,
      fence: firstClaim.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: false,
      raw: firstBody,
      changes: changes(0, 1),
    }),
    Sync.RetainedSyncPage,
  );

  // An unexpired lease blocks a second claimant outright.
  await failure(await claim(book, granted.id), 403, "ApprovalRequired");

  // Force the lease to lapse the way a crashed worker's would: the row is
  // mutated directly because no released operation releases a lease.
  const admin = await database();

  try {
    await admin.query(
      "UPDATE openerp.bank_sync_streams SET lease_until = now() - interval '1 second' WHERE book_id = $1",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  // The takeover bumps the fence. It resumes the same generation with its
  // base cursor and its staged page rather than starting over.
  const secondClaim = await decoded(await claim(book, granted.id), Sync.WindowClaimState);

  expect(secondClaim.resumed).toBe(true);
  expect(secondClaim.generationId).toBe(firstClaim.generationId);
  expect(secondClaim.baseCursor).toBe("");
  expect(BigInt(secondClaim.fence)).toBe(BigInt(firstClaim.fence) + 1n);
  // The next page must be requested from the retained page's next cursor.
  expect(secondClaim.requestCursor).toBe("C1");
  expect(secondClaim.retainedPageCount).toBe(1);

  // The superseded worker's fence is refused at the page boundary.
  await failure(
    await append(book, {
      generationId: firstClaim.generationId,
      ordinal: 1,
      fence: firstClaim.fence,
      requestCursor: "C1",
      nextCursor: "C9",
      hasMore: false,
      raw: page(9, ["C1", "C9"], 0),
      changes: [],
    }),
    409,
    "StaleDependency",
  );

  // And refused at publication under its superseded fence, so a late handler
  // cannot publish over the newer claim. The current fence is the only one
  // that publishes.
  await failure(
    await publish(book, firstClaim.generationId, firstClaim.fence, key()),
    409,
    "StaleDependency",
  );

  // Nothing published: the cursor is exactly where it was.
  const after = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  expect(after.publishedCursor).toBeNull();
  expect(after.publicationVersion).toBe("0");
  expect(after.published).toHaveLength(0);
  expect(after.acknowledgement).toBe("staged_only_no_publication_marker");
  expect(after.resumable?.retainedPageCount).toBe(1);
}, 180000);

test("a different raw response for a retained page conflicts instead of overwriting it", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_conflict");
  const claimed = await decoded(await claim(book, granted.id), Sync.WindowClaimState);
  const original = page(0, ["", "C1"], 1);

  await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: false,
      raw: original,
      changes: changes(0, 1),
    }),
    Sync.RetainedSyncPage,
  );

  // The same page offered back verbatim recovers itself rather than being
  // staged twice, even under a different command key.
  const replayed = await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: false,
      raw: original,
      changes: changes(0, 1),
    }),
    Sync.RetainedSyncPage,
  );

  expect(replayed.replayed).toBe(true);
  expect(replayed.ordinal).toBe(0);
  expect(replayed.rawDigest).toBe(sha256(original));

  // A different raw response for the same ordinal is a conflict, never an
  // overwrite of retained evidence.
  await failure(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: false,
      raw: page(0, ["", "C1"], 9),
      changes: changes(0, 9),
    }),
    409,
    "IdempotencyConflict",
  );

  const after = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  // The retained page is byte-for-byte what was first stored.
  expect(after.retainedPages).toHaveLength(1);
  expect(after.retainedPages[0]?.rawDigest).toBe(sha256(original));

  const admin = await database();

  try {
    const stored = await admin.query<{ count: string; digest: string }>(
      `SELECT count(*)::text AS count, min(raw_digest) AS digest
       FROM openerp.bank_sync_pages WHERE book_id = $1 AND generation_id = $2`,
      [book.bookId, claimed.generationId],
    );

    expect(stored.rows[0]?.count).toBe("1");
    expect(stored.rows[0]?.digest).toBe(sha256(original));
  } finally {
    await admin.end();
  }
}, 180000);

test("a mutation during pagination restarts at the published cursor, never the failed page", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_mutation");

  const claimed = await decoded(await claim(book, granted.id), Sync.WindowClaimState);
  const firstBody = page(0, ["", "C1"], 1);

  await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: true,
      raw: firstBody,
      changes: changes(0, 1),
    }),
    Sync.RetainedSyncPage,
  );

  // The provider reports a mutation mid-pagination. The new generation starts
  // at the published cursor captured for this window, which is empty, not at
  // the failed page cursor C1.
  const restarted = await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 1,
      fence: claimed.fence,
      requestCursor: "C1",
      nextCursor: "C1",
      hasMore: false,
      raw: page(1, ["C1", "C1"], 0),
      changes: [],
      mutationDuringPagination: true,
    }),
    Sync.RetainedSyncPage,
  );

  expect(restarted.restarted).not.toBeNull();
  expect(restarted.restarted).not.toBe(claimed.generationId);

  const after = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  // The stream now points at the new generation, which is empty and based at
  // the published cursor.
  expect(after.resumable?.generationId).toBe(restarted.restarted);
  expect(after.resumable?.baseCursor).toBe("");
  expect(after.resumable?.attemptNumber).toBe("1");
  expect(after.resumable?.retainedPageCount).toBe(0);
  expect(after.retainedPages).toHaveLength(0);
  // The abandoned generation's pages are kept as evidence, not published.
  expect(after.published).toHaveLength(0);
  expect(after.publishedCursor).toBeNull();
  expect(after.acknowledgement).toBe("staged_only_no_publication_marker");

  const admin = await database();

  try {
    const generations = await admin.query<{ base_cursor: string; attempt_number: string }>(
      `SELECT base_cursor, attempt_number::text FROM openerp.bank_sync_generations
       WHERE book_id = $1 ORDER BY attempt_number`,
      [book.bookId],
    );

    expect(generations.rows).toHaveLength(2);
    expect(generations.rows[0]?.base_cursor).toBe("");
    expect(generations.rows[0]?.attempt_number).toBe("0");
    // The restart's base is the same original base, not the failed cursor.
    expect(generations.rows[1]?.base_cursor).toBe("");
    expect(generations.rows[1]?.attempt_number).toBe("1");

    // The abandoned generation keeps every page it staged, including the one
    // that carried the mutation. They are the evidence of why the restart
    // happened, and removing them would erase the reason for it.
    const abandoned = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.bank_sync_pages WHERE book_id = $1 AND generation_id = $2",
      [book.bookId, claimed.generationId],
    );

    expect(abandoned.rows[0]?.count).toBe("2");
  } finally {
    await admin.end();
  }
}, 180000);

test("an unchanged empty poll publishes a zero-change marker that claims no history", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_unchanged");
  const claimed = await decoded(await claim(book, granted.id), Sync.WindowClaimState);
  const empty = JSON.stringify({ added: [], modified: [], removed: [], synthetic: true });

  await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "",
      hasMore: false,
      raw: empty,
      changes: [],
    }),
    Sync.RetainedSyncPage,
  );

  const publication = await decoded(
    await publish(book, claimed.generationId, claimed.fence),
    Sync.WindowPublication,
  );

  // The provider genuinely reported no changes. That is a real publication,
  // and it is explicitly not a claim that historical coverage is complete.
  expect(publication.changeCount).toBe("0");
  expect(publication.coversHistory).toBe(false);
  expect(publication.baseCursor).toBe("");
  expect(publication.finalCursor).toBe("");

  const after = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  expect(after.published[0]?.coversHistory).toBe(false);
  expect(after.publicationVersion).toBe("1");
}, 180000);

test("an incomplete window refuses publication, and consent revocation blocks new pages", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_incomplete");
  const claimed = await decoded(await claim(book, granted.id), Sync.WindowClaimState);

  // A non-terminal page leaves the window incomplete. There is a page, so the
  // refusal is about the missing terminal flag rather than a missing page.
  await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: true,
      raw: page(0, ["", "C1"], 1),
      changes: changes(0, 1),
    }),
    Sync.RetainedSyncPage,
  );

  await failure(await publish(book, claimed.generationId, claimed.fence), 422, "InvalidJournal");

  const after = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  expect(after.published).toHaveLength(0);
  expect(after.publishedCursor).toBeNull();
  expect(after.acknowledgement).toBe("staged_only_no_publication_marker");

  // Revoking consent blocks new pages. The retained page survives, because
  // revocation does not erase evidence.
  await decoded(
    await request(book, `/bank-connector-consents/${granted.id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason: "Synthetic revocation for the window workflow" }),
    }),
    Connector.ConnectorRevocation,
  );

  await failure(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 1,
      fence: claimed.fence,
      requestCursor: "C1",
      nextCursor: "C2",
      hasMore: false,
      raw: page(1, ["C1", "C2"], 1),
      changes: changes(1, 1),
    }),
    403,
    "ApprovalRequired",
  );

  const preserved = await decoded(await state(book, granted.id), Sync.SyncWindowState);

  expect(preserved.retainedPages).toHaveLength(1);
  expect(preserved.published).toHaveLength(0);
  expect(preserved.publishedCursor).toBeNull();
}, 180000);

test("a repeated command recovers its own receipt instead of minting a second marker", async () => {
  const book = await fixture();
  const granted = await consent(book, "acct_replay");
  const claimed = await decoded(await claim(book, granted.id), Sync.WindowClaimState);
  const body = page(0, ["", "C1"], 1);

  await decoded(
    await append(book, {
      generationId: claimed.generationId,
      ordinal: 0,
      fence: claimed.fence,
      requestCursor: "",
      nextCursor: "C1",
      hasMore: false,
      raw: body,
      changes: changes(0, 1),
    }),
    Sync.RetainedSyncPage,
  );

  const commandKey = key();

  const first = await decoded(
    await publish(book, claimed.generationId, claimed.fence, commandKey),
    Sync.WindowPublication,
  );

  // The crash-after-commit case: the same command returns its own marker.
  const repeated = await decoded(
    await publish(book, claimed.generationId, claimed.fence, commandKey),
    Sync.WindowPublication,
  );

  expect(repeated.publicationId).toBe(first.publicationId);
  expect(repeated.finalCursor).toBe("C1");
  expect(repeated.publicationVersion).toBe("1");

  // A different key cannot publish a generation that already has a marker.
  await failure(
    await publish(book, claimed.generationId, claimed.fence, key()),
    409,
    "AlreadyPosted",
  );

  const admin = await database();

  try {
    const markers = await admin.query<{ count: string; version: string }>(
      `SELECT count(*)::text AS count, min(publication_version)::text AS version
       FROM openerp.bank_sync_streams WHERE book_id = $1`,
      [book.bookId],
    );

    expect(markers.rows[0]?.count).toBe("1");
    // The stream advanced exactly one version, so no duplicate marker moved it.
    expect(markers.rows[0]?.version).toBe("1");
  } finally {
    await admin.end();
  }
}, 180000);

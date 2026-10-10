import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Source from "@open-erp/contracts/source-intake";
import {
  apiDirectory,
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";
import { supplierFixture } from "./support/supplier-review";

const file = (fileId: string, content = "synthetic document") => ({
  fileId,
  revision: "r1",
  filename: `${fileId}.txt`,
  mediaType: "text/plain" as const,
  contentBase64: Buffer.from(content).toString("base64"),
});

const batch = (
  channel: "email" | "bulk" | "drive" | "dropbox",
  items: ReadonlyArray<ReturnType<typeof file>>,
) => ({
  channel,
  sourceAccountId: "synthetic-account",
  destination: null,
  envelopeId: null,
  items,
});

const send = async (
  book: Awaited<ReturnType<typeof fixture>>,
  input: unknown,
  idempotencyKey = key(),
) =>
  decoded(
    await request(book, "/commerce/supplier-inbox/intake-batches", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    }),
    Inbox.IntakeBatchResult,
  );

async function nativeApi<T>(run: (url: string) => Promise<T>): Promise<T> {
  const objects = join(environment().scratch, "intake-native-objects");
  await mkdir(objects, { recursive: true, mode: 0o700 });
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No native intake port");

  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );

  const child = spawn("bun", ["--no-env-file", "scripts/native-browser-api.ts"], {
    cwd: apiDirectory,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: environment().runtimeUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BETTER_AUTH_URL: origin,
      OPENERP_OBJECT_DIRECTORY: objects,
      OPENERP_INTAKE_FEED: "local-fixture",
      OPENERP_INTAKE_ENDPOINT: environment().intakeFixtureUrl,
      OPENERP_INTAKE_SECRET: environment().intakeFixtureSecret,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = createInterface({ input: child.stdout });
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });

  try {
    const url = await new Promise<string>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(new Error(`Native intake API exited: ${errors}`)));
      lines.on("line", (line) => {
        if (line.startsWith('{"nativeApi":true,'))
          resolve((JSON.parse(line) as { url: string }).url);
      });
    });

    return await run(url);
  } finally {
    lines.close();

    if (child.pid && child.exitCode === null) {
      const exited = once(child, "exit");
      process.kill(-child.pid, "SIGTERM");
      await exited;
    }
  }
}

// Failure contract: forged/wrong-book destination and attachment-less inbound mail must refuse.
test("local inbound envelope binds book and attachment identity without posting", async () => {
  const book = await fixture();
  const other = await fixture();
  const before = await persisted(book);

  const { address } = await decoded(
    await request(book, "/commerce/supplier-inbox/intake-destination"),
    Inbox.ForwardingDestination,
  );

  const wrong = await decoded(
    await request(other, "/commerce/supplier-inbox/intake-destination"),
    Inbox.ForwardingDestination,
  );

  expect(address).not.toBe(wrong.address);

  const email = {
    ...batch("email", [file("a"), file("b")]),
    destination: address,
    envelopeId: "message-1",
  };

  await failure(
    await request(book, "/commerce/supplier-inbox/intake-batches", {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ ...email, destination: wrong.address }),
    }),
    403,
    "Forbidden",
  );
  expect(
    (
      await request(book, "/commerce/supplier-inbox/intake-batches", {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({ ...email, items: [] }),
      })
    ).status,
  ).toBe(400);
  const first = await send(book, email);
  expect(first.items.map((item) => item.status)).toEqual(["retained", "retained"]);
  expect(first.items[0]?.occurrenceId).not.toBe(first.items[1]?.occurrenceId);

  const inbox = await decoded(
    await request(book, `/commerce/supplier-inbox/${first.items[0]?.occurrenceId}`),
    Inbox.SupplierInboxView,
  );

  expect(inbox.intakeProvenance).toMatchObject({
    channel: "email",
    sourceAccountId: "synthetic-account",
    envelopeId: "message-1",
    fileId: "a",
    revision: "r1",
  });

  const mcpResponse = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "supplier_inbox_get",
        arguments: {
          scope: { entityId: book.entityId, bookId: book.bookId },
          occurrenceId: first.items[0]?.occurrenceId,
        },
      },
    }),
  });

  expect(mcpResponse.status).toBe(200);

  const mcp = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(false),
        structuredContent: Schema.Struct({ result: Inbox.SupplierInboxView }),
      }),
    }),
  )(await mcpResponse.json());

  expect(mcp.result.structuredContent.result.intakeProvenance).toEqual(inbox.intakeProvenance);

  const admin = await database();

  try {
    const metadata = await admin.query<{
      envelopeId: string;
      fileId: string;
      sourceAccountId: string;
    }>(
      `SELECT envelope_id AS "envelopeId", file_id AS "fileId", source_account_id AS "sourceAccountId" FROM openerp.supplier_intake_provenance WHERE book_id = $1 ORDER BY file_id`,
      [book.bookId],
    );

    expect(metadata.rows).toEqual([
      { envelopeId: "message-1", fileId: "a", sourceAccountId: "synthetic-account" },
      { envelopeId: "message-1", fileId: "b", sourceAccountId: "synthetic-account" },
    ]);
  } finally {
    await admin.end();
  }

  const replay = await send(book, email);
  expect(replay.items.map((item) => item.occurrenceId)).toEqual(
    first.items.map((item) => item.occurrenceId),
  );
  const conflictingKey = key();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await failure(
      await request(book, "/commerce/supplier-inbox/intake-batches", {
        method: "POST",
        headers: { "idempotency-key": conflictingKey },
        body: JSON.stringify({ ...email, items: [file("a", "altered"), file("b")] }),
      }),
      409,
      "IdempotencyConflict",
    );
  }

  await failure(
    await request(book, "/commerce/supplier-inbox/intake-batches", {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ ...email, items: [file("a")] }),
    }),
    409,
    "IdempotencyConflict",
  );
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "bureau-intake-email.json"),
    JSON.stringify({ address, first, replay, before, after: await persisted(book) }, null, 2),
  );
});

// Failure contract: >20 items retain per-item outcomes, equal bytes do not erase channel provenance.
test("bulk exceeds inbox page and retains independent cross-channel provenance", async () => {
  const book = await fixture();
  const before = await persisted(book);

  const input = batch(
    "bulk",
    Array.from({ length: 23 }, (_, index) => file(`bulk-${index}`)),
  );

  const bulkKey = key();
  const first = await send(book, input, bulkKey);
  const exactReplay = await send(book, input, bulkKey);
  expect(exactReplay).toEqual(first);
  expect(first.items).toHaveLength(23);
  expect(first.items.filter((item) => item.status === "retained")).toHaveLength(23);
  expect(first.nextCursor).toBeNull();

  const second = await send(book, {
    ...input,
    items: input.items.map((item, index) =>
      index === 9 ? file("bulk-9", "changed content") : item,
    ),
  });

  expect(second.items.filter((item) => item.status === "duplicate")).toHaveLength(22);
  expect(second.items[9]?.status).toBe("refused");
  expect(second.items[9]?.reason).toBe("IdempotencyConflict");
  expect(
    second.items.filter((item) => item.occurrenceId !== null).map((item) => item.occurrenceId),
  ).toEqual(first.items.filter((_, index) => index !== 9).map((item) => item.occurrenceId));

  const emailAddress = (
    await decoded(
      await request(book, "/commerce/supplier-inbox/intake-destination"),
      Inbox.ForwardingDestination,
    )
  ).address;

  const email = await send(book, {
    ...batch("email", [file("same", "synthetic document")]),
    destination: emailAddress,
    envelopeId: "cross-channel",
  });

  expect(email.items[0]?.occurrenceId).not.toBe(first.items[0]?.occurrenceId);

  const source1 = await decoded(
    await request(book, `/source-occurrences/${first.items[0]?.occurrenceId}`),
    Source.SourceOccurrenceView,
  );

  const source2 = await decoded(
    await request(book, `/source-occurrences/${email.items[0]?.occurrenceId}`),
    Source.SourceOccurrenceView,
  );

  expect(source1.occurrence.sha256).toBe(source2.occurrence.sha256);
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "bureau-intake-bulk.json"),
    JSON.stringify(
      {
        count: first.items.length,
        first,
        exactReplay,
        mixedOutcome: second,
        before,
        after: await persisted(book),
      },
      null,
      2,
    ),
  );
});

// Failure contract: cloud revision never overwrites; refused/expired/timeout do not advance cursor.
test("Drive and Dropbox fixture acquisition recovers after timeout and expiry", async () => {
  const book = await fixture();
  const before = await persisted(book);
  const setup = await database();

  try {
    await setup.query(
      "INSERT INTO openerp.supplier_intake_connections (book_id, provider, source_account_id, folder_id) VALUES ($1, 'drive', 'drive-account', 'folder-one'), ($1, 'dropbox', 'dropbox-account', 'folder-one')",
      [book.bookId],
    );
  } finally {
    await setup.end();
  }

  const setPage = async (
    provider: "drive" | "dropbox",
    account: string,
    page: unknown,
    cursor: string | null = null,
    folder = "folder-one",
  ) => {
    const url = new URL("/dataset", environment().intakeFixtureUrl);
    url.searchParams.set("provider", provider);
    url.searchParams.set("account", account);
    url.searchParams.set("folder", folder);

    if (cursor !== null) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${environment().intakeFixtureSecret}` },
      body: JSON.stringify(Array.isArray(page) ? { items: page, nextCursor: "next-page" } : page),
    });

    expect(response.status).toBe(204);
  };

  const metric = async () => {
    const response = await fetch(new URL("/metrics", environment().intakeFixtureUrl), {
      headers: { authorization: `Bearer ${environment().intakeFixtureSecret}` },
    });

    return ((await response.json()) as { fetchCount: number }).fetchCount;
  };

  const cloud = async (
    provider: "drive" | "dropbox",
    account: string,
    idempotencyKey = key(),
    cursor: string | null = null,
  ) =>
    decoded(
      await request(book, "/commerce/supplier-inbox/cloud-imports", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          provider,
          sourceAccountId: account,
          folderId: "folder-one",
          cursor,
        }),
      }),
      Inbox.IntakeBatchResult,
    );

  const other = await fixture();
  const otherAdmin = await database();

  try {
    await otherAdmin.query(
      "INSERT INTO openerp.supplier_intake_connections (book_id, provider, source_account_id, folder_id) VALUES ($1, 'drive', 'drive-account', 'folder-two')",
      [other.bookId],
    );
  } finally {
    await otherAdmin.end();
  }

  const pagesBeforeRefusal = await metric();

  for (const [target, folderId] of [
    [other, "folder-one"],
    [book, "folder-two"],
  ] as const) {
    await failure(
      await request(target, "/commerce/supplier-inbox/cloud-imports", {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({
          provider: "drive",
          sourceAccountId: "drive-account",
          folderId,
          cursor: null,
        }),
      }),
      403,
      "Forbidden",
    );
  }

  expect(await metric()).toBe(pagesBeforeRefusal);

  await setPage(
    "drive",
    "drive-account",
    [{ ...file("folder-two-only"), state: "available" }],
    null,
    "folder-two",
  );

  const otherResult = await decoded(
    await request(other, "/commerce/supplier-inbox/cloud-imports", {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        provider: "drive",
        sourceAccountId: "drive-account",
        folderId: "folder-two",
        cursor: null,
      }),
    }),
    Inbox.IntakeBatchResult,
  );

  expect(otherResult.items[0]?.status).toBe("retained");
  await failure(
    await request(book, `/source-occurrences/${otherResult.items[0]?.occurrenceId}`),
    404,
    "NotFound",
  );

  const initial = [
    { ...file("file-1"), state: "timeout" },
    { ...file("file-2"), state: "expired" },
    { ...file("file-3"), state: "available" },
  ];

  await setPage("drive", "drive-account", initial);
  const cloudKey = key();
  const first = await cloud("drive", "drive-account", cloudKey);
  expect(first.items.map((item) => item.status)).toEqual(["unknown", "expired", "retained"]);
  expect(first.nextCursor).toBeNull();
  const replay = await cloud("drive", "drive-account", cloudKey);
  expect(replay).toEqual(first);
  await setPage(
    "drive",
    "drive-account",
    initial.map((item) => ({ ...item, state: "available" })),
  );
  const resolved = await cloud("drive", "drive-account");
  expect(resolved.items.map((item) => item.status)).toEqual(["retained", "retained", "duplicate"]);
  expect(resolved.nextCursor).toBe("next-page");
  await setPage("drive", "drive-account", [
    { ...file("file-1", "changed bytes"), revision: "r2", state: "available" },
  ]);
  const revision = await cloud("drive", "drive-account");
  expect(revision.items[0]?.occurrenceId).not.toBe(resolved.items[0]?.occurrenceId);

  const original = await decoded(
    await request(book, `/source-occurrences/${resolved.items[0]?.occurrenceId}`),
    Source.SourceOccurrenceView,
  );

  const changed = await decoded(
    await request(book, `/source-occurrences/${revision.items[0]?.occurrenceId}`),
    Source.SourceOccurrenceView,
  );

  expect(Buffer.from(original.contentBase64, "base64").toString()).toBe("synthetic document");
  expect(Buffer.from(changed.contentBase64, "base64").toString()).toBe("changed bytes");
  expect(original.occurrence.sha256).not.toBe(changed.occurrence.sha256);

  const inbox = await decoded(
    await request(book, `/commerce/supplier-inbox/${revision.items[0]?.occurrenceId}`),
    Inbox.SupplierInboxView,
  );

  expect(inbox.intakeProvenance).toMatchObject({
    channel: "drive",
    sourceAccountId: "drive-account",
    folderId: "folder-one",
    fileId: "file-1",
    revision: "r2",
  });
  const provenanceDb = await database();

  try {
    const metadata = await provenanceDb.query<{
      fileId: string;
      folderId: string;
      revision: string;
    }>(
      `SELECT file_id AS "fileId", folder_id AS "folderId", source_revision AS revision FROM openerp.supplier_intake_provenance WHERE book_id = $1 AND occurrence_id = ANY($2::text[]) ORDER BY source_revision`,
      [book.bookId, [resolved.items[0]?.occurrenceId, revision.items[0]?.occurrenceId]],
    );

    expect(metadata.rows).toEqual([
      { fileId: "file-1", folderId: "folder-one", revision: "r1" },
      { fileId: "file-1", folderId: "folder-one", revision: "r2" },
    ]);
  } finally {
    await provenanceDb.end();
  }

  await setPage("dropbox", "dropbox-account", [
    { ...file("file-1", "changed bytes"), revision: "r2", state: "available" },
    { ...file("denied"), state: "refused" },
  ]);
  const revised = await cloud("dropbox", "dropbox-account");
  expect(revised.items.map((item) => item.status)).toEqual(["retained", "refused"]);
  expect(revised.items[0]?.occurrenceId).not.toBe(resolved.items[0]?.occurrenceId);

  await setPage("drive", "drive-account", { transport: "disconnect" }, "disconnect-page");
  const uncertainKey = key();
  const disconnected = await cloud("drive", "drive-account", uncertainKey, "disconnect-page");
  expect(disconnected).toMatchObject({ state: "unknown", items: [], nextCursor: null });

  const readsBeforeReplay = await metric();
  expect(await cloud("drive", "drive-account", uncertainKey, "disconnect-page")).toEqual(
    disconnected,
  );
  expect(await metric()).toBe(readsBeforeReplay);

  await setPage(
    "drive",
    "drive-account",
    [{ ...file("after-disconnect"), state: "available" }],
    "disconnect-page",
  );

  const recoveryKey = key();

  const { nativeReplay, recovered } = await nativeApi(async (url) => {
    const nativeRequest = (idempotencyKey: string) =>
      fetch(`${url}${book.path}/commerce/supplier-inbox/cloud-imports`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${book.token}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          provider: "drive",
          sourceAccountId: "drive-account",
          folderId: "folder-one",
          cursor: "disconnect-page",
        }),
      });

    const before = await metric();
    const nativeReplay = await decoded(await nativeRequest(uncertainKey), Inbox.IntakeBatchResult);
    expect(nativeReplay).toEqual(disconnected);
    expect(await metric()).toBe(before);
    const recovered = await decoded(await nativeRequest(recoveryKey), Inbox.IntakeBatchResult);

    return { nativeReplay, recovered };
  });

  expect(recovered.items[0]?.status).toBe("retained");
  expect(recovered.nextCursor).toBe("next-page");

  const restarted = await nativeApi(async (url) => {
    const callsBefore = await metric();

    const receipt = await decoded(
      await fetch(`${url}${book.path}/commerce/supplier-inbox/cloud-imports`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${book.token}`,
          "content-type": "application/json",
          "idempotency-key": recoveryKey,
        },
        body: JSON.stringify({
          provider: "drive",
          sourceAccountId: "drive-account",
          folderId: "folder-one",
          cursor: "disconnect-page",
        }),
      }),
      Inbox.IntakeBatchResult,
    );

    expect(await metric()).toBe(callsBefore);

    const source = await decoded(
      await fetch(`${url}${book.path}/source-occurrences/${receipt.items[0]?.occurrenceId}`, {
        headers: { authorization: `Bearer ${book.token}` },
      }),
      Source.SourceOccurrenceView,
    );

    return { receipt, retainedContent: Buffer.from(source.contentBase64, "base64").toString() };
  });

  expect(restarted.receipt).toEqual(recovered);
  expect(restarted.retainedContent).toBe("synthetic document");
  expect(await persisted(book)).toEqual(before);
  const admin = await database();

  try {
    const journal = await admin.query(
      "SELECT count(*)::int AS total FROM openerp.vouchers WHERE book_id = $1",
      [book.bookId],
    );

    expect(journal.rows[0]?.total).toBe(0);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "bureau-intake-cloud.json"),
    JSON.stringify(
      {
        first,
        replay,
        resolved,
        revision,
        revised,
        disconnected,
        nativeReplay,
        recovered,
        restarted,
        attempts: {
          unresolved: {
            key: uncertainKey,
            provider: "drive",
            account: "drive-account",
            folder: "folder-one",
            cursor: "disconnect-page",
          },
          reacquired: {
            key: recoveryKey,
            provider: "drive",
            account: "drive-account",
            folder: "folder-one",
            cursor: "disconnect-page",
          },
        },
        before,
        after: await persisted(book),
      },
      null,
      2,
    ),
  );
});

// Failure contract: acquisition and review preparation cannot post without exact human approval.
test("forwarded original reaches supplier draft review without posting", async () => {
  const setup = await supplierFixture();
  const book = setup.book;
  const before = await persisted(book);

  const address = (
    await decoded(
      await request(book, "/commerce/supplier-inbox/intake-destination"),
      Inbox.ForwardingDestination,
    )
  ).address;

  const received = await send(book, {
    ...batch("email", [file("review-original", "supplier review original 10000")]),
    destination: address,
    envelopeId: "review-envelope",
  });

  const occurrenceId = received.items[0]?.occurrenceId;
  expect(occurrenceId).toBeTruthy();

  const original = await decoded(
    await request(book, `/source-occurrences/${occurrenceId}`),
    Source.SourceOccurrenceView,
  );

  const evidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic forwarded supplier original",
      mediaType: "application/json",
      origin: "Synthetic intake review",
      content: JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: {
          occurrenceId,
          sha256: original.occurrence.sha256,
          filename: original.occurrence.filename,
        },
      }),
    },
    Accounting.Evidence,
  );

  const review = await post(
    book,
    `/commerce/supplier-inbox/${occurrenceId}/review`,
    {
      draft: {
        draftKey: `intake_${key()}`,
        content: { ...setup.content, sourceEvidenceId: evidence.id },
      },
      reviewReason: "Reviewed forwarded original",
      reviewAttemptId: null,
    },
    Inbox.SupplierInboxReview,
  );

  expect(review.inbox.draftId).toBe(review.draft.id);
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "bureau-intake-review.json"),
    JSON.stringify({ received, review, before, after: await persisted(book) }, null, 2),
  );
});

// Failure contract: two conflicting requests cannot retain both before a receipt binds the key.
test("concurrent conflicting batch keys retain only one payload", async () => {
  const book = await fixture();
  const before = await persisted(book);
  const sameKey = key();
  const inputs = [batch("bulk", [file("concurrent-one")]), batch("bulk", [file("concurrent-two")])];

  const responses = await Promise.all(
    inputs.map((input) =>
      request(book, "/commerce/supplier-inbox/intake-batches", {
        method: "POST",
        headers: { "idempotency-key": sameKey },
        body: JSON.stringify(input),
      }),
    ),
  );

  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 409,
  ]);
  const winnerIndex = responses.findIndex((response) => response.status === 200);
  const winner = await decoded(responses[winnerIndex]!, Inbox.IntakeBatchResult);
  await failure(responses[1 - winnerIndex]!, 409, "IdempotencyConflict");
  expect(await send(book, inputs[winnerIndex]!, sameKey)).toEqual(winner);

  const admin = await database();

  try {
    const rows = await admin.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM openerp.intake_occurrences WHERE book_id = $1 AND source_system = 'bulk_upload'",
      [book.bookId],
    );

    expect(rows.rows[0]?.total).toBe(1);
  } finally {
    await admin.end();
  }

  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "bureau-intake-conflict.json"),
    JSON.stringify(
      {
        winner,
        winnerIndex,
        statuses: responses.map((response) => response.status),
        before,
        after: await persisted(book),
      },
      null,
      2,
    ),
  );
});

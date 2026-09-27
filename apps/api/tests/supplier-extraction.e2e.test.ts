import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import { supplierFixture } from "./support/supplier-review";
import {
  apiDirectory,
  createSession,
  database,
  decoded,
  deleteSession,
  environment,
  failure,
  key,
  post,
  request,
  run,
  type BookFixture,
} from "./support/fixtures";

const HostResult = Schema.Struct({
  ok: Schema.Boolean,
  code: Schema.optional(Accounting.FailureCode),
  value: Schema.optional(Schema.Json),
});

type HostOptions = {
  mode: "retain" | "run" | "claim" | "stop";
  scope: typeof Accounting.Scope.Type;
  requestId: string;
  store: string;
  pause: boolean;
  source?: typeof Intake.RetainSource.Type;
};

async function host(book: BookFixture, options: HostOptions) {
  const path = join(environment().scratch, `extraction-${key()}.json`);
  await writeFile(path, JSON.stringify(options));

  const result = await run("bun", ["tests/support/extraction-host.ts", path], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: book.agentToken,
    },
    timeout: 25000,
  });

  return Schema.decodeSync(Schema.fromJsonString(HostResult))(result.stdout.trim());
}

async function extractionFixture() {
  const fixture = await supplierFixture();
  const { book } = fixture;
  await createSession({ ...book, actorId: book.agentId });
  const store = join(environment().scratch, `objects-${key()}`);
  await mkdir(store);
  const scope = { entityId: book.entityId, bookId: book.bookId };
  const text = "title: Extracted title\nsupplierDocumentNumber: REVIEW-001\n";

  const sourceInput = {
    sourceSystem: "review-e2e",
    sourceAccountId: book.bookId,
    occurrenceKey: key(),
    sourceRevision: "1",
    filename: "supplier.txt",
    mediaType: "text/plain",
    contentBase64: Buffer.from(text).toString("base64"),
  } satisfies typeof Intake.RetainSource.Type;

  const retained = await host(book, {
    mode: "retain",
    scope,
    store,
    requestId: "",
    pause: false,
    source: sourceInput,
  });

  expect(retained.ok).toBe(true);
  const source = Schema.decodeUnknownSync(Intake.SourceOccurrence)(retained.value);
  await rm(join(store, "read-started"), { force: true });
  await post(
    book,
    "/commerce/supplier-inbox",
    { occurrenceId: source.id, channel: "upload", messageIdentity: null },
    Inbox.SupplierInboxView,
  );

  const original = await post(
    book,
    "/evidence",
    {
      title: "Supplier original",
      origin: "Synthetic retained source",
      mediaType: "application/json",
      content: JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: { occurrenceId: source.id, sha256: source.sha256, filename: source.filename },
      }),
    },
    Accounting.Evidence,
  );

  const reviewed = await post(
    book,
    `/commerce/supplier-inbox/${source.id}/review`,
    {
      draft: {
        draftKey: `extraction_${key()}`,
        content: { ...fixture.content, sourceEvidenceId: original.id },
      },
      reviewReason: "Retain operator-entered base",
      reviewAttemptId: null,
    },
    Inbox.SupplierInboxReview,
  );

  const path = `/commerce/supplier-inbox/${source.id}/extraction`;

  const input = {
    engineRelease: "native-text-v1",
    selectedPages: [{ page: 1, startByte: 0, endByte: Buffer.byteLength(text) }],
    dataUsePolicy: "retain_output",
  };

  const admitted = await post(book, path, input, Extraction.SupplierExtractionRequestResult);

  const options = {
    mode: "run",
    scope,
    store,
    requestId: admitted.request.id,
    pause: false,
  } satisfies HostOptions;

  return { book, source, path, input, options, reviewed };
}

test("runtime-role extraction admits, reads, reviews, cancels and replays without immutable UPDATE grants", async () => {
  const context = await extractionFixture();
  const { book, path, options } = context;
  const admin = await database();

  try {
    const grants = await admin.query<{ immutable: boolean; lifecycle: boolean }>(`select
      has_any_column_privilege('e2e_runtime', 'openerp.supplier_extraction_requests', 'UPDATE') as immutable,
      has_any_column_privilege('e2e_runtime', 'openerp.supplier_extraction_request_states', 'UPDATE') as lifecycle`);

    expect(grants.rows[0]).toEqual({ immutable: false, lifecycle: true });
    expect(await host(book, options)).toMatchObject({ ok: true, value: "completed" });
    expect(await host(book, options)).toMatchObject({ ok: true, value: "completed" });

    const state = await decoded(await request(book, path), Extraction.SupplierExtractionState);
    expect(state.attempt?.result).toBe("succeeded");
    expect(state.attempt?.fields.find((field) => field.fieldKey === "title")?.proposedValue).toBe(
      "Extracted title",
    );
    expect(state.attempt?.createdAt).not.toBe("");
    expect(state.attempt?.retainedOutputHash).toMatch(/^sha256:/);
    const attemptId = state.attempt!.attemptId;

    const prepared = await post(
      book,
      `${path}/${options.requestId}/prepare`,
      { attemptId },
      Extraction.SupplierExtractionReviewPreparation,
    );

    expect(prepared.fields.find((field) => field.fieldKey === "title")).toMatchObject({
      state: "proposed_change",
      suggestion: "Extracted title",
    });

    const committed = await post(
      book,
      `${path}/${options.requestId}/review`,
      {
        requestId: options.requestId,
        attemptId,
        expectedDraftRevision: context.reviewed.draft.revision,
        expectedDraftDigest: context.reviewed.draft.digest,
        baseContent: null,
        reason: "Accept extracted title",
        lines: [],
        fields: [
          {
            lineOrdinal: 0,
            fieldKey: "title",
            decisionKind: "accepted_suggestion",
            selectedValue: "Extracted title",
          },
        ],
      },
      Extraction.SupplierExtractionReview,
    );

    expect(committed.draft?.content.title).toBe("Extracted title");
    expect(committed.fieldDecisions).toHaveLength(1);

    const next = await post(book, path, context.input, Extraction.SupplierExtractionRequestResult);

    const cancelled = await post(
      book,
      `${path}/${next.request.id}/cancel`,
      { requestId: next.request.id },
      Extraction.SupplierExtractionCancelResult,
    );

    expect(cancelled.request.state).toBe("cancelled");
    await rm(join(options.store, "read-started"));
    expect(await host(book, { ...options, requestId: next.request.id })).toMatchObject({
      ok: true,
      value: "cancelled",
    });
    expect(existsSync(join(options.store, "read-started"))).toBe(false);

    await admin.query(
      "REVOKE UPDATE (state, cancel_version, attempts_made, updated_at) ON openerp.supplier_extraction_request_states FROM openerp_runtime",
    );
    await failure(
      await request(book, path, { method: "POST", body: JSON.stringify(context.input) }),
      422,
      "UnsupportedProfile",
    );
    await writeFile(
      join(environment().artifacts, "supplier-extraction-journey.json"),
      JSON.stringify(
        { bookId: book.bookId, grants: grants.rows[0], state, prepared, committed, cancelled },
        null,
        2,
      ),
    );
  } finally {
    await admin.query(
      "GRANT UPDATE (state, cancel_version, attempts_made, updated_at) ON openerp.supplier_extraction_request_states TO openerp_runtime",
    );
    await admin.end();
  }
});

type Revocation = "credential" | "membership" | "identity";

async function revoke(book: BookFixture, kind: Revocation, disabled: boolean) {
  const admin = await database();

  try {
    if (kind === "credential") {
      await admin.query(
        "UPDATE openerp.credentials SET revoked_at = CASE WHEN $2 THEN clock_timestamp() ELSE NULL END WHERE token_hash = $1",
        [createHash("sha256").update(book.agentToken).digest("hex"), disabled],
      );
    } else if (kind === "membership") {
      if (disabled)
        await admin.query("DELETE FROM openerp.memberships WHERE book_id = $1 AND actor_id = $2", [
          book.bookId,
          book.agentId,
        ]);
      else
        await admin.query(
          "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1,$2,'agent')",
          [book.bookId, book.agentId],
        );
    } else {
      await admin.query(
        "INSERT INTO openerp.identity_admissions(actor_id, provider_id, subject, enabled) VALUES ($1,'review-e2e',$1,$2) ON CONFLICT (actor_id) DO UPDATE SET enabled = excluded.enabled",
        [book.agentId, !disabled],
      );
    }
  } finally {
    await admin.end();
  }
}

test.each<Revocation>(["credential", "membership", "identity"])(
  "extraction rechecks %s revocation before capture and after object reading",
  async (kind) => {
    const { book, path, options } = await extractionFixture();
    const code = kind === "membership" ? "Forbidden" : "Unauthorized";
    await revoke(book, kind, true);
    expect(await host(book, options)).toMatchObject({ ok: false, code });
    expect(existsSync(join(options.store, "read-started"))).toBe(false);
    await revoke(book, kind, false);
    const running = host(book, { ...options, pause: true });

    try {
      await expect
        .poll(() => existsSync(join(options.store, "read-started")), { timeout: 10000 })
        .toBe(true);
      await revoke(book, kind, true);
    } finally {
      await writeFile(join(options.store, "release-read"), "resume");
    }

    expect(await running).toMatchObject({ ok: false, code });
    const refused = await decoded(await request(book, path), Extraction.SupplierExtractionState);
    expect(refused.attempt).toBeNull();
    expect(refused.requests[0]?.state).toBe("ready");
    expect(await host(book, { ...options, mode: "stop" })).toMatchObject({ ok: false, code });
    await revoke(book, kind, false);
    expect(await host(book, options)).toMatchObject({ ok: true, value: "completed" });
    await writeFile(
      join(environment().artifacts, `extraction-revocation-${kind}.json`),
      JSON.stringify({ bookId: book.bookId, code, refused, resumed: true }, null, 2),
    );
  },
);

test("service-intent extraction outlives requester session but cancellation and scope still fence it", async () => {
  const context = await extractionFixture();
  const { book, path, options } = context;
  const session = await createSession(book);

  const admitted = await post(
    { ...book, token: session.token },
    path,
    context.input,
    Extraction.SupplierExtractionRequestResult,
  );

  await deleteSession(session.id);
  expect(await host(book, { ...options, requestId: admitted.request.id })).toMatchObject({
    ok: true,
    value: "completed",
  });
  expect(
    await host(book, { ...options, scope: { ...options.scope, entityId: "wrong_entity" } }),
  ).toMatchObject({ ok: false, code: "Forbidden" });

  const next = await post(book, path, context.input, Extraction.SupplierExtractionRequestResult);
  await rm(join(options.store, "read-started"));
  const running = host(book, { ...options, requestId: next.request.id, pause: true });

  try {
    await expect
      .poll(() => existsSync(join(options.store, "read-started")), { timeout: 10000 })
      .toBe(true);
    await post(
      book,
      `${path}/${next.request.id}/cancel`,
      { requestId: next.request.id },
      Extraction.SupplierExtractionCancelResult,
    );
  } finally {
    await writeFile(join(options.store, "release-read"), "resume");
  }

  expect(await running).toMatchObject({ ok: true, value: "cancelled" });
  const state = await decoded(await request(book, path), Extraction.SupplierExtractionState);
  expect(state.requests[0]?.state).toBe("cancelled");
  expect(state.attempt).toBeNull();
  await writeFile(
    join(environment().artifacts, "extraction-service-intent.json"),
    JSON.stringify(
      { requesterSessionEnded: true, executorCompleted: true, cancellationDuringRead: state },
      null,
      2,
    ),
  );
});

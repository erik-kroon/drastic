import * as Examples from "@open-erp/contracts/decision-examples";
import { provenanceRows } from "./support/decision-provenance";
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
import * as Provenance from "@open-erp/contracts/decision-provenance";
import { acceptDraft, createDraft, supplierFixture } from "./support/supplier-review";
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
  mode: "retain" | "run" | "claim" | "stop" | "capture";
  suggestionId?: string;
  captureKind?: "extraction" | "extraction_value" | "bank" | "supplier" | "native";
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
      OPENERP_PREPARATION_TOKEN: options.captureKind === "native" ? book.token : book.agentToken,
    },
    timeout: 25000,
  });

  if (result.stderr)
    await writeFile(join(environment().artifacts, "extraction-host-diagnostic.txt"), result.stderr);

  return Schema.decodeSync(Schema.fromJsonString(HostResult))(result.stdout.trim());
}

async function extractionFixture(expanded = false) {
  const fixture = await supplierFixture();
  const { book } = fixture;
  await createSession({ ...book, actorId: book.agentId });
  const store = join(environment().scratch, `objects-${key()}`);
  await mkdir(store);
  const scope = { entityId: book.entityId, bookId: book.bookId };

  const text = expanded
    ? [
        "title: Supplier review journey",
        "supplierDocumentNumber: REVIEW-001",
        "documentDate: 2026-09-22",
        "supplyDate: 2026-09-22",
        "dueDate: 2026-10-22",
        "paymentTerms: 30 days",
        "sourceTotalMinor: 0.50",
        "lines:",
        ...Array.from({ length: 50 }, (_, index) => `row_${index};x;1;0.01;0.01;0;0;0;z`),
      ].join("\n")
    : "title: Extracted title\nsupplierDocumentNumber: REVIEW-001\n";

  const content = expanded
    ? {
        ...fixture.content,
        sourceTotalMinor: "50",
        lines: Array.from({ length: 50 }, (_, index) => ({
          ...fixture.content.lines[0]!,
          id: `row_${index}`,
          description: "x",
          taxDescription: "z",
          unitPriceMinor: "1",
          baseMinor: "1",
          sourceGrossMinor: "1",
        })),
      }
    : fixture.content;

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
        content: { ...content, sourceEvidenceId: original.id },
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

test("uncited extraction acceptance remains unknown while retained manual values are independent", async () => {
  const context = await extractionFixture();
  const { book, path, options } = context;
  const admin = await database();

  try {
    expect(await host(book, options)).toMatchObject({ ok: true, value: "completed" });

    const attempts = await admin.query<{ id: string }>(
      "select id from openerp.supplier_extraction_attempts where book_id = $1 and body->>'requestId' = $2 order by ordinal desc limit 1",
      [book.bookId, options.requestId],
    );

    const exposures = await admin.query<{ count: string }>(
      "select count(*) from openerp.suggestion_records where book_id = $1",
      [book.bookId],
    );

    expect(exposures.rows[0]?.count).toBe("0");

    const committed = await post(
      book,
      `${path}/${options.requestId}/review`,
      {
        requestId: options.requestId,
        attemptId: attempts.rows[0]?.id,
        expectedDraftRevision: context.reviewed.draft.revision,
        expectedDraftDigest: context.reviewed.draft.digest,
        baseContent: null,
        reason: "Synthetic acceptance without served suggestion",
        lines: [],
        fields: [
          {
            lineOrdinal: 0,
            fieldKey: "title",
            decisionKind: "accepted_suggestion",
            selectedValue: "Extracted title",
          },
          {
            lineOrdinal: 0,
            fieldKey: "supplierDocumentNumber",
            decisionKind: "retained_reviewed",
            selectedValue: context.reviewed.draft.content.supplierDocumentNumber,
          },
        ],
      },
      Extraction.SupplierExtractionReview,
    );

    const rows = await provenanceRows(book);

    expect(
      rows.find(
        (row) =>
          row.decision_id ===
          committed.fieldDecisions.find((field) => field.fieldKey === "title")?.id,
      ),
    ).toMatchObject({ classification: "unknown_exposure" });
    expect(
      rows.find(
        (row) =>
          row.decision_id ===
          committed.fieldDecisions.find((field) => field.fieldKey === "supplierDocumentNumber")?.id,
      ),
    ).toMatchObject({ classification: "independent" });
    await writeFile(
      join(environment().artifacts, "extraction-uncited-provenance.json"),
      JSON.stringify({ bookId: book.bookId, committed, rows }, null, 2),
    );
  } finally {
    await admin.end();
  }
});

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
        presentedSuggestionIds: [prepared.suggestionRecordId],
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

    const exported = await post(
      book,
      "/automation/decision-examples",
      { purpose: "training", selectedDecisionIds: [] },
      Examples.DecisionExampleExport,
    );

    expect(exported.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: committed.fieldDecisions[0]?.id,
          reason: "source_text_not_captured",
        }),
      ]),
    );

    expect(committed.fieldDecisions).toHaveLength(1);
    expect(
      (await provenanceRows(book)).filter((row) => row.decision_kind === "extraction_field"),
    ).toMatchObject([
      { classification: "accepted_unchanged", decision_id: committed.fieldDecisions[0]?.id },
    ]);

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
        {
          bookId: book.bookId,
          grants: grants.rows[0],
          state,
          prepared,
          committed,
          cancelled,
          provenance: await provenanceRows(book),
        },
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

test("bounded native extraction prepares cites commits and exports more than four hundred fields", async () => {
  const context = await extractionFixture(true);
  expect(await host(context.book, context.options)).toMatchObject({ ok: true, value: "completed" });
  const admin = await database();

  try {
    const attemptId = (
      await admin.query(
        "SELECT id FROM openerp.supplier_extraction_attempts WHERE book_id=$1 AND body->>'requestId'=$2 ORDER BY ordinal DESC LIMIT 1",
        [context.book.bookId, context.options.requestId],
      )
    ).rows[0].id;

    const preparationResponse = await request(
      context.book,
      `${context.path}/${context.options.requestId}/prepare`,
      { method: "POST", body: JSON.stringify({ attemptId }) },
    );

    const preparationBody = await preparationResponse.clone().text();
    await writeFile(
      join(environment().artifacts, "extraction-envelope-preparation.json"),
      JSON.stringify(
        {
          status: preparationResponse.status,
          body: JSON.parse(preparationBody),
          expectedFields: 457,
        },
        null,
        2,
      ),
    );

    const prepared = await decoded(
      preparationResponse,
      Extraction.SupplierExtractionReviewPreparation,
    );

    expect(prepared.fields).toHaveLength(457);

    const previewCapture = (
      await admin.query("SELECT body FROM openerp.suggestion_records WHERE book_id=$1 AND id=$2", [
        context.book.bookId,
        prepared.suggestionRecordId,
      ])
    ).rows[0].body;

    expect(
      Schema.decodeUnknownSync(Provenance.SuggestionRecord)(previewCapture).ranked.options,
    ).toHaveLength(7);

    const nativeCapture = await host(context.book, {
      ...context.options,
      mode: "capture",
      captureKind: "native",
      suggestionId: prepared.suggestionRecordId,
    });

    expect(nativeCapture.ok).toBe(true);
    const nativeSuggestionId = Schema.decodeUnknownSync(Schema.String)(nativeCapture.value);

    const suggestion = (
      await admin.query("SELECT body FROM openerp.suggestion_records WHERE book_id=$1 AND id=$2", [
        context.book.bookId,
        nativeSuggestionId,
      ])
    ).rows[0].body;

    expect(
      Schema.decodeUnknownSync(Provenance.SuggestionRecord)(suggestion).ranked.options,
    ).toHaveLength(407);

    const committed = await post(
      context.book,
      `${context.path}/${context.options.requestId}/review`,
      {
        presentedSuggestionIds: [nativeSuggestionId],
        requestId: context.options.requestId,
        attemptId,
        expectedDraftRevision: context.reviewed.draft.revision,
        expectedDraftDigest: context.reviewed.draft.digest,
        baseContent: null,
        reason: "Retain exact reviewed envelope fields",
        lines: [],
        fields: prepared.fields.map((field) => ({
          lineOrdinal: field.lineOrdinal,
          fieldKey: field.fieldKey,
          decisionKind: "retained_reviewed",
          selectedValue: field.current,
        })),
      },
      Extraction.SupplierExtractionReview,
    );

    expect(committed.fieldDecisions).toHaveLength(457);

    const exported = await post(
      context.book,
      "/automation/decision-examples",
      { purpose: "training", selectedDecisionIds: [] },
      Examples.DecisionExampleExport,
    );

    await writeFile(
      join(environment().artifacts, "extraction-envelope-completed.json"),
      JSON.stringify(
        {
          suggestionRecordId: nativeSuggestionId,
          previewOptions: 7,
          nativeOptions: 407,
          committedFields: committed.fieldDecisions.length,
          committed,
          exported,
        },
        null,
        2,
      ),
    );

    expect(exported.manifest.denominators).toEqual({
      inventory: 457,
      selected: 457,
      exported: 0,
      excluded: 457,
    });
    expect(exported.exclusions).toHaveLength(457);
    expect(exported.exclusions.every((item) => item.reason === "source_text_not_captured")).toBe(
      true,
    );
  } finally {
    await admin.end();
  }
}, 60_000);

test("suggestion variants reject invalid captures before insert and export counts malformed historical capture", async () => {
  const context = await extractionFixture();
  const admin = await database();
  const invalidCaptures = [];

  try {
    for (const captureKind of ["extraction", "extraction_value", "bank", "supplier"] as const) {
      const before = (
        await admin.query(
          "SELECT count(*)::int AS count FROM openerp.suggestion_records WHERE book_id=$1",
          [context.book.bookId],
        )
      ).rows[0].count;

      const outcome = await host(context.book, {
        ...context.options,
        mode: "capture",
        captureKind,
      });

      const after = (
        await admin.query(
          "SELECT count(*)::int AS count FROM openerp.suggestion_records WHERE book_id=$1",
          [context.book.bookId],
        )
      ).rows[0].count;

      invalidCaptures.push({ captureKind, outcome, before, after });
    }

    const f = await supplierFixture();
    const receipt = await acceptDraft(f.book, await createDraft(f.book, f.content));

    const original = (await provenanceRows(f.book)).find(
      (row) => row.decision_id === receipt.approvalId,
    )!;

    const badId = `suggestion_${key().replaceAll("-", "")}`;
    const badDecisionId = `legacy_malformed_${key().replaceAll("-", "")}`;
    const body = Schema.decodeUnknownSync(Schema.JsonObject)(original.body);

    const capture = {
      id: badId,
      actorId: f.book.actorId,
      sessionId: null,
      subject: body.subject,
      optionSetDigest: `sha256:${"0".repeat(64)}`,
      ranked: {
        source: "extraction",
        version: "extraction_merge_v1",
        options: [{ lineOrdinal: 0, fieldKey: "title", value: "x".repeat(1001) }],
      },
    };

    await admin.query(
      "INSERT INTO openerp.suggestion_records(book_id,id,actor_id,session_id,subject_identity,subject_digest,body) VALUES($1,$2,$3,null,$4,$5,$6)",
      [
        f.book.bookId,
        badId,
        f.book.actorId,
        `supplier:${receipt.draftId}`,
        `sha256:${"0".repeat(64)}`,
        capture,
      ],
    );
    await admin.query(
      "INSERT INTO openerp.decision_provenance(book_id,decision_kind,decision_id,actor_id,classification,body) VALUES($1,'supplier_approval',$2,$3,'independent',$4)",
      [f.book.bookId, badDecisionId, f.book.actorId, { ...body, presentedSuggestionIds: [badId] }],
    );

    const response = await request(f.book, "/automation/decision-examples", {
      method: "POST",
      body: JSON.stringify({ purpose: "training", selectedDecisionIds: [] }),
    });

    const responseBody = await response.clone().text();
    await writeFile(
      join(environment().artifacts, "extraction-invalid-capture.json"),
      JSON.stringify(
        {
          invalidCaptures,
          status: response.status,
          body: JSON.parse(responseBody),
          originalDecisionId: receipt.approvalId,
          badDecisionId,
        },
        null,
        2,
      ),
    );
    const exported = await decoded(response, Examples.DecisionExampleExport);
    expect(exported.examples.map((example) => example.decision.id)).toContain(receipt.approvalId);
    expect(exported.exclusions).toContainEqual({
      owner: "supplier_approval",
      id: badDecisionId,
      reason: "undecodable_capture",
    });
    expect(exported.manifest.denominators).toEqual({
      inventory: 2,
      selected: 2,
      exported: 1,
      excluded: 1,
    });

    for (const observed of invalidCaptures) {
      expect(observed.outcome.ok, observed.captureKind).toBe(false);
      expect(observed.after, observed.captureKind).toBe(observed.before);
    }
  } finally {
    await admin.end();
  }
}, 60_000);

test("extraction state GET completes while its inbox row is locked", async () => {
  const { book, source, path, options } = await extractionFixture();

  expect(await host(book, options)).toMatchObject({ ok: true, value: "completed" });

  const admin = await database();
  let observed: { status: number | null; error: string | null } = { status: null, error: null };

  try {
    await admin.query("BEGIN");
    await admin.query(
      "SELECT occurrence_id FROM openerp.supplier_inbox WHERE book_id=$1 AND occurrence_id=$2 FOR UPDATE",
      [book.bookId, source.id],
    );

    try {
      const response = await request(book, path, { signal: AbortSignal.timeout(2500) });

      observed = { status: response.status, error: null };
      await writeFile(
        join(environment().artifacts, "extraction-locked-read.json"),
        JSON.stringify({ bookId: book.bookId, occurrenceId: source.id, lockHeld: true, observed }),
      );
      const state = await decoded(response, Extraction.SupplierExtractionState);

      expect(state.attempt?.result).toBe("succeeded");
      expect(state.requests[0]?.id).toBe(options.requestId);
      expect(state.suggestionRecordId).not.toBeNull();
    } catch (error) {
      observed = { ...observed, error: error instanceof Error ? error.name : "unknown" };
      await writeFile(
        join(environment().artifacts, "extraction-locked-read.json"),
        JSON.stringify({ bookId: book.bookId, occurrenceId: source.id, lockHeld: true, observed }),
      );
      throw error;
    }
  } finally {
    await admin.query("ROLLBACK");
    await admin.end();
  }
});

test("extraction state retains diagnostics when its review basis is unavailable", async () => {
  const { book, source, path, options, reviewed } = await extractionFixture();

  expect(await host(book, options)).toMatchObject({ ok: true, value: "completed" });

  const before = await decoded(await request(book, path), Extraction.SupplierExtractionState);
  const admin = await database();

  try {
    const countBefore = await admin.query(
      "SELECT count(*)::int AS count FROM openerp.suggestion_records WHERE book_id=$1",
      [book.bookId],
    );

    await admin.query(
      "UPDATE openerp.supplier_inbox SET draft_id=null WHERE book_id=$1 AND occurrence_id=$2",
      [book.bookId, source.id],
    );

    const response = await request(book, path);
    const body = await response.clone().json();

    await writeFile(
      join(environment().artifacts, "extraction-unavailable-basis.json"),
      JSON.stringify({
        bookId: book.bookId,
        occurrenceId: source.id,
        originalDraftId: reviewed.draft.id,
        injectedDraftId: null,
        status: response.status,
        body,
        before,
      }),
    );

    const after = await decoded(response, Extraction.SupplierExtractionState);

    expect(after.suggestionRecordId).toBeNull();
    expect(after.requests).toEqual(before.requests);
    expect(after.attempt).toEqual(before.attempt);
    expect(after.fieldDecisions).toEqual(before.fieldDecisions);

    const countAfter = await admin.query(
      "SELECT count(*)::int AS count FROM openerp.suggestion_records WHERE book_id=$1",
      [book.bookId],
    );

    expect(countAfter.rows).toEqual(countBefore.rows);
    await failure(
      await request(book, `${path}/${options.requestId}/prepare`, {
        method: "POST",
        body: JSON.stringify({ attemptId: before.attempt!.attemptId }),
      }),
      409,
      "StaleDependency",
    );
  } finally {
    await admin.query(
      "UPDATE openerp.supplier_inbox SET draft_id=$3 WHERE book_id=$1 AND occurrence_id=$2",
      [book.bookId, source.id, reviewed.draft.id],
    );
    await admin.end();
  }
});

test("extraction state GET completes while its lifecycle row is locked", async () => {
  const { book, source, path, options } = await extractionFixture();

  expect(await host(book, options)).toMatchObject({ ok: true, value: "completed" });

  const admin = await database();
  let observed: { status: number | null; error: string | null } = { status: null, error: null };

  try {
    await admin.query("BEGIN");
    await admin.query(
      "SELECT request_id FROM openerp.supplier_extraction_request_states WHERE book_id=$1 AND request_id=$2 FOR UPDATE",
      [book.bookId, options.requestId],
    );

    try {
      const response = await request(book, path, { signal: AbortSignal.timeout(2500) });

      observed = { status: response.status, error: null };
      await writeFile(
        join(environment().artifacts, "extraction-lifecycle-locked-read.json"),
        JSON.stringify({ bookId: book.bookId, occurrenceId: source.id, lockHeld: true, observed }),
      );
      const state = await decoded(response, Extraction.SupplierExtractionState);

      expect(state.attempt?.result).toBe("succeeded");
      expect(state.requests[0]?.id).toBe(options.requestId);
      expect(state.suggestionRecordId).not.toBeNull();
    } catch (error) {
      observed = { ...observed, error: error instanceof Error ? error.name : "unknown" };
      await writeFile(
        join(environment().artifacts, "extraction-lifecycle-locked-read.json"),
        JSON.stringify({ bookId: book.bookId, occurrenceId: source.id, lockHeld: true, observed }),
      );
      throw error;
    }
  } finally {
    await admin.query("ROLLBACK");
    await admin.end();
  }
});

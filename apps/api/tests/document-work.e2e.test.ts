import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Source from "@open-erp/contracts/source-intake";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Workspace from "@open-erp/contracts/workspace";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { acceptDraft, createDraft, supplierFixture } from "./support/supplier-review";
import { legalFixture } from "./support/legal-commerce";
import { cashFixture } from "./support/cash-payment";
import { documentSelfHost } from "./support/document-self-host";
import * as SupplierDrafts from "@open-erp/contracts/supplier-invoice-drafts";
import {
  decoded,
  environment,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

test("document attention preserves acquisition identity and supplier handoff before acceptance", async () => {
  const { book, content } = await supplierFixture();
  const before = await persisted(book);
  const retained = [];

  for (const occurrenceKey of ["first_acquisition", "second_acquisition"]) {
    retained.push(
      await post(
        book,
        "/source-occurrences",
        {
          sourceSystem: "document_work_fixture",
          sourceAccountId: "supplier_source",
          occurrenceKey,
          sourceRevision: "1",
          filename: "supplier-invoice.txt",
          mediaType: "text/plain",
          contentBase64: Buffer.from("Synthetic supplier original").toString("base64"),
        },
        Source.SourceOccurrence,
      ),
    );
  }

  const first = retained[0];
  const second = retained[1];

  if (!first || !second) throw new Error("Two retained acquisitions are required");
  expect(first.sha256).toBe(second.sha256);
  expect(first.id).not.toBe(second.id);
  const empty = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(empty.total).toBe("0");

  for (const source of retained) {
    await post(
      book,
      "/commerce/supplier-inbox",
      {
        occurrenceId: source.id,
        channel: "upload",
        messageIdentity: null,
      },
      Inbox.SupplierInboxView,
    );
  }

  await post(
    book,
    "/commerce/supplier-inbox",
    {
      occurrenceId: first.id,
      channel: "upload",
      messageIdentity: null,
    },
    Inbox.SupplierInboxView,
  );

  const intake = await decoded(
    await request(book, "/attention?kind=document"),
    Workspace.AttentionPage,
  );

  expect(intake.total).toBe("2");
  expect(intake.items.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
  expect(
    intake.items.every(
      (item) =>
        item.reason === "document_review" && item.amountMinor === null && item.date === null,
    ),
  ).toBe(true);
  await post(
    book,
    `/commerce/supplier-inbox/${first.id}/extractions`,
    {
      parserVersion: "synthetic-failure-v1",
      status: "failed",
      suggestions: [],
      diagnostics: ["Unreadable source"],
    },
    Inbox.SupplierInboxView,
  );

  const failed = await decoded(
    await request(book, "/attention?kind=document"),
    Workspace.AttentionPage,
  );

  expect(failed.items.find((item) => item.id === first.id)?.reason).toBe("document_reading_failed");

  const assignmentResponse = await request(book, "/workspace/assignments", {
    method: "POST",
    body: JSON.stringify({
      kind: "document",
      recordId: first.id,
      assigneeId: book.actorId,
      dueOn: "2026-10-22",
      note: "Review original",
      expectedRevision: 0,
    }),
  });

  const assignment = await decoded(assignmentResponse, Workspace.AssignmentResult);
  expect(assignment.assignment.recordId).toBe(first.id);

  const saved = await post(
    book,
    "/workspace/views",
    {
      name: "Incoming originals",
      visibility: "personal",
      filters: { kind: "document", status: "open" },
    },
    Workspace.SavedViewResult,
  );

  expect(saved.view.filters.kind).toBe("document");

  const original = await post(
    book,
    "/evidence",
    {
      title: "Supplier original",
      origin: "Synthetic retained acquisition",
      mediaType: "application/json",
      content: JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: { occurrenceId: first.id, sha256: first.sha256, filename: first.filename },
      }),
    },
    Accounting.Evidence,
  );

  const reviewKey = key();

  const reviewInput = {
    draft: {
      draftKey: `document_${key()}`,
      content: { ...content, sourceEvidenceId: original.id },
    },
    reviewReason: "Reviewed the original",
    reviewAttemptId: null,
  };

  const reviewed = await Promise.all(
    [1, 2].map(async () =>
      decoded(
        await request(book, `/commerce/supplier-inbox/${first.id}/review`, {
          method: "POST",
          headers: { "idempotency-key": reviewKey },
          body: JSON.stringify(reviewInput),
        }),
        Inbox.SupplierInboxReview,
      ),
    ),
  );

  const handoff = reviewed[0];

  if (!handoff) throw new Error("Review result is required");
  expect(reviewed[1]?.draft.id).toBe(handoff.draft.id);
  const afterHandoff = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(afterHandoff.total).toBe("2");
  expect(afterHandoff.items.find((item) => item.id === handoff.draft.id)).toMatchObject({
    kind: "supplier",
    reason: "supplier_draft",
    state: "open",
  });
  expect(afterHandoff.items.some((item) => item.id === first.id)).toBe(false);

  const completed = await decoded(
    await request(book, "/attention?kind=document&status=completed"),
    Workspace.AttentionPage,
  );

  expect(completed.items.map((item) => item.id)).toEqual([first.id]);

  const acceptance = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-manual-supplier-v1",
      draftId: handoff.draft.id,
      expectedRevision: handoff.draft.revision,
      expectedDigest: handoff.draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Review the supplier draft",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const prepared = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(prepared.total).toBe("2");
  expect(prepared.items.some((item) => item.kind === "supplier")).toBe(false);
  expect(prepared.items.find((item) => item.kind === "journal")?.supplierReview).toMatchObject({
    draftId: handoff.draft.id,
    reviewId: acceptance.id,
  });

  const context = await post(
    book,
    "/workspace/context",
    { goal: "Review incoming documents", period: null },
    Workspace.BookContextView,
  );

  expect(context.snapshot.work.find((item) => item.identity === second.id)).toMatchObject({
    owner: "document",
    nextPermittedPreparation: "review_supplier_inbox",
  });

  const replacementReview = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    acceptance.input,
    Acceptance.SupplierAcceptanceReview,
  );

  const replacementContext = await post(
    book,
    "/workspace/context",
    { goal: "Review incoming documents", period: null },
    Workspace.BookContextView,
  );

  expect(
    replacementContext.snapshot.work
      .filter((item) => item.owner === "change_sets" && item.kind === "unposted_change_set")
      .map((item) => item.identity),
  ).toEqual([replacementReview.postingPlan.id]);

  const revised = await post(
    book,
    `/commerce/supplier-invoice-drafts/${handoff.draft.id}/revisions`,
    {
      expectedRevision: handoff.draft.revision,
      expectedDigest: handoff.draft.digest,
      reason: "Correct the reviewed title",
      content: { ...handoff.draft.content, title: "Corrected supplier draft" },
    },
    SupplierDrafts.SupplierInvoiceDraftRevision,
  );

  const afterRevision = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(afterRevision.total).toBe("2");
  expect(afterRevision.items.find((item) => item.id === revised.id)).toMatchObject({
    kind: "supplier",
    reason: "supplier_draft",
    title: "Corrected supplier draft",
  });
  expect(afterRevision.items.some((item) => item.kind === "journal")).toBe(false);

  const revisedContext = await post(
    book,
    "/workspace/context",
    { goal: "Review incoming documents", period: null },
    Workspace.BookContextView,
  );

  expect(
    revisedContext.snapshot.work.some(
      (item) => item.owner === "change_sets" && item.kind === "unposted_change_set",
    ),
  ).toBe(false);
  expect(revisedContext.snapshot.work.map((item) => item.identity)).not.toContain(
    acceptance.postingPlan.id,
  );
  expect(revisedContext.snapshot.work.map((item) => item.identity)).not.toContain(
    replacementReview.postingPlan.id,
  );
  expect(revisedContext.snapshot.work.find((item) => item.identity === revised.id)).toMatchObject({
    owner: "supplier",
    nextPermittedPreparation: "prepare_supplier_acceptance",
  });

  const other = await fixture();
  await failure(
    await request(other, "/workspace/assignments", {
      method: "POST",
      body: JSON.stringify({
        kind: "document",
        recordId: first.id,
        assigneeId: other.actorId,
        dueOn: null,
        note: "",
        expectedRevision: 0,
      }),
    }),
    404,
    "NotFound",
  );
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "document-work-journey.json"),
    JSON.stringify(
      { occurrences: retained, intake, failed, assignment, afterHandoff, completed, prepared },
      null,
      2,
    ),
  );
});

test("legal AR issuance completes customer draft attention through its owning receipt", async () => {
  const { book, original } = await legalFixture();

  const open = await decoded(
    await request(book, "/attention?kind=invoice"),
    Workspace.AttentionPage,
  );

  expect(open.total).toBe("0");

  const completed = await decoded(
    await request(book, "/attention?kind=invoice&status=completed"),
    Workspace.AttentionPage,
  );

  expect(completed.total).toBe("1");
  expect(completed.items[0]).toMatchObject({
    id: original.draftId,
    state: "completed",
    reason: "invoice_issued",
  });
});

test("supplier-directed retention atomically registers work and replays without a second task", async () => {
  const book = await fixture();
  const commandKey = key();

  const input = {
    sourceSystem: "directed_fixture",
    sourceAccountId: "supplier_source",
    occurrenceKey: "directed_acquisition",
    sourceRevision: "1",
    filename: "invoice.csv",
    mediaType: "text/csv",
    contentBase64: Buffer.from("description,total\nSynthetic service,100\n").toString("base64"),
    destination: "supplier_inbox",
  };

  const send = () =>
    request(book, "/source-occurrences", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    });

  const source = await decoded(await send(), Source.SourceOccurrence);
  expect(await decoded(await send(), Source.SourceOccurrence)).toEqual(source);

  const inbox = await decoded(
    await request(book, `/commerce/supplier-inbox/${source.id}`),
    Inbox.SupplierInboxView,
  );

  expect(inbox.occurrence.occurrence.id).toBe(source.id);

  const attention = await decoded(
    await request(book, "/attention?kind=document"),
    Workspace.AttentionPage,
  );

  expect(attention.total).toBe("1");
  expect(attention.items[0]?.id).toBe(source.id);
  await failure(
    await request(book, "/source-occurrences", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ ...input, destination: undefined }),
    }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request({ ...book, token: book.agentToken }, "/source-occurrences", {
      method: "POST",
      body: JSON.stringify({ ...input, occurrenceKey: "unauthorized_routing" }),
    }),
    403,
    "Forbidden",
  );

  const period = await decoded(
    await request(book, "/attention?kind=document&period=period_2026"),
    Workspace.AttentionPage,
  );

  expect(period.items[0]).toMatchObject({ id: source.id, date: null });
});

test("supplier cash adoption completes the supplier draft task without asserting posted accounting", async () => {
  const { book, draft } = await cashFixture();
  const all = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(all.items.some((item) => item.kind === "journal")).toBe(false);

  const open = await decoded(
    await request(book, "/attention?kind=supplier"),
    Workspace.AttentionPage,
  );

  expect(open.total).toBe("0");

  const completed = await decoded(
    await request(book, "/attention?kind=supplier&status=completed"),
    Workspace.AttentionPage,
  );

  expect(completed.items.find((item) => item.id === draft.id)).toMatchObject({
    reason: "supplier_accepted",
    state: "completed",
  });
});

test("external supplier retention rolls back on object failure and recovers with its original key", async () => {
  const book = await fixture();
  const directory = join(environment().scratch, "supplier-upload-objects");
  const host = await documentSelfHost("http://127.0.0.1:1", book.agentToken, directory);
  const commandKey = key();

  const input = {
    sourceSystem: "external_supplier_fixture",
    sourceAccountId: "supplier_source",
    occurrenceKey: "external_acquisition",
    sourceRevision: "1",
    filename: "supplier.txt",
    mediaType: "text/plain",
    contentBase64: Buffer.from("Synthetic external supplier original").toString("base64"),
    destination: "supplier_inbox",
  };

  const send = (body: unknown = input) =>
    fetch(`${host.origin}${book.path}/source-occurrences`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${book.token}`,
        "content-type": "application/json",
        "idempotency-key": commandKey,
      },
      body: JSON.stringify(body),
    });

  try {
    await writeFile(join(directory, "v1"), "Synthetic storage failure");
    await failure(await send(), 503, "Unavailable");

    const failed = await decoded(
      await request(book, "/attention?kind=document"),
      Workspace.AttentionPage,
    );

    expect(failed.total).toBe("0");
    await rm(join(directory, "v1"));
    const source = await decoded(await send(), Source.SourceOccurrence);
    expect(await decoded(await send(), Source.SourceOccurrence)).toEqual(source);
    await failure(await send({ ...input, destination: undefined }), 409, "IdempotencyConflict");

    const recovered = await decoded(
      await request(book, "/attention?kind=document"),
      Workspace.AttentionPage,
    );

    expect(recovered.total).toBe("1");
    expect(recovered.items[0]?.id).toBe(source.id);
    await writeFile(
      join(environment().artifacts, "supplier-upload-recovery.json"),
      JSON.stringify({ source, failed, recovered }, null, 2),
    );
  } finally {
    await host.close();
  }
});

test("posted supplier acceptance completes its draft and journal work", async () => {
  const { book, content } = await supplierFixture();
  const draft = await createDraft(book, content);
  const open = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(open.total).toBe("1");
  expect(open.items[0]).toMatchObject({ id: draft.id, kind: "supplier", reason: "supplier_draft" });
  const receipt = await acceptDraft(book, draft);
  const after = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(after.total).toBe("0");

  const completed = await decoded(
    await request(book, "/attention?status=completed"),
    Workspace.AttentionPage,
  );

  expect(completed.counts).toEqual({ open: "0", completed: "2" });
  expect(completed.items.map((item) => item.reason).sort()).toEqual([
    "journal_posted",
    "supplier_accepted",
  ]);
  await writeFile(
    join(environment().artifacts, "supplier-attention-completion.json"),
    JSON.stringify({ receipt, completed }, null, 2),
  );
});

test("document pagination survives completion of its anchor and refuses cross-book reads", async () => {
  const { book, content } = await supplierFixture();

  for (let ordinal = 0; ordinal < 52; ordinal++) {
    await post(
      book,
      "/source-occurrences",
      {
        sourceSystem: "page_fixture",
        sourceAccountId: "supplier_source",
        occurrenceKey: `page_${ordinal}`,
        sourceRevision: "1",
        filename: "page-original.csv",
        mediaType: "text/csv",
        contentBase64: Buffer.from("description,total\nSynthetic service,100\n").toString("base64"),
        destination: "supplier_inbox",
      },
      Source.SourceOccurrence,
    );
  }

  const first = await decoded(
    await request(book, "/attention?kind=document&sort=oldest"),
    Workspace.AttentionPage,
  );

  expect(first.items).toHaveLength(50);
  expect(first.total).toBe("52");
  const anchor = first.items.at(-1);

  if (!anchor || !first.next) throw new Error("The first page must have a continuation");

  const source = await decoded(
    await request(book, `/source-occurrences/${anchor.id}`),
    Source.SourceOccurrenceView,
  );

  const original = await post(
    book,
    "/evidence",
    {
      title: "Page anchor original",
      origin: "Synthetic retained acquisition",
      mediaType: "application/json",
      content: JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: {
          occurrenceId: source.occurrence.id,
          sha256: source.occurrence.sha256,
          filename: source.occurrence.filename,
        },
      }),
    },
    Accounting.Evidence,
  );

  await post(
    book,
    `/commerce/supplier-inbox/${anchor.id}/review`,
    {
      draft: { draftKey: `page_${key()}`, content: { ...content, sourceEvidenceId: original.id } },
      reviewReason: "Complete anchor review",
      reviewAttemptId: null,
    },
    Inbox.SupplierInboxReview,
  );

  const last = await decoded(
    await request(book, `/attention?kind=document&sort=oldest&after=${first.next}`),
    Workspace.AttentionPage,
  );

  expect(last.items).toHaveLength(2);
  expect(last.total).toBe("51");
  expect(last.counts).toEqual({ open: "51", completed: "1" });
  expect(last.next).toBeNull();
  expect(last.items.every((item) => !first.items.some((previous) => previous.id === item.id))).toBe(
    true,
  );
  const other = await fixture();
  const unauthorized = { ...other, path: book.path };
  await failure(await request(unauthorized, "/attention?kind=document"), 403, "Forbidden");
  await failure(
    await request(unauthorized, "/workspace/context", {
      method: "POST",
      body: JSON.stringify({ goal: "Review documents", period: null }),
    }),
    403,
    "Forbidden",
  );
  const durations: number[] = [];

  for (let trial = 0; trial < 35; trial++) {
    const start = performance.now();

    const measured = await decoded(
      await request(book, "/attention?kind=document"),
      Workspace.AttentionPage,
    );

    expect(measured.total).toBe("51");

    if (trial >= 5) durations.push(performance.now() - start);
  }

  await writeFile(
    join(environment().artifacts, "document-attention-pages.json"),
    JSON.stringify(
      {
        first,
        last,
        durationsMs: durations,
        basis:
          "52 acquired originals, one reviewed; 5 warmups and 30 measured HTTP reads; no parent baseline",
      },
      null,
      2,
    ),
  );
});

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import { legalFixture } from "./support/legal-commerce";
import { decoded, environment, failure, key, persisted, post, request } from "./support/fixtures";

const Preview = Schema.Struct({
  scope: Accounting.Scope,
  inputDigest: Accounting.Digest,
  target: Schema.Unknown,
  totals: Drafts.DraftTotals,
  blockers: Schema.Array(Drafts.DraftBlocker),
});

function inputDigest(input: Schema.JsonObject) {
  const canonical = canonicalizeJson(input);

  if (Result.isFailure(canonical)) throw canonical.failure;

  return `sha256:${createHash("sha256").update(canonical.success.bytes).digest("hex")}`;
}

function commercial(context: Awaited<ReturnType<typeof legalFixture>>) {
  const source = context.original.draftSnapshot.content;

  return {
    title: "P02 Swedish commercial calculation",
    counterpartyId: source.counterpartyId,
    counterpartyRevision: source.counterpartyRevision,
    seller: source.seller,
    customer: source.customer,
    plannedIssueDate: context.today,
    supplyDate: context.today,
    dueDate: context.today,
    paymentTerms: source.paymentTerms,
    lines: [
      {
        id: "commercial_line",
        description: "Tjugo timmar konsultarbete",
        quantity: "20",
        unitPriceMinor: "100000",
        discountMinor: "0",
        chargeMinor: "0",
        treatment: {
          kind: "legal_sales_policy",
          id: context.original.policyId,
          digest: context.original.policyDigest,
        },
      },
    ],
  };
}

test("commercial previews and revisions derive exact retained amounts and recover conflicts", async () => {
  const context = await legalFixture();
  const { author } = context;
  const input = commercial(context);

  const previewInput = {
    target: { kind: "new" },
    inputDigest: inputDigest(input),
    commercial: input,
  };

  const preview = await post(author, "/commerce/invoice-drafts/calculate", previewInput, Preview);
  expect(preview.inputDigest).toBe(previewInput.inputDigest);
  expect(preview.totals).toMatchObject({
    netMinor: "2000000",
    taxMinor: "500000",
    grossMinor: "2500000",
    sourceTotalMatches: null,
  });

  const commandKey = key();
  const create = { draftKey: `composer_${key()}`, commercial: input };

  const saved = await decoded(
    await request(author, "/commerce/invoice-drafts", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(create),
    }),
    Drafts.InvoiceDraftRevision,
  );

  expect(saved.totals).toEqual(preview.totals);
  expect(saved.calculationBasis).toBe("commercial_minor_v1");
  expect(saved.content.sourceTotalMinor).toBeNull();
  expect(saved.content.lines[0]?.sourceGrossMinor).toBeNull();
  expect(saved.content.lines[0]?.taxMinor).toBe("500000");

  const replay = await decoded(
    await request(author, "/commerce/invoice-drafts", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(create),
    }),
    Drafts.InvoiceDraftRevision,
  );

  expect(replay).toEqual(saved);
  await failure(
    await request(author, "/commerce/invoice-drafts", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ ...create, commercial: { ...input, title: "Changed key payload" } }),
    }),
    409,
    "IdempotencyConflict",
  );

  const revision = {
    expectedRevision: saved.revision,
    expectedDigest: saved.digest,
    reason: "Twenty one hours",
    commercial: { ...input, lines: input.lines.map((line) => ({ ...line, quantity: "21" })) },
  };

  const revised = await post(
    author,
    `/commerce/invoice-drafts/${saved.id}/revisions`,
    revision,
    Drafts.InvoiceDraftRevision,
  );

  expect(revised.totals.grossMinor).toBe("2625000");
  await failure(
    await request(author, `/commerce/invoice-drafts/${saved.id}/revisions`, {
      method: "POST",
      body: JSON.stringify(revision),
    }),
    409,
    "StaleDependency",
  );

  const old = await decoded(
    await request(author, `/commerce/invoice-drafts/${saved.id}?revision=1`),
    Drafts.InvoiceDraftView,
  );

  expect(old.record).toEqual(saved);
  expect(old.currentRevision).toBe("2");
  await failure(
    await request(author, "/commerce/invoice-drafts/calculate", {
      method: "POST",
      body: JSON.stringify({ ...previewInput, inputDigest: `sha256:${"0".repeat(64)}` }),
    }),
    409,
    "StaleDependency",
  );

  const unresolved = {
    ...input,
    lines: input.lines.map((line) => ({ ...line, treatment: { kind: "unresolved" } })),
  };

  const unknown = await post(
    author,
    "/commerce/invoice-drafts/calculate",
    { target: { kind: "new" }, inputDigest: inputDigest(unresolved), commercial: unresolved },
    Preview,
  );

  expect(unknown.totals.taxMinor).toBeNull();
  expect(unknown.totals.grossMinor).toBeNull();
  expect(unknown.blockers).toContainEqual({
    code: "tax_inputs_unreviewed",
    lineId: "commercial_line",
  });

  const blocked = await post(
    author,
    "/commerce/invoice-drafts",
    { draftKey: `unresolved_${key()}`, commercial: unresolved },
    Drafts.InvoiceDraftRevision,
  );

  await failure(
    await request(author, "/commerce/ar-legal-issue-reviews", {
      method: "POST",
      body: JSON.stringify(legalInput(context, blocked)),
    }),
    422,
    "UnsupportedProfile",
  );

  const before = await persisted(author);

  for (const invalid of [
    { ...input, lines: [...input.lines, ...input.lines] },
    {
      ...input,
      lines: input.lines.map((line) => ({ ...line, quantity: "0.5", unitPriceMinor: "1" })),
    },
    { ...input, lines: input.lines.map((line) => ({ ...line, discountMinor: "2000001" })) },
    {
      ...input,
      lines: input.lines.map((line) => ({
        ...line,
        unitPriceMinor: "99999999999999999999999999999999999999",
      })),
    },
  ]) {
    await failure(
      await request(author, "/commerce/invoice-drafts", {
        method: "POST",
        body: JSON.stringify({ draftKey: `invalid_${key()}`, commercial: invalid }),
      }),
      422,
      "InvalidJournal",
    );
  }

  await failure(
    await request(author, "/commerce/invoice-drafts", {
      method: "POST",
      body: JSON.stringify({
        draftKey: `totals_${key()}`,
        commercial: { ...input, sourceTotalMinor: "2500000" },
      }),
    }),
    400,
    "InvalidRequest",
  );
  expect(await persisted(author)).toEqual(before);

  const roundedInput = {
    ...input,
    lines: input.lines.flatMap((line) =>
      ["round_one", "round_two"].map((id) => ({ ...line, id, quantity: "1", unitPriceMinor: "2" })),
    ),
  };

  const rounded = await post(
    author,
    "/commerce/invoice-drafts/calculate",
    { target: { kind: "new" }, inputDigest: inputDigest(roundedInput), commercial: roundedInput },
    Preview,
  );

  expect(rounded.totals).toMatchObject({ netMinor: "4", taxMinor: "2", grossMinor: "6" });
  await writeFile(
    join(environment().artifacts, "commercial-revisions.json"),
    JSON.stringify({ preview, saved, revised, replay, unknown, rounded }, null, 2),
  );
});

function legalInput(
  context: Awaited<ReturnType<typeof legalFixture>>,
  draft: typeof Drafts.InvoiceDraftRevision.Type,
) {
  return {
    profile: "se-domestic-b2b-sek-25-accrual-v1",
    draftId: draft.id,
    expectedRevision: draft.revision,
    expectedDigest: draft.digest,
    policyId: context.original.policyId,
    policyDigest: context.original.policyDigest,
    accountingProfileId: context.profile.id,
    accountingProfileDigest: context.profile.digest,
    controlAccountId: "account_ar",
    revenueAccountId: "account_revenue",
    outputVatAccountId: "account_vat",
    accountingPeriodId: "period_2026",
    voucherSeries: "A",
    reason: "P02 synthetic legal review",
    acknowledgeLimitedProfile: true,
  };
}

test("commercial legal issue freezes its canonical draft and retained source revisions", async () => {
  const context = await legalFixture();
  const { author, reviewer } = context;
  const input = commercial(context);

  const saved = await post(
    author,
    "/commerce/invoice-drafts",
    { draftKey: `issue_${key()}`, commercial: input },
    Drafts.InvoiceDraftRevision,
  );

  const review = await post(
    author,
    "/commerce/ar-legal-issue-reviews",
    legalInput(context, saved),
    Ar.ArLegalIssueReview,
  );

  expect(review.totals).toEqual({ netMinor: "2000000", taxMinor: "500000", grossMinor: "2500000" });
  const approvalInput = { version: 1, digest: review.digest, acknowledgeLimitedProfile: true };

  const approval = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${review.id}/approvals`,
    approvalInput,
    Ar.ArLegalIssueApproval,
  );

  const issued = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${review.id}/execute`,
    { ...approvalInput, approvalId: approval.id },
    Ar.ArLegalIssueReceipt,
  );

  const view = await decoded(
    await request(author, `/commerce/invoice-drafts/${saved.id}`),
    Schema.Struct({
      record: Drafts.InvoiceDraftRevision,
      lifecycle: Schema.Struct({
        kind: Schema.Literal("issued_legal"),
        issueId: Accounting.Identifier,
        registerInvoiceId: Accounting.Identifier,
      }),
    }),
  );

  expect(view.lifecycle.issueId).toBe(issued.id);
  expect(view.lifecycle.registerInvoiceId).toBe(issued.registerInvoiceId);
  expect(view.record).toEqual(saved);
  await failure(
    await request(author, `/commerce/invoice-drafts/${saved.id}/revisions`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: saved.revision,
        expectedDigest: saved.digest,
        reason: "Must remain sealed",
        commercial: input,
      }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(author, "/commerce/ar-legal-issue-reviews", {
      method: "POST",
      body: JSON.stringify(legalInput(context, saved)),
    }),
    409,
    "AlreadyPosted",
  );

  const source = await decoded(
    await request(author, `/commerce/invoice-drafts/${context.original.draftId}`),
    Drafts.InvoiceDraftView,
  );

  expect(source.record).toEqual(context.original.draftSnapshot);
  await writeFile(
    join(environment().artifacts, "commercial-legal-journey.json"),
    JSON.stringify({ saved, review, issued, view, source }, null, 2),
  );
});

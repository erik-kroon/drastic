import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Catalog from "@open-erp/contracts/catalog";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import { legalFixture } from "./support/legal-commerce";
import { withWorkspaceBrowser } from "./support/workspace-browser";
import { decoded, environment, failure, fixture, key, post, request } from "./support/fixtures";

const Reference = Schema.Struct({ partyId: Accounting.Identifier, revision: Schema.String, digest: Accounting.Digest });
const Recipient = Schema.Struct({
  scope: Accounting.Scope, partyId: Accounting.Identifier, revision: Schema.String,
  channel: Schema.Literal("email"), destination: Schema.String,
  purposes: Schema.Array(Schema.String), status: Schema.String, digest: Accounting.Digest,
});
const Defaults = Schema.Struct({
  scope: Accounting.Scope, partyId: Accounting.Identifier, revision: Schema.String,
  terms: Schema.Struct({ kind: Schema.Literal("calendar_days_v1"), days: Schema.Int }),
  currency: Schema.String, language: Schema.String, recipient: Schema.NullOr(Reference), digest: Accounting.Digest,
});
const Applied = Schema.Struct({
  scope: Accounting.Scope, reference: Reference, invoiceDate: Schema.String,
  dueDate: Schema.String, paymentTerms: Schema.String, currency: Schema.String, language: Schema.String,
  recipient: Schema.NullOr(Reference),
});
const Article = Schema.Struct({
  ...Catalog.Article.fields, scope: Accounting.Scope, digest: Accounting.Digest,
  status: Schema.String,
  treatment: Schema.Union([Schema.Struct({ kind: Schema.Literal("unresolved") }), Schema.Struct({ kind: Schema.Literal("legal_sales_policy"), id: Accounting.Identifier, digest: Accounting.Digest })]),
});

function reference(record: typeof Defaults.Type | typeof Recipient.Type) {
  return { partyId: record.partyId, revision: record.revision, digest: record.digest };
}
function paths(partyId: string) {
  return { defaults: `/commerce/directory/${partyId}/invoice-defaults`, recipient: `/commerce/directory/${partyId}/recipient` };
}
function commercial(context: Awaited<ReturnType<typeof legalFixture>>, article: typeof Article.Type, defaults: typeof Defaults.Type) {
  const source = context.original.draftSnapshot.content;
  return {
    title: "P06 retained customer and article defaults", counterpartyId: source.counterpartyId,
    counterpartyRevision: source.counterpartyRevision, seller: source.seller, customer: source.customer,
    plannedIssueDate: "2026-10-02", supplyDate: "2026-10-02", dueDate: null, paymentTerms: null,
    customerDefaultsSelection: reference(defaults), dueDateOrigin: "customer_default",
    lines: [{ id: "default_line", description: article.description, quantity: "2", unitPriceMinor: article.unitPriceMinor,
      discountMinor: "0", chargeMinor: "0", treatment: article.treatment,
      catalogSelection: { code: article.code, revision: article.revision, unit: article.unit, scope: article.scope, digest: article.digest },
    }],
  };
}

test("reviewed customer defaults copy exact calendar terms and scoped article revisions without rewriting saved drafts", async () => {
  const context = await legalFixture();
  const { author, customer } = context;
  const route = paths(customer.id);
  const evidence = context.original.draftSnapshot.sellerEvidence;
  const recipientInput = { expectedRevision: "0", expectedDigest: null, channel: "email", destination: "billing@example.invalid",
    purposes: ["invoice_delivery", "payment_reminder"], status: "reviewed", reviewEvidence: evidence,
    reason: "P06 synthetic operator-reviewed recipient", acknowledgeReviewedRecipient: true };
  const recipientKey = key();
  const recipient = await decoded(await request(author, route.recipient, { method: "POST", headers: { "idempotency-key": recipientKey }, body: JSON.stringify(recipientInput) }), Recipient);
  expect(recipient.destination).toBe("billing@example.invalid");
  expect(await decoded(await request(author, route.recipient, { method: "POST", headers: { "idempotency-key": recipientKey }, body: JSON.stringify(recipientInput) }), Recipient)).toEqual(recipient);
  await failure(await request(author, route.recipient, { method: "POST", headers: { "idempotency-key": recipientKey }, body: JSON.stringify({ ...recipientInput, destination: "changed@example.invalid" }) }), 409, "IdempotencyConflict");
  const defaultsInput = { expectedRevision: "0", expectedDigest: null, terms: { kind: "calendar_days_v1", days: 14 }, currency: "SEK", language: "sv", recipient: reference(recipient), reviewEvidence: evidence, reason: "P06 reviewed commercial defaults" };
  const defaults = await post(author, route.defaults, defaultsInput, Defaults);
  const applyInput = { reference: reference(defaults), invoiceDate: "2026-10-02" };
  const applied = await post(author, `${route.defaults}/apply`, applyInput, Applied);
  expect(applied).toMatchObject({ dueDate: "2026-10-16", currency: "SEK", language: "sv", paymentTerms: "14 kalenderdagar", recipient: reference(recipient) });
  expect((await post(author, `${route.defaults}/apply`, { ...applyInput, invoiceDate: "2028-02-20" }, Applied)).dueDate).toBe("2028-03-05");
  const treatment = { kind: "legal_sales_policy", id: context.original.policyId, digest: context.original.policyDigest };
  const articleInput = { code: "DEFAULT_SERVICE", expectedRevision: 0, description: "Synthetic consulting hour", unit: "hour", unitPriceMinor: "100000", taxDescription: "Retained text does not determine VAT", treatment, status: "active" };
  const article = await post(author, "/commerce/articles", articleInput, Article);
  const input = commercial(context, article, defaults);
  const saved = await post(author, "/commerce/invoice-drafts", { draftKey: `defaults_${key()}`, commercial: input }, Drafts.InvoiceDraftRevision);
  expect(saved.content.dueDate).toBe("2026-10-16");
  expect(saved.content.paymentTerms).toBe("14 kalenderdagar");
  expect(saved.totals).toMatchObject({ netMinor: "200000", taxMinor: "50000", grossMinor: "250000" });
  const override = await post(author, `/commerce/invoice-drafts/${saved.id}/revisions`, { expectedRevision: saved.revision, expectedDigest: saved.digest, reason: "Explicit customer due-date override", commercial: { ...input, dueDateOrigin: "override", dueDate: "2026-10-20" } }, Drafts.InvoiceDraftRevision);
  expect(override.content.dueDate).toBe("2026-10-20");
  const updatedArticle = await post(author, "/commerce/articles", { ...articleInput, expectedRevision: 1, unitPriceMinor: "150000" }, Article);
  const updatedDefaults = await post(author, route.defaults, { ...defaultsInput, expectedRevision: defaults.revision, expectedDigest: defaults.digest, terms: { kind: "calendar_days_v1", days: 30 }, language: "en" }, Defaults);
  expect(updatedDefaults.recipient).toEqual(reference(recipient));
  await failure(await request(author, route.defaults, { method: "POST", body: JSON.stringify({ ...defaultsInput, expectedRevision: defaults.revision, expectedDigest: defaults.digest }) }), 409, "StaleDependency");
  const afterMasterEdit = await decoded(await request(author, `/commerce/invoice-drafts/${saved.id}?revision=1`), Drafts.InvoiceDraftView);
  expect(afterMasterEdit.record).toEqual(saved);
  const unrelated = await post(author, `/commerce/invoice-drafts/${saved.id}/revisions`, { expectedRevision: override.revision, expectedDigest: override.digest, reason: "Retain copied values after master edit", commercial: { ...input, title: "Unrelated title edit", dueDateOrigin: "override", dueDate: "2026-10-20" } }, Drafts.InvoiceDraftRevision);
  expect(unrelated.content.dueDate).toBe("2026-10-20");
  expect(unrelated.content.lines[0]?.unitPriceMinor).toBe("100000");
  const later = await post(author, "/commerce/invoice-drafts", { draftKey: `later_${key()}`, commercial: commercial(context, updatedArticle, updatedDefaults) }, Drafts.InvoiceDraftRevision);
  expect(later.content.dueDate).toBe("2026-11-01");
  expect(later.totals).toMatchObject({ netMinor: "300000", taxMinor: "75000", grossMinor: "375000" });
  const inventory = await decoded(await request(author, "/commerce/invoice-drafts"), Drafts.InvoiceDraftList);
  await failure(await request(author, "/commerce/invoice-drafts", { method: "POST", body: JSON.stringify({ draftKey: `stale_${key()}`, commercial: input }) }), 409, "StaleDependency");
  const outsider = await fixture();
  const foreign = await post(outsider, "/commerce/articles", { ...articleInput, treatment: { kind: "unresolved" } }, Article);
  await failure(await request(author, "/commerce/invoice-drafts", { method: "POST", body: JSON.stringify({ draftKey: `foreign_${key()}`, commercial: { ...commercial(context, updatedArticle, updatedDefaults), lines: commercial(context, updatedArticle, updatedDefaults).lines.map((line) => ({ ...line, catalogSelection: { ...line.catalogSelection, scope: foreign.scope, digest: foreign.digest } })) } }) }), 409, "StaleDependency");
  const archived = await post(author, "/commerce/articles", { ...articleInput, expectedRevision: 2, unitPriceMinor: "150000", status: "archived" }, Article);
  expect((await decoded(await request(author, "/commerce/articles"), Catalog.ArticlePage)).items.some((item) => item.code === article.code)).toBe(false);
  expect((await decoded(await request(author, `/commerce/articles/${article.code}/revisions/1`), Article)).unitPriceMinor).toBe("100000");
  await failure(await request(author, "/commerce/invoice-drafts", { method: "POST", body: JSON.stringify({ draftKey: `archived_${key()}`, commercial: commercial(context, archived, updatedDefaults) }) }), 409, "StaleDependency");
  const afterRefusal = await decoded(await request(author, "/commerce/invoice-drafts"), Drafts.InvoiceDraftList);
  expect(afterRefusal).toMatchObject({ count: inventory.count, items: inventory.items, complete: true });
  const retained = await post(author, `/commerce/invoice-drafts/${saved.id}/revisions`, { expectedRevision: unrelated.revision, expectedDigest: unrelated.digest, reason: "Retain archived selection for legal issue", commercial: { ...input, plannedIssueDate: context.today, supplyDate: context.today } }, Drafts.InvoiceDraftRevision);
  const review = await post(author, "/commerce/ar-legal-issue-reviews", { profile: "se-domestic-b2b-sek-25-accrual-v1", draftId: retained.id, expectedRevision: retained.revision, expectedDigest: retained.digest, policyId: context.original.policyId, policyDigest: context.original.policyDigest, accountingProfileId: context.profile.id, accountingProfileDigest: context.profile.digest, controlAccountId: "account_ar", revenueAccountId: "account_revenue", outputVatAccountId: "account_vat", accountingPeriodId: "period_2026", voucherSeries: "A", reason: "P06 archived copy legal admission", acknowledgeLimitedProfile: true }, Ar.ArLegalIssueReview);
  expect(review.totals.grossMinor).toBe("250000");
  const approvalInput = { version: 1, digest: review.digest, acknowledgeLimitedProfile: true };
  const approval = await post(context.reviewer, `/commerce/ar-legal-issue-reviews/${review.id}/approvals`, approvalInput, Ar.ArLegalIssueApproval);
  const issued = await post(context.reviewer, `/commerce/ar-legal-issue-reviews/${review.id}/execute`, { ...approvalInput, approvalId: approval.id }, Ar.ArLegalIssueReceipt);
  expect(issued.totals.grossMinor).toBe("250000");
  const withdrawn = await post(author, route.recipient, { ...recipientInput, expectedRevision: recipient.revision, expectedDigest: recipient.digest, status: "withdrawn" }, Recipient);
  await failure(await request(author, route.defaults, { method: "POST", body: JSON.stringify({ ...defaultsInput, expectedRevision: updatedDefaults.revision, expectedDigest: updatedDefaults.digest }) }), 409, "StaleDependency");
  expect((await decoded(await request(author, `/commerce/invoice-drafts/${saved.id}?revision=1`), Drafts.InvoiceDraftView)).record).toEqual(saved);
  await writeFile(join(environment().artifacts, "invoice-defaults-journey.json"), JSON.stringify({ recipient, defaults, applied, article, saved, override, updatedArticle, updatedDefaults, unrelated, later, archived, retained, issued, withdrawn }, null, 2));
});


test("defaults and recipient admission reject unsupported facts and preserve current revisions", async () => {
  const context = await legalFixture();
  const route = paths(context.customer.id);
  const evidence = context.original.draftSnapshot.sellerEvidence;
  const recipientInput = { expectedRevision: "0", expectedDigest: null, channel: "email", destination: "accounts@example.invalid", purposes: ["invoice_delivery"], status: "reviewed", reviewEvidence: evidence, reason: "Synthetic recipient review", acknowledgeReviewedRecipient: true };
  await failure(await request({ ...context.author, token: context.author.agentToken }, route.recipient, { method: "POST", body: JSON.stringify(recipientInput) }), 403, "Forbidden");
  await failure(await request(context.author, route.recipient, { method: "POST", body: JSON.stringify({ ...recipientInput, reviewEvidence: { evidenceId: "missing_evidence", sha256: "0".repeat(64) } }) }), 409, "MissingEvidence");
  const recipient = await post(context.author, route.recipient, recipientInput, Recipient);
  const defaultsInput = { expectedRevision: "0", expectedDigest: null, terms: { kind: "calendar_days_v1", days: 14 }, currency: "EUR", language: "en", recipient: reference(recipient), reviewEvidence: evidence, reason: "Unsupported currency" };
  await failure(await request(context.author, route.defaults, { method: "POST", body: JSON.stringify(defaultsInput) }), 422, "UnsupportedProfile");
  const defaults = await post(context.author, route.defaults, { ...defaultsInput, currency: "SEK" }, Defaults);
  const races = await Promise.all([21, 30].map(days => request(context.author, route.defaults, { method: "POST", body: JSON.stringify({ ...defaultsInput, currency: "SEK", expectedRevision: defaults.revision, expectedDigest: defaults.digest, terms: { kind: "calendar_days_v1", days } }) })));
  expect(races.map(response => response.status).sort()).toEqual([200, 409]);
  const current = await decoded(await request(context.author, route.defaults), Defaults);
  expect(current.revision).toBe("2");
  expect(current.recipient).toEqual(reference(recipient));
  const rpc = await fetch(`${environment().baseUrl}/api/mcp`, { method: "POST", headers: { authorization: `Bearer ${context.author.agentToken}`, "content-type": "application/json", accept: "application/json", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "crm_get_invoice_defaults", arguments: { scope: { entityId: context.author.entityId, bookId: context.author.bookId }, partyId: context.customer.id } } }) });
  expect(rpc.status).toBe(200);
  const result = Schema.decodeUnknownSync(Schema.Struct({ result: Schema.Struct({ isError: Schema.optional(Schema.Boolean), structuredContent: Defaults }) }))(await rpc.json());
  expect(result.result.structuredContent).toEqual(current);
  const timings: number[] = [];
  for (let sample = 0; sample < 10; sample += 1) {
    const started = performance.now();
    const applied = await post(context.author, `${route.defaults}/apply`, { reference: reference(current), invoiceDate: "2026-10-02" }, Applied);
    expect(applied.reference).toEqual(reference(current));
    timings.push(performance.now() - started);
  }
  const ordered = timings.toSorted((a, b) => a - b);
  expect(ordered[9]).toBeLessThanOrEqual(1000);
  await writeFile(join(environment().artifacts, "invoice-defaults-admission.json"), JSON.stringify({ recipient, defaults, current, races: races.map(response => response.status), timings, p95Ms: ordered[9] }, null, 2));
});

test("existing composer explicitly replaces customer defaults and retains an entered due date", async () => {
  const context = await legalFixture();
  const route = paths(context.customer.id);
  const evidence = context.original.draftSnapshot.sellerEvidence;
  const defaultsInput = { expectedRevision: "0", expectedDigest: null, terms: { kind: "calendar_days_v1", days: 14 }, currency: "SEK", language: "en", recipient: null, reviewEvidence: evidence, reason: "Synthetic browser defaults" };
  const defaults = await post(context.author, route.defaults, defaultsInput, Defaults);
  const article = await post(context.author, "/commerce/articles", { code: "BROWSER_DEFAULTS", expectedRevision: 0, description: "Browser default article", unit: "hour", unitPriceMinor: "100000", taxDescription: "25% text", status: "active", treatment: { kind: "legal_sales_policy", id: context.original.policyId, digest: context.original.policyDigest } }, Article);
  const saved = await post(context.author, "/commerce/invoice-drafts", { draftKey: `browser_defaults_${key()}`, commercial: { ...commercial(context, article, defaults), customerDefaultsSelection: undefined, dueDateOrigin: undefined, dueDate: "2026-10-20", paymentTerms: "Entered terms" } }, Drafts.InvoiceDraftRevision);
  await withWorkspaceBrowser(context.author, "invoice-defaults-editor", async (page, workspace) => {
    await page.goto(`${workspace}/sales?view=drafts&kind=draft&record=${saved.id}`);
    await page.getByRole("button", { name: "Edit draft", exact: true }).click();
    await page.getByRole("button", { name: "Apply invoice defaults", exact: true }).click();
    expect(await page.getByLabel("Due date", { exact: true }).inputValue()).toBe("2026-10-16");
    await page.getByLabel("Due date", { exact: true }).fill("2026-10-20");
    await page.getByLabel("What changed?", { exact: true }).fill("P06 explicit due-date override");
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    await page.getByRole("button", { name: "Save draft", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await decoded(await request(context.author, `/commerce/invoice-drafts/${saved.id}`), Drafts.InvoiceDraftView)).currentRevision).toBe("2");
    const first = await decoded(await request(context.author, `/commerce/invoice-drafts/${saved.id}`), Drafts.InvoiceDraftView);
    expect(first.record.content.dueDate).toBe("2026-10-20");
    expect(first.record.content.paymentTerms).toBe("14 calendar days");
    await post(context.author, route.defaults, { ...defaultsInput, expectedRevision: defaults.revision, expectedDigest: defaults.digest, terms: { kind: "calendar_days_v1", days: 30 } }, Defaults);
    await page.reload();
    await page.getByRole("button", { name: "Edit draft", exact: true }).click();
    expect(await page.getByLabel("Due date", { exact: true }).inputValue()).toBe("2026-10-20");
    await page.getByRole("button", { name: "Replace invoice defaults", exact: true }).click();
    expect(await page.getByLabel("Due date", { exact: true }).inputValue()).toBe("2026-11-01");
    await page.screenshot({ path: join(environment().artifacts, "invoice-defaults-editor-200.png"), fullPage: true });
    await writeFile(join(environment().artifacts, "invoice-defaults-editor.json"), JSON.stringify(first, null, 2));
  });
});

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { legalFixture } from "./support/legal-commerce";
import { decoded, environment, failure, fixture, key, persisted, post, request } from "./support/fixtures";

const Content = Schema.Struct({
  title: Schema.String,
  paymentTerms: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  lines: Schema.Array(Drafts.CommercialLine),
});

const Template = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  revision: Schema.String,
  digest: Accounting.Digest,
  name: Schema.String,
  currency: Schema.String,
  currencyScale: Schema.Int,
  status: Schema.Literals(["active", "archived"]),
  content: Content,
});

const Selection = Schema.Struct({ id: Accounting.Identifier, revision: Schema.String, digest: Accounting.Digest });
const Applied = Schema.Struct({
  ...Drafts.SourceInvoiceDraftRevision.fields,
  purpose: Schema.Literal("commercial"),
  calculationBasis: Schema.Literal("commercial_minor_v1"),
  commercialInput: Schema.Struct({ ...Drafts.CommercialContent.fields, note: Schema.optional(Schema.NullOr(Schema.String)) }),
  templateSelection: Selection,
});

function templateInput(context: Awaited<ReturnType<typeof legalFixture>>) {
  return {
    name: "Monthly consulting",
    currency: "SEK",
    currencyScale: 2,
    content: {
      title: "Consulting services",
      paymentTerms: "Fourteen calendar days",
      note: "Thank you for your business.",
      lines: [{
        id: "template_line",
        description: "Consulting hours",
        quantity: "2",
        unitPriceMinor: "100000",
        discountMinor: "0",
        chargeMinor: "0",
        treatment: { kind: "legal_sales_policy", id: context.original.policyId, digest: context.original.policyDigest },
      }],
    },
    reason: "Retain reusable content",
  };
}

function newTarget(context: Awaited<ReturnType<typeof legalFixture>>) {
  const source = context.original.draftSnapshot.content;

  return {
    kind: "new",
    draftKey: `template_${key()}`,
    context: {
      counterpartyId: source.counterpartyId,
      counterpartyRevision: source.counterpartyRevision,
      seller: source.seller,
      customer: source.customer,
      plannedIssueDate: context.today,
      supplyDate: context.today,
      dueDate: context.today,
    },
  };
}

const base = "/commerce/invoice-templates";

test("invoice templates copy exact content and preserve applied drafts across revisions and archive", async () => {
  const context = await legalFixture();
  const book = context.author;
  const input = templateInput(context);
  const template = await post(book, base, input, Template);
  const selection = { id: template.id, revision: template.revision, digest: template.digest };
  const apply = { revision: template.revision, digest: template.digest, target: newTarget(context), reason: "Prepare invoice from reviewed template" };
  const commandKey = key();
  const applicationPath = `${base}/${template.id}/applications`;
  const call = () => request(book, applicationPath, { method: "POST", headers: { "idempotency-key": commandKey }, body: JSON.stringify(apply) });
  const saved = await decoded(await call(), Applied);

  expect(saved.templateSelection).toEqual(selection);
  expect(saved.totals).toMatchObject({ netMinor: "200000", taxMinor: "50000", grossMinor: "250000" });
  expect(saved.commercialInput.note).toBe("Thank you for your business.");
  expect(saved.issued).toBe(false);
  expect(saved.delivered).toBe(false);
  expect(await decoded(await call(), Applied)).toEqual(saved);

  const second = await post(book, applicationPath, { ...apply, target: newTarget(context) }, Applied);
  expect(second.id).not.toBe(saved.id);
  expect(second.templateSelection).toEqual(selection);

  const revised = await post(book, `${base}/${template.id}/revisions`, {
    expectedRevision: template.revision,
    expectedDigest: template.digest,
    name: "Monthly consulting revised",
    content: { ...input.content, lines: input.content.lines.map(line => ({ ...line, unitPriceMinor: "150000" })) },
    reason: "Revise future default price",
  }, Template);
  expect(revised.revision).toBe("2");
  expect((await decoded(await request(book, `/commerce/invoice-drafts/${saved.id}`), Drafts.InvoiceDraftView)).record.digest).toBe(saved.digest);
  await failure(await request(book, applicationPath, { method: "POST", body: JSON.stringify({ ...apply, target: newTarget(context) }) }), 409, "StaleDependency");

  const third = await post(book, applicationPath, { ...apply, revision: revised.revision, digest: revised.digest, target: newTarget(context) }, Applied);
  expect(third.totals.grossMinor).toBe("375000");
  const archived = await post(book, `${base}/${template.id}/archive`, {
    expectedRevision: revised.revision,
    expectedDigest: revised.digest,
    reason: "Retire this reusable content",
  }, Template);
  expect(archived.status).toBe("archived");
  expect(await decoded(await call(), Applied)).toEqual(saved);
  await failure(await request(book, applicationPath, { method: "POST", body: JSON.stringify({ ...apply, revision: archived.revision, digest: archived.digest, target: newTarget(context) }) }), 422, "UnsupportedProfile");
  const list = await decoded(await request(book, base), Schema.Struct({ items: Schema.Array(Template), next: Schema.NullOr(Schema.String) }));
  expect(list.items.some(item => item.id === template.id)).toBe(false);
  const historical = await decoded(await request(book, `${base}/${template.id}?revision=1`), Template);
  expect(historical).toEqual(template);
  await failure(await request(book, applicationPath, { method: "POST", headers: { "idempotency-key": commandKey }, body: JSON.stringify({ ...apply, reason: "Changed request under existing key" }) }), 409, "IdempotencyConflict");

  await writeFile(join(environment().artifacts, "invoice-template-history.json"), JSON.stringify({ template, revised, archived, saved, second, third, historical }, null, 2));
});

test("template replacement requires explicit authority and leaves refused drafts unchanged", async () => {
  const context = await legalFixture();
  const book = context.author;
  const template = await post(book, base, templateInput(context), Template);
  const apply = { revision: template.revision, digest: template.digest, target: newTarget(context), reason: "Create target draft" };
  const path = `${base}/${template.id}/applications`;
  const saved = await post(book, path, apply, Applied);
  const replacement = { ...apply, target: { kind: "existing", id: saved.id, expectedRevision: saved.revision, expectedDigest: saved.digest, acknowledgeReplace: true } };
  const before = await persisted(book);

  await failure(await request(book, path, { method: "POST", body: JSON.stringify({ ...replacement, target: { ...replacement.target, acknowledgeReplace: false } }) }), 400, "InvalidRequest");
  const replaced = await post(book, path, replacement, Applied);
  expect(replaced.revision).toBe("2");
  expect(replaced.commercialInput.customer).toEqual(saved.commercialInput.customer);
  expect(replaced.commercialInput.plannedIssueDate).toBe(saved.commercialInput.plannedIssueDate);
  await failure(await request(book, path, { method: "POST", body: JSON.stringify(replacement) }), 409, "StaleDependency");
  expect(await persisted(book)).toEqual(before);

  const foreign = await fixture();
  await failure(await request(foreign, `${base}/${template.id}`), 404, "NotFound");
  await failure(await request(foreign, path, { method: "POST", body: JSON.stringify(apply) }), 404, "NotFound");
  await failure(await request({ ...book, token: book.agentToken }, base, { method: "POST", body: JSON.stringify(templateInput(context)) }), 403, "Forbidden");
  await failure(await request(book, base, { method: "POST", body: JSON.stringify({ ...templateInput(context), currency: "EUR" }) }), 422, "UnsupportedProfile");
  const sealed = context.original.draftSnapshot;
  await failure(await request(book, path, { method: "POST", body: JSON.stringify({ ...replacement, target: { ...replacement.target, id: sealed.id, expectedRevision: sealed.revision, expectedDigest: sealed.digest } }) }), 403, "Forbidden");
  const unchanged = await decoded(await request(book, `/commerce/invoice-drafts/${sealed.id}`), Drafts.InvoiceDraftView);
  expect(unchanged.record).toEqual(sealed);
  await writeFile(join(environment().artifacts, "invoice-template-replacement.json"), JSON.stringify({ template, saved, replaced, sealed: unchanged.record, refusedLedgerUnchanged: true }, null, 2));
});

test("unresolved template treatment stays explicit on the normal draft owner", async () => {
  const context = await legalFixture();
  const input = templateInput(context);
  const template = await post(context.author, base, { ...input, content: { ...input.content, lines: input.content.lines.map(line => ({ ...line, treatment: { kind: "unresolved" } })) } }, Template);
  const saved = await post(context.author, `${base}/${template.id}/applications`, { revision: template.revision, digest: template.digest, target: newTarget(context), reason: "Review unresolved treatment" }, Applied);
  expect(saved.totals.taxMinor).toBeNull();
  expect(saved.totals.grossMinor).toBeNull();
  expect(saved.blockers).toContainEqual({ code: "tax_inputs_unreviewed", lineId: "template_line" });
});

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import { readPdf } from "./support/pdf";
import { withWorkspaceBrowser } from "./support/workspace-browser";
import { legalFixture } from "./support/legal-commerce";
import {
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

const Selection = Schema.Struct({
  id: Accounting.Identifier,
  revision: Schema.String,
  digest: Accounting.Digest,
});

const Applied = Schema.Struct({
  ...Drafts.SourceInvoiceDraftRevision.fields,
  purpose: Schema.Literal("commercial"),
  calculationBasis: Schema.Literal("commercial_minor_v1"),
  commercialInput: Schema.Struct({
    ...Drafts.CommercialContent.fields,
    note: Schema.optional(Schema.NullOr(Schema.String)),
  }),
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
      lines: [
        {
          id: "template_line",
          description: "Consulting hours",
          quantity: "2",
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

  const apply = {
    revision: template.revision,
    digest: template.digest,
    target: newTarget(context),
    reason: "Prepare invoice from reviewed template",
  };

  const commandKey = key();
  const applicationPath = `${base}/${template.id}/applications`;

  const call = () =>
    request(book, applicationPath, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(apply),
    });

  const saved = await decoded(await call(), Applied);

  expect(saved.templateSelection).toEqual(selection);
  expect(saved.totals).toMatchObject({
    netMinor: "200000",
    taxMinor: "50000",
    grossMinor: "250000",
  });
  expect(saved.commercialInput.note).toBe("Thank you for your business.");
  expect(saved.issued).toBe(false);
  expect(saved.delivered).toBe(false);
  expect(await decoded(await call(), Applied)).toEqual(saved);

  const second = await post(
    book,
    applicationPath,
    { ...apply, target: newTarget(context) },
    Applied,
  );

  expect(second.id).not.toBe(saved.id);
  expect(second.templateSelection).toEqual(selection);

  const revised = await post(
    book,
    `${base}/${template.id}/revisions`,
    {
      expectedRevision: template.revision,
      expectedDigest: template.digest,
      name: "Monthly consulting revised",
      content: {
        ...input.content,
        lines: input.content.lines.map((line) => ({ ...line, unitPriceMinor: "150000" })),
      },
      reason: "Revise future default price",
    },
    Template,
  );

  expect(revised.revision).toBe("2");
  expect(
    (
      await decoded(
        await request(book, `/commerce/invoice-drafts/${saved.id}`),
        Drafts.InvoiceDraftView,
      )
    ).record.digest,
  ).toBe(saved.digest);
  await failure(
    await request(book, applicationPath, {
      method: "POST",
      body: JSON.stringify({ ...apply, target: newTarget(context) }),
    }),
    409,
    "StaleDependency",
  );

  const third = await post(
    book,
    applicationPath,
    { ...apply, revision: revised.revision, digest: revised.digest, target: newTarget(context) },
    Applied,
  );

  expect(third.totals.grossMinor).toBe("375000");

  const archived = await post(
    book,
    `${base}/${template.id}/archive`,
    {
      expectedRevision: revised.revision,
      expectedDigest: revised.digest,
      reason: "Retire this reusable content",
    },
    Template,
  );

  expect(archived.status).toBe("archived");
  expect(await decoded(await call(), Applied)).toEqual(saved);
  await failure(
    await request(book, applicationPath, {
      method: "POST",
      body: JSON.stringify({
        ...apply,
        revision: archived.revision,
        digest: archived.digest,
        target: newTarget(context),
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  const list = await decoded(
    await request(book, base),
    Schema.Struct({ items: Schema.Array(Template), next: Schema.NullOr(Schema.String) }),
  );

  expect(list.items.some((item) => item.id === template.id)).toBe(false);

  const historical = await decoded(
    await request(book, `${base}/${template.id}?revision=1`),
    Template,
  );

  expect(historical).toEqual(template);
  await failure(
    await request(book, applicationPath, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ ...apply, reason: "Changed request under existing key" }),
    }),
    409,
    "IdempotencyConflict",
  );

  await writeFile(
    join(environment().artifacts, "invoice-template-history.json"),
    JSON.stringify({ template, revised, archived, saved, second, third, historical }, null, 2),
  );
});

test("template replacement requires explicit authority and leaves refused drafts unchanged", async () => {
  const context = await legalFixture();
  const book = context.author;
  const template = await post(book, base, templateInput(context), Template);

  const apply = {
    revision: template.revision,
    digest: template.digest,
    target: newTarget(context),
    reason: "Create target draft",
  };

  const path = `${base}/${template.id}/applications`;
  const saved = await post(book, path, apply, Applied);

  const replacement = {
    ...apply,
    target: {
      kind: "existing",
      id: saved.id,
      expectedRevision: saved.revision,
      expectedDigest: saved.digest,
      acknowledgeReplace: true,
    },
  };

  const before = await persisted(book);

  await failure(
    await request(book, path, {
      method: "POST",
      body: JSON.stringify({
        ...replacement,
        target: { ...replacement.target, acknowledgeReplace: false },
      }),
    }),
    400,
    "InvalidRequest",
  );
  const replaced = await post(book, path, replacement, Applied);
  expect(replaced.revision).toBe("2");
  expect(replaced.commercialInput.customer).toEqual(saved.commercialInput.customer);
  expect(replaced.commercialInput.plannedIssueDate).toBe(saved.commercialInput.plannedIssueDate);
  await failure(
    await request(book, path, { method: "POST", body: JSON.stringify(replacement) }),
    409,
    "StaleDependency",
  );
  expect(await persisted(book)).toEqual(before);

  const foreign = await fixture();
  await failure(await request(foreign, `${base}/${template.id}`), 404, "NotFound");
  await failure(
    await request(foreign, path, { method: "POST", body: JSON.stringify(apply) }),
    404,
    "NotFound",
  );
  await failure(
    await request({ ...book, token: book.agentToken }, base, {
      method: "POST",
      body: JSON.stringify(templateInput(context)),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(book, base, {
      method: "POST",
      body: JSON.stringify({ ...templateInput(context), currency: "EUR" }),
    }),
    422,
    "UnsupportedProfile",
  );
  const sealed = context.original.draftSnapshot;
  await failure(
    await request(book, path, {
      method: "POST",
      body: JSON.stringify({
        ...replacement,
        target: {
          ...replacement.target,
          id: sealed.id,
          expectedRevision: sealed.revision,
          expectedDigest: sealed.digest,
        },
      }),
    }),
    403,
    "Forbidden",
  );

  const unchanged = await decoded(
    await request(book, `/commerce/invoice-drafts/${sealed.id}`),
    Drafts.InvoiceDraftView,
  );

  expect(unchanged.record).toEqual(sealed);
  await writeFile(
    join(environment().artifacts, "invoice-template-replacement.json"),
    JSON.stringify(
      { template, saved, replaced, sealed: unchanged.record, refusedLedgerUnchanged: true },
      null,
      2,
    ),
  );
});

test("unresolved template treatment stays explicit on the normal draft owner", async () => {
  const context = await legalFixture();
  const input = templateInput(context);

  const template = await post(
    context.author,
    base,
    {
      ...input,
      content: {
        ...input.content,
        lines: input.content.lines.map((line) => ({ ...line, treatment: { kind: "unresolved" } })),
      },
    },
    Template,
  );

  const saved = await post(
    context.author,
    `${base}/${template.id}/applications`,
    {
      revision: template.revision,
      digest: template.digest,
      target: newTarget(context),
      reason: "Review unresolved treatment",
    },
    Applied,
  );

  expect(saved.totals.taxMinor).toBeNull();
  expect(saved.totals.grossMinor).toBeNull();
  expect(saved.blockers).toContainEqual({ code: "tax_inputs_unreviewed", lineId: "template_line" });
});

test("saved invoice composer saves, applies and explicitly replaces template content", async () => {
  const context = await legalFixture();
  const originalTemplate = await post(context.author, base, templateInput(context), Template);

  const saved = await post(
    context.author,
    `${base}/${originalTemplate.id}/applications`,
    {
      revision: originalTemplate.revision,
      digest: originalTemplate.digest,
      target: newTarget(context),
      reason: "Open a saved composer",
    },
    Applied,
  );

  const actor = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
      [context.author.bookId, actor.actorId],
    );
  } finally {
    await admin.end();
  }

  await withWorkspaceBrowser(
    { ...context.author, actorId: actor.actorId },
    "invoice-templates",
    async (page, workspace) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(`${workspace}/sales?view=drafts&kind=draft&record=${saved.id}`);
      await page.getByRole("button", { name: "Save as template", exact: true }).click();
      await page.getByLabel("Template name", { exact: true }).fill("Browser reusable invoice");
      await page.getByRole("button", { name: "Save template", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect
        .poll(() =>
          page.getByRole("dialog", { name: "Save invoice template", exact: true }).count(),
        )
        .toBe(0);

      const list = await decoded(
        await request(context.author, base),
        Schema.Struct({ items: Schema.Array(Template) }),
      );

      const selected = list.items.find((item) => item.name === "Browser reusable invoice");

      if (selected === undefined) throw new Error("Saved template missing from public list");
      await page.getByRole("button", { name: "Invoice templates", exact: true }).click();
      await page.getByRole("combobox", { name: "Template", exact: true }).click();
      await page
        .getByRole("option", {
          name: `${selected.name} · ${selected.currency} · ${selected.revision}`,
          exact: true,
        })
        .click();
      await page.getByLabel("Invoice date", { exact: true }).fill(context.today);
      await page.getByLabel("Supply date", { exact: true }).fill(context.today);
      await page.getByLabel("Due date", { exact: true }).fill(context.today);
      await page.getByRole("button", { name: "New draft from template", exact: true }).click();
      await expect
        .poll(() => {
          const selectedRecord = new URL(page.url()).searchParams.get("record");

          return selectedRecord !== null && selectedRecord !== saved.id;
        })
        .toBe(true);
      const id = new URL(page.url()).searchParams.get("record");

      if (id === null) throw new Error("Created draft has no owning route");

      const created = await decoded(
        await request(context.author, `/commerce/invoice-drafts/${id}`),
        Drafts.InvoiceDraftView,
      );

      expect(created.record.templateSelection).toEqual({
        id: selected.id,
        revision: selected.revision,
        digest: selected.digest,
      });
      await page.getByRole("button", { name: "Invoice templates", exact: true }).click();
      await page.getByRole("combobox", { name: "Template", exact: true }).click();
      await page
        .getByRole("option", {
          name: `${selected.name} · ${selected.currency} · ${selected.revision}`,
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: "Replace saved draft content…", exact: true }).click();
      expect(
        (
          await decoded(
            await request(context.author, `/commerce/invoice-drafts/${id}`),
            Drafts.InvoiceDraftView,
          )
        ).currentRevision,
      ).toBe("1");
      await page.getByRole("button", { name: "Confirm replacement", exact: true }).click();
      await expect
        .poll(
          async () =>
            (
              await decoded(
                await request(context.author, `/commerce/invoice-drafts/${id}`),
                Drafts.InvoiceDraftView,
              )
            ).currentRevision,
        )
        .toBe("2");
      await page.getByRole("button", { name: "Edit draft", exact: true }).click();
      await page
        .getByLabel("Customer-facing note", { exact: true })
        .fill("A retained customer note after application.");
      await page.getByLabel("What changed?", { exact: true }).fill("Update the customer note");
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect
        .poll(
          async () =>
            (
              await decoded(
                await request(context.author, `/commerce/invoice-drafts/${id}`),
                Drafts.InvoiceDraftView,
              )
            ).currentRevision,
        )
        .toBe("3");

      const edited = await decoded(
        await request(context.author, `/commerce/invoice-drafts/${id}`),
        Drafts.InvoiceDraftView,
      );

      expect(edited.record.content.note).toBe("A retained customer note after application.");
      expect(edited.record.templateSelection).toEqual(created.record.templateSelection);
      await page
        .getByText("A retained customer note after application.", { exact: true })
        .first()
        .waitFor();
      await page.screenshot({
        path: join(environment().artifacts, "invoice-template-composer.png"),
      });
      await writeFile(
        join(environment().artifacts, "invoice-template-composer.json"),
        JSON.stringify(
          {
            savedTemplate: selected,
            created: created.record,
            edited: edited.record,
            explicitReplacement: true,
            finalUrl: page.url(),
          },
          null,
          2,
        ),
      );
    },
  );
}, 120000);

test("template automation can prepare a new draft through its classified MCP capability", async () => {
  const context = await legalFixture();
  const template = await post(context.author, base, templateInput(context), Template);

  const headers = {
    authorization: `Bearer ${context.book.agentToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "MCP-Protocol-Version": "2025-11-25",
  };

  const url = `${environment().baseUrl}/api/mcp`;

  const catalogResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

  expect(catalogResponse.status).toBe(200);

  const catalog = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )(await catalogResponse.json());

  expect(catalog.result.tools.map((tool) => tool.name)).toContain("invoice_templates_apply");

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "invoice_templates_apply",
        arguments: {
          scope: { entityId: context.book.entityId, bookId: context.book.bookId },
          id: template.id,
          idempotencyKey: key(),
          input: {
            revision: template.revision,
            digest: template.digest,
            target: newTarget(context),
            reason: "Prepare a reviewable draft",
          },
        },
      },
    }),
  });

  expect(response.status).toBe(200);

  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ structuredContent: Schema.Struct({ result: Applied }) }),
    }),
  )(await response.json());

  expect(result.result.structuredContent.result.issued).toBe(false);
  expect(result.result.structuredContent.result.delivered).toBe(false);
  expect(result.result.structuredContent.result.totals.grossMinor).toBe("250000");
});

test("template automation cannot replace an operator's saved draft through HTTP", async () => {
  const context = await legalFixture();
  const template = await post(context.author, base, templateInput(context), Template);
  const path = `${base}/${template.id}/applications`;

  const saved = await post(
    context.author,
    path,
    {
      revision: template.revision,
      digest: template.digest,
      target: newTarget(context),
      reason: "Operator's selected draft",
    },
    Applied,
  );

  await failure(
    await request({ ...context.book, token: context.book.agentToken }, path, {
      method: "POST",
      body: JSON.stringify({
        revision: template.revision,
        digest: template.digest,
        target: {
          kind: "existing",
          id: saved.id,
          expectedRevision: saved.revision,
          expectedDigest: saved.digest,
          acknowledgeReplace: true,
        },
        reason: "Unauthorized replacement attempt",
      }),
    }),
    403,
    "Forbidden",
  );

  const retained = await decoded(
    await request(context.author, `/commerce/invoice-drafts/${saved.id}`),
    Drafts.InvoiceDraftView,
  );

  expect(retained.currentRevision).toBe("1");
  expect(retained.record.digest).toBe(saved.digest);
});

test("template customer note is retained in the issued PDF after the template changes", async () => {
  const context = await legalFixture();
  const input = templateInput(context);
  const template = await post(context.author, base, input, Template);

  const draft = await post(
    context.author,
    `${base}/${template.id}/applications`,
    {
      revision: template.revision,
      digest: template.digest,
      target: newTarget(context),
      reason: "Prepare a customer invoice",
    },
    Applied,
  );

  const review = await post(
    context.author,
    "/commerce/ar-legal-issue-reviews",
    {
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
      reason: "Review the retained template note",
      acknowledgeLimitedProfile: true,
    },
    Ar.ArLegalIssueReview,
  );

  const approvalInput = { version: 1, digest: review.digest, acknowledgeLimitedProfile: true };

  const approval = await post(
    context.reviewer,
    `/commerce/ar-legal-issue-reviews/${review.id}/approvals`,
    approvalInput,
    Ar.ArLegalIssueApproval,
  );

  const issue = await post(
    context.reviewer,
    `/commerce/ar-legal-issue-reviews/${review.id}/execute`,
    { ...approvalInput, approvalId: approval.id },
    Ar.ArLegalIssueReceipt,
  );

  await post(
    context.author,
    `${base}/${template.id}/revisions`,
    {
      expectedRevision: template.revision,
      expectedDigest: template.digest,
      name: template.name,
      content: { ...input.content, note: "Changed for future invoices only." },
      reason: "Revise reusable content after issue",
    },
    Template,
  );

  const document = await post(
    context.author,
    "/commerce/legal-invoice-pdfs",
    {
      issueId: issue.id,
      issueDigest: issue.digest,
      rendererVersion: "openerp-se-invoice-pdfcn-v1",
    },
    Pdf.LegalInvoicePdfView,
  );

  if (document.artifact === null)
    throw new Error("Invoice note proof requires the actual retained PDF artifact");

  const pages = await readPdf(
    Buffer.from(document.artifact.contentBase64, "base64"),
    "invoice-template-retained-note",
  );

  const text = pages.map((page) => page.text).join(" ");
  expect(text).toContain("Thank you for your business.");
  expect(text).not.toContain("Changed for future invoices only.");
  expect(text).toContain(issue.legalDocumentNumber);
  expect(document.artifact.delivered).toBe(false);
  await writeFile(
    join(environment().artifacts, "invoice-template-retained-note.json"),
    JSON.stringify(
      {
        template,
        draftId: draft.id,
        issueId: issue.id,
        artifactSha256: document.artifact.sha256,
        renderedText: text,
      },
      null,
      2,
    ),
  );
});

test("template article selections require current admission for new drafts and preserve existing copies", async () => {
  const context = await legalFixture();
  const input = templateInput(context);

  const articleSchema = Schema.Struct({
    code: Schema.String,
    revision: Schema.Int,
    digest: Accounting.Digest,
    scope: Accounting.Scope,
    unit: Schema.String,
    unitPriceMinor: Schema.String,
  });

  const articleInput = {
    code: "TEMPLATE_SERVICE",
    expectedRevision: 0,
    description: "Template consulting hour",
    unit: "hour",
    unitPriceMinor: "100000",
    taxDescription: "Policy supplies tax treatment",
    treatment: input.content.lines[0]?.treatment,
    status: "active",
  };

  const article = await post(context.author, "/commerce/articles", articleInput, articleSchema);

  const selection = {
    code: article.code,
    revision: article.revision,
    digest: article.digest,
    scope: article.scope,
    unit: article.unit,
  };

  const template = await post(
    context.author,
    base,
    {
      ...input,
      content: {
        ...input.content,
        lines: input.content.lines.map((line) => ({ ...line, catalogSelection: selection })),
      },
    },
    Template,
  );

  const applicationPath = `${base}/${template.id}/applications`;

  const apply = {
    revision: template.revision,
    digest: template.digest,
    target: newTarget(context),
    reason: "Copy a currently qualified article",
  };

  const commandKey = key();

  const saved = await decoded(
    await request(context.author, applicationPath, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(apply),
    }),
    Applied,
  );

  expect(saved.totals.grossMinor).toBe("250000");

  const changed = await post(
    context.author,
    "/commerce/articles",
    {
      ...articleInput,
      expectedRevision: article.revision,
      unitPriceMinor: "150000",
    },
    articleSchema,
  );

  const refuseNew = () =>
    request(context.author, applicationPath, {
      method: "POST",
      body: JSON.stringify({ ...apply, target: newTarget(context) }),
    });

  await failure(await refuseNew(), 409, "StaleDependency");
  await post(
    context.author,
    "/commerce/articles",
    {
      ...articleInput,
      expectedRevision: changed.revision,
      unitPriceMinor: "150000",
      status: "archived",
    },
    articleSchema,
  );
  await failure(await refuseNew(), 409, "StaleDependency");
  expect(
    await decoded(
      await request(context.author, applicationPath, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(apply),
      }),
      Applied,
    ),
  ).toEqual(saved);

  const replaced = await post(
    context.author,
    applicationPath,
    {
      ...apply,
      target: {
        kind: "existing",
        id: saved.id,
        expectedRevision: saved.revision,
        expectedDigest: saved.digest,
        acknowledgeReplace: true,
      },
      reason: "Preserve the actual target's retained article copy",
    },
    Applied,
  );

  expect(replaced.revision).toBe("2");
  expect(replaced.totals.grossMinor).toBe("250000");
  expect(replaced.commercialInput.note).toBe("Thank you for your business.");
  expect(replaced.commercialInput.lines[0]?.catalogSelection).toEqual(selection);

  const retained = await decoded(
    await request(context.author, `/commerce/invoice-drafts/${saved.id}?revision=1`),
    Drafts.InvoiceDraftView,
  );

  expect(retained.record.digest).toBe(saved.digest);
  await writeFile(
    join(environment().artifacts, "invoice-template-article-admission.json"),
    JSON.stringify(
      { template, saved, replaced, staleNewDraftRefused: true, archivedNewDraftRefused: true },
      null,
      2,
    ),
  );
});

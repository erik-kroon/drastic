import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./invoice-drafts";
import { accountingErrors } from "./accounting-errors";

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const TemplateContent = Schema.Struct({
  title: Drafts.CommercialContent.fields.title,
  paymentTerms: Drafts.CommercialContent.fields.paymentTerms,
  note: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000))),
  lines: Drafts.CommercialContent.fields.lines,
});

export const InvoiceTemplateRevision = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  revision: Commerce.Version,
  digest: Accounting.Digest,
  name: Name,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  status: Schema.Literals(["active", "archived"]),
  content: TemplateContent,
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
  reason: Accounting.Description,
});

export const CreateInvoiceTemplate = Schema.Struct({
  name: Name,
  currency: InvoiceTemplateRevision.fields.currency,
  currencyScale: InvoiceTemplateRevision.fields.currencyScale,
  content: TemplateContent,
  reason: Accounting.Description,
});

export const ArchiveInvoiceTemplate = Schema.Struct({
  expectedRevision: Commerce.Version,
  expectedDigest: Accounting.Digest,
  reason: Accounting.Description,
});

export const ReviseInvoiceTemplate = Schema.Struct({
  ...ArchiveInvoiceTemplate.fields,
  name: Name,
  content: TemplateContent,
});

export const InvoiceTemplateContext = Schema.Struct({
  counterpartyId: Drafts.CommercialContent.fields.counterpartyId,
  counterpartyRevision: Drafts.CommercialContent.fields.counterpartyRevision,
  seller: Drafts.CommercialContent.fields.seller,
  customer: Drafts.CommercialContent.fields.customer,
  plannedIssueDate: Drafts.CommercialContent.fields.plannedIssueDate,
  supplyDate: Drafts.CommercialContent.fields.supplyDate,
  dueDate: Drafts.CommercialContent.fields.dueDate,
});

export const ApplyInvoiceTemplate = Schema.Struct({
  revision: Commerce.Version,
  digest: Accounting.Digest,
  target: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("new"),
      draftKey: Accounting.Identifier,
      context: InvoiceTemplateContext,
    }),
    Schema.Struct({
      kind: Schema.Literal("existing"),
      id: Accounting.Identifier,
      expectedRevision: Commerce.Version,
      expectedDigest: Accounting.Digest,
      acknowledgeReplace: Schema.Literal(true),
    }),
  ]),
  reason: Accounting.Description,
});

export const InvoiceTemplatePage = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(InvoiceTemplateRevision),
  next: Schema.NullOr(Accounting.Identifier),
});

export const TemplateQuery = Schema.Struct({ after: Schema.optional(Accounting.Identifier) });

export const TemplateReadQuery = Schema.Struct({ revision: Schema.optional(Commerce.Version) });

const TemplatePath = Schema.Struct({ ...Accounting.Scope.fields, id: Accounting.Identifier });

const path = "/v1/entities/:entityId/books/:bookId/commerce/invoice-templates";

export const InvoiceTemplatesApi = HttpApiGroup.make("invoiceTemplates")
  .add(
    HttpApiEndpoint.get("listInvoiceTemplates", path, {
      params: Accounting.Scope,
      query: TemplateQuery,
      success: InvoiceTemplatePage,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getInvoiceTemplate", `${path}/:id`, {
      params: TemplatePath,
      query: TemplateReadQuery,
      success: InvoiceTemplateRevision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createInvoiceTemplate", path, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: CreateInvoiceTemplate,
      success: InvoiceTemplateRevision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reviseInvoiceTemplate", `${path}/:id/revisions`, {
      params: TemplatePath,
      headers: Accounting.IdempotencyHeaders,
      payload: ReviseInvoiceTemplate,
      success: InvoiceTemplateRevision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("archiveInvoiceTemplate", `${path}/:id/archive`, {
      params: TemplatePath,
      headers: Accounting.IdempotencyHeaders,
      payload: ArchiveInvoiceTemplate,
      success: InvoiceTemplateRevision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("applyInvoiceTemplate", `${path}/:id/applications`, {
      params: TemplatePath,
      headers: Accounting.IdempotencyHeaders,
      payload: ApplyInvoiceTemplate,
      success: Drafts.InvoiceDraftRevision,
      error: accountingErrors,
    }),
  );

export const InvoiceTemplateCapabilities = {
  invoice_templates_list: {
    description: "Read the current active reusable invoice content in this book.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      after: Schema.optional(Accounting.Identifier),
    }),
    output: InvoiceTemplatePage,
    readOnly: true,
  },
  invoice_templates_get: {
    description: "Read a retained invoice content template revision, including an archived origin.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      revision: Schema.optional(Commerce.Version),
    }),
    output: InvoiceTemplateRevision,
    readOnly: true,
  },
  invoice_templates_apply: {
    description:
      "Prepare a normal editable invoice draft from an exact active template revision. Never issues or sends an invoice.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ApplyInvoiceTemplate,
    }),
    output: Drafts.InvoiceDraftRevision,
    readOnly: false,
  },
};

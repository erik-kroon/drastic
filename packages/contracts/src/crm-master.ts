import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { accountingErrors } from "./accounting-errors";
import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";

export const AnnotationKind = Schema.Literals(["contact", "alias", "registry_provenance"]);

export const AddAnnotation = Schema.Struct({
  partyId: Accounting.Identifier,
  kind: AnnotationKind,
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  detail: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  evidenceId: Accounting.Identifier,
});

export const Annotation = Schema.Struct({
  id: Accounting.Identifier,
  partyId: Accounting.Identifier,
  kind: AnnotationKind,
  label: Schema.String,
  detail: Schema.String,
  evidenceId: Accounting.Identifier,
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
});

export const DirectoryEntry = Schema.Struct({
  party: Commerce.CounterpartyRevision,
  annotations: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      kind: AnnotationKind,
      label: Schema.String,
      detail: Schema.String,
      evidenceId: Accounting.Identifier,
      recordedBy: Accounting.Identifier,
      recordedAt: Schema.String,
    }),
  ),
});

export const DirectoryPage = Schema.Struct({
  items: Schema.Array(DirectoryEntry),
  next: Schema.NullOr(Accounting.Identifier),
});

export const DirectoryExport = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(DirectoryEntry),
  next: Schema.NullOr(Accounting.Identifier),
});

const DirectoryQuery = Schema.Struct({
  search: Schema.optional(Schema.String),
  role: Schema.optional(Schema.Literals(["customer", "supplier", "both"])),
  after: Schema.optional(Accounting.Identifier),
});

export const CustomerReference = Schema.Struct({
  partyId: Accounting.Identifier,
  revision: Commerce.Version,
  digest: Accounting.Digest,
});

export const RecipientPurpose = Schema.Literals(["invoice_delivery", "payment_reminder"]);

export const RecipientStatus = Schema.Literals(["reviewed", "withdrawn"]);

const RevisionExpectation = {
  expectedRevision: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,3})$/)),
  expectedDigest: Schema.NullOr(Accounting.Digest),
  reviewEvidence: Commerce.EvidenceReference,
  reason: Accounting.Description,
};

export const SaveCustomerRecipient = Schema.Struct({
  ...RevisionExpectation,
  channel: Schema.Literal("email"),
  destination: Schema.String.check(
    Schema.isPattern(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/),
    Schema.isMaxLength(254),
  ),
  purposes: Schema.Array(RecipientPurpose).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  status: RecipientStatus,
  acknowledgeReviewedRecipient: Schema.Literal(true),
});

export const ReviewedCustomerRecipient = Schema.Struct({
  scope: Accounting.Scope,
  partyId: Accounting.Identifier,
  revision: Commerce.Version,
  channel: SaveCustomerRecipient.fields.channel,
  destination: SaveCustomerRecipient.fields.destination,
  purposes: SaveCustomerRecipient.fields.purposes,
  status: RecipientStatus,
  reviewEvidence: Commerce.EvidenceReference,
  reason: Accounting.Description,
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
  digest: Accounting.Digest,
});

export const CalendarDayTerms = Schema.Struct({
  kind: Schema.Literal("calendar_days_v1"),
  days: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 365 })),
});

export const SaveCustomerInvoiceDefaults = Schema.Struct({
  ...RevisionExpectation,
  terms: CalendarDayTerms,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  language: Schema.Literals(["en", "sv"]),
  recipient: Schema.NullOr(CustomerReference),
});

export const CustomerInvoiceDefaults = Schema.Struct({
  scope: Accounting.Scope,
  partyId: Accounting.Identifier,
  revision: Commerce.Version,
  terms: CalendarDayTerms,
  currency: SaveCustomerInvoiceDefaults.fields.currency,
  language: SaveCustomerInvoiceDefaults.fields.language,
  recipient: Schema.NullOr(CustomerReference),
  reviewEvidence: Commerce.EvidenceReference,
  reason: Accounting.Description,
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
  digest: Accounting.Digest,
});

export const ApplyCustomerInvoiceDefaults = Schema.Struct({
  reference: CustomerReference,
  invoiceDate: Accounting.CalendarDate,
});

export const CopiedCustomerInvoiceDefaults = Schema.Struct({
  scope: Accounting.Scope,
  reference: CustomerReference,
  invoiceDate: Accounting.CalendarDate,
  dueDate: Accounting.CalendarDate,
  paymentTerms: Schema.String,
  currency: SaveCustomerInvoiceDefaults.fields.currency,
  language: SaveCustomerInvoiceDefaults.fields.language,
  recipient: Schema.NullOr(CustomerReference),
});

const CustomerPath = Schema.Struct({ ...Accounting.Scope.fields, partyId: Accounting.Identifier });

const CustomerRevisionQuery = Schema.Struct({ revision: Schema.optional(Commerce.Version) });

const CustomerReadInput = Schema.Struct({
  scope: Accounting.Scope,
  partyId: Accounting.Identifier,
  revision: Schema.optional(Commerce.Version),
});

const customerPath = "/v1/entities/:entityId/books/:bookId/commerce/directory/:partyId";

export const CrmMasterCapabilities = {
  crm_get_invoice_defaults: {
    description:
      "Read scoped immutable customer invoice defaults. These copied commercial terms confer no sending authority.",
    input: CustomerReadInput,
    output: CustomerInvoiceDefaults,
    readOnly: true,
  },
  crm_get_reviewed_recipient: {
    description:
      "Read an operator-reviewed customer email destination and supported purposes. Review does not prove mailbox ownership or delivery.",
    input: CustomerReadInput,
    output: ReviewedCustomerRecipient,
    readOnly: true,
  },
  crm_directory: {
    description:
      "Read a bounded book-scoped party directory with retained contact, alias and registry-provenance annotations.",
    input: Schema.Struct({ scope: Accounting.Scope, filters: DirectoryQuery }),
    output: DirectoryPage,
    readOnly: true,
  },
  crm_directory_export: {
    description:
      "Read a bounded metadata-only party directory export; it does not merge parties or export unrelated books.",
    input: Schema.Struct({ scope: Accounting.Scope, filters: DirectoryQuery }),
    output: DirectoryExport,
    readOnly: true,
  },
};

export const CrmMasterApi = HttpApiGroup.make("crmMaster")
  .add(
    HttpApiEndpoint.get("crmCustomerInvoiceDefaults", `${customerPath}/invoice-defaults`, {
      params: CustomerPath,
      query: CustomerRevisionQuery,
      success: CustomerInvoiceDefaults,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("crmSaveCustomerInvoiceDefaults", `${customerPath}/invoice-defaults`, {
      params: CustomerPath,
      headers: Accounting.IdempotencyHeaders,
      payload: SaveCustomerInvoiceDefaults,
      success: CustomerInvoiceDefaults,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "crmApplyCustomerInvoiceDefaults",
      `${customerPath}/invoice-defaults/apply`,
      {
        params: CustomerPath,
        payload: ApplyCustomerInvoiceDefaults,
        success: CopiedCustomerInvoiceDefaults,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("crmCustomerRecipient", `${customerPath}/recipient`, {
      params: CustomerPath,
      query: CustomerRevisionQuery,
      success: ReviewedCustomerRecipient,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("crmSaveCustomerRecipient", `${customerPath}/recipient`, {
      params: CustomerPath,
      headers: Accounting.IdempotencyHeaders,
      payload: SaveCustomerRecipient,
      success: ReviewedCustomerRecipient,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("crmDirectory", "/v1/entities/:entityId/books/:bookId/commerce/directory", {
      params: Accounting.Scope,
      query: DirectoryQuery,
      success: DirectoryPage,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "crmDirectoryExport",
      "/v1/entities/:entityId/books/:bookId/commerce/directory/export",
      {
        params: Accounting.Scope,
        query: DirectoryQuery,
        success: DirectoryExport,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "crmAddAnnotation",
      "/v1/entities/:entityId/books/:bookId/commerce/directory/annotations",
      {
        params: Accounting.Scope,
        headers: Accounting.IdempotencyHeaders,
        payload: AddAnnotation,
        success: Annotation,
        error: accountingErrors,
      },
    ),
  );

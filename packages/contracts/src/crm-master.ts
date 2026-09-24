import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
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
  annotations: Schema.Array(Schema.Struct({
    id: Accounting.Identifier,
    kind: AnnotationKind,
    label: Schema.String,
    detail: Schema.String,
    evidenceId: Accounting.Identifier,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
  })),
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
export const CrmMasterCapabilities = {
  crm_directory: {
    description: "Read a bounded book-scoped party directory with retained contact, alias and registry-provenance annotations.",
    input: Schema.Struct({ scope: Accounting.Scope, filters: DirectoryQuery }),
    output: DirectoryPage,
    readOnly: true,
  },
  crm_directory_export: {
    description: "Read a bounded metadata-only party directory export; it does not merge parties or export unrelated books.",
    input: Schema.Struct({ scope: Accounting.Scope, filters: DirectoryQuery }),
    output: DirectoryExport,
    readOnly: true,
  },
};

export const CrmMasterApi = HttpApiGroup.make("crmMaster")
  .add(HttpApiEndpoint.get("crmDirectory", "/v1/entities/:entityId/books/:bookId/commerce/directory", {
    params: Accounting.Scope,
    query: DirectoryQuery,
    success: DirectoryPage, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.get("crmDirectoryExport", "/v1/entities/:entityId/books/:bookId/commerce/directory/export", {
    params: Accounting.Scope,
    query: DirectoryQuery,
    success: DirectoryExport, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.post("crmAddAnnotation", "/v1/entities/:entityId/books/:bookId/commerce/directory/annotations", {
    params: Accounting.Scope, headers: Accounting.IdempotencyHeaders,
    payload: AddAnnotation, success: Annotation, error: accountingErrors,
  }));

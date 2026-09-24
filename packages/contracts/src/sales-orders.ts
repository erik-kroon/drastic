import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./invoice-drafts";
import { accountingErrors } from "./accounting-errors";

export const CreateSalesDocument = Schema.Struct({ kind: Schema.Literals(["quote", "order"]), content: Drafts.DraftContent });
export const ReviseSalesDocument = Schema.Struct({ expectedRevision: Commerce.Version, expectedDigest: Accounting.Digest, content: Drafts.DraftContent, reason: Accounting.Description });
export const TransitionSalesDocument = Schema.Struct({ expectedRevision: Commerce.Version, expectedDigest: Accounting.Digest, action: Schema.Literals(["accept", "cancel", "order_from_quote"]) });
export const ConvertSalesOrder = Schema.Struct({ expectedRevision: Commerce.Version, expectedDigest: Accounting.Digest, draftKey: Accounting.Identifier, lines: Schema.Array(Schema.Struct({ id: Accounting.Identifier, quantity: Drafts.DraftLine.fields.quantity })).check(Schema.isMinLength(1), Schema.isMaxLength(50)) });
export const SalesDocument = Schema.Struct({
  id: Accounting.Identifier, scope: Accounting.Scope, kind: Schema.Literals(["quote", "order"]),
  state: Schema.Literals(["draft", "accepted", "cancelled"]), revision: Commerce.Version,
  content: Drafts.DraftContent, calculation: Schema.Unknown,
  sourceQuoteId: Schema.NullOr(Accounting.Identifier), sourceQuoteRevision: Schema.NullOr(Commerce.Version),
  createdAt: Schema.String, receipt: Commerce.CommandReceipt, digest: Accounting.Digest,
});
export const ConvertedPortion = Schema.Struct({ id: Accounting.Identifier, quantity: Drafts.DraftLine.fields.quantity });
export const SalesDocumentList = Schema.Struct({ scope: Accounting.Scope, items: Schema.Array(SalesDocument) });
export const SalesDocumentView = Schema.Struct({ record: SalesDocument, conversions: Schema.Array(Schema.Struct({
  draftId: Accounting.Identifier, orderRevision: Commerce.Version, portions: Schema.Array(ConvertedPortion),
})) });
export const OrderConversion = Schema.Struct({
  orderId: Accounting.Identifier, orderRevision: Commerce.Version,
  portions: Schema.Array(ConvertedPortion), draft: Drafts.InvoiceDraftRevision,
});
const root = "/v1/entities/:entityId/books/:bookId/commerce/sales-documents";
export const SalesOrdersApi = HttpApiGroup.make("salesOrders")
  .add(HttpApiEndpoint.post("createSalesDocument", root, {
    params: Accounting.Scope, headers: Accounting.IdempotencyHeaders,
    payload: CreateSalesDocument,
    success: SalesDocument, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.get("listSalesDocuments", root, {
    params: Accounting.Scope, success: SalesDocumentList, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.get("getSalesDocument", `${root}/:id`, {
    params: Accounting.ChangePath, success: SalesDocumentView, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.post("reviseSalesDocument", `${root}/:id/revisions`, {
    params: Accounting.ChangePath, headers: Accounting.IdempotencyHeaders,
    payload: ReviseSalesDocument,
    success: SalesDocument, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.post("transitionSalesDocument", `${root}/:id/transitions`, {
    params: Accounting.ChangePath, headers: Accounting.IdempotencyHeaders,
    payload: TransitionSalesDocument,
    success: SalesDocument, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.post("convertSalesOrder", `${root}/:id/conversions`, {
    params: Accounting.ChangePath, headers: Accounting.IdempotencyHeaders,
    payload: ConvertSalesOrder,
    success: OrderConversion, error: accountingErrors,
  }));

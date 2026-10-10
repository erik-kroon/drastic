import * as Accounting from "@open-erp/contracts/accounting";
import * as Bureau from "@open-erp/contracts/bureau-obligations";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as InvoiceDb from "../db/commerce/invoices";
import { failure } from "./failures";
import { requireTableAccess, withBook } from "./commerce/support";

export const listBureauObligations = Effect.fn("bureau.obligations.list")(function* (
  token: string,
  command: { readonly scope: typeof Accounting.Scope.Type },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableAccess(
      transaction,
      ["commerce_invoices", "commerce_invoice_revisions"],
      false,
    );

    const identities = yield* InvoiceDb.readInvoiceIdentityPage(
      transaction,
      command.scope.bookId,
      "",
      10001,
    );

    if (identities.length > 10000) return yield* failure("UnsupportedProfile");
    const checkedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const items: Array<(typeof Bureau.BureauObligations.Type.items)[number]> = [];

    for (let offset = 0; offset < identities.length; offset += 1000) {
      const rows = yield* InvoiceDb.readLiveInvoicePage(
        transaction,
        command.scope.bookId,
        identities.slice(offset, offset + 1000).map((row) => row.id),
      );

      if (rows.length !== Math.min(1000, identities.length - offset))
        return yield* failure("StaleDependency");

      const invoices = yield* Schema.decodeUnknownEffect(Schema.Array(Commerce.Invoice))(
        rows.map((row) => row.body),
      ).pipe(Effect.mapError((cause) => failure("InternalError", cause)));

      for (const invoice of invoices) {
        if (
          invoice.direction !== "supplier" ||
          invoice.status === "cancelled" ||
          invoice.status === "allocated" ||
          invoice.status === "credited"
        )
          continue;
        const sources = new Map<string, { evidenceId: string; sha256: string }>();

        for (const evidence of [invoice.evidence, invoice.currentRevision.evidence])
          sources.set(evidence.evidenceId, {
            evidenceId: evidence.evidenceId,
            sha256: evidence.sha256,
          });

        const unknowns = [
          ...(invoice.outstandingMinor === null ? ["outstanding_amount"] : []),
          ...(invoice.currentRevision.dueOn === null ? ["due_date"] : []),
          ...(invoice.blockers.length ? ["blocked_source"] : []),
        ];

        items.push({
          obligationId: invoice.id,
          creditor: invoice.counterpartyName,
          currency: invoice.currency,
          currencyScale: invoice.currencyScale,
          outstandingMinor: invoice.outstandingMinor,
          dueOn: invoice.currentRevision.dueOn,
          freshness:
            Date.parse(invoice.currentRevision.createdAt) <
            Date.parse(checkedAt) - 24 * 60 * 60 * 1000
              ? "stale"
              : "current",
          recordedAt: invoice.currentRevision.createdAt,
          sources: [...sources.values()],
          unknowns,
        });
      }
    }

    return yield* Schema.decodeEffect(Bureau.BureauObligations)({
      scope: command.scope,
      checkedAt,
      coverage: items.length === 0 ? "unknown" : "partial",
      coverageReason:
        "Only registered supplier invoices are represented; unregistered debts and other obligations are not verified.",
      items,
    }).pipe(Effect.mapError((cause) => failure("InternalError", cause)));
  });
});

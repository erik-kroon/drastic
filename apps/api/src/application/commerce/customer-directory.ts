import * as Commerce from "@open-erp/contracts/commerce";
import * as Effect from "effect/Effect";
import { readInvoiceIdsByCounterparty } from "../../db/commerce/party-identity";
import { readLiveInvoicePage } from "../../db/commerce/invoices";
import { invoiceRegisterTables, readUtcDate } from "../../db/commerce/invoice-lifecycle";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { decode, requireTableAccess } from "./support";

type Balance = {
  currency: string;
  currencyScale: number;
  year: string;
  outstanding: bigint | null;
  invoiced: bigint;
  overdue: boolean;
};

export const customerDirectoryFinancials = Effect.fn("commerce.directory.financials")(function* (
  transaction: Transaction,
  bookId: string,
  partyIds: readonly string[],
) {
  const result = new Map<
    string,
    Array<{
      currency: string;
      currencyScale: number;
      year: string;
      outstandingMinor: string | null;
      invoicedYearMinor: string;
      overdue: boolean;
    }>
  >();

  if (!partyIds.length) return result;
  yield* requireTableAccess(transaction, invoiceRegisterTables, false);
  const dates = yield* readUtcDate(transaction);
  const today = dates[0]?.today;

  if (!today) return yield* failure("InternalError");
  const year = today.slice(0, 4);
  const identities = yield* readInvoiceIdsByCounterparty(transaction, bookId, partyIds, 5000);

  if (identities.length > 5000) return yield* failure("UnsupportedProfile");
  const customers = identities.filter((item) => item.direction === "customer");

  const live = customers.length
    ? yield* readLiveInvoicePage(
        transaction,
        bookId,
        customers.map((item) => item.id),
      )
    : [];

  if (live.length !== customers.length) return yield* failure("InternalError");
  const groups = new Map<string, Map<string, Balance>>();

  for (const row of live) {
    const invoice = yield* decode(Commerce.Invoice, row.body);

    if (invoice.scope.bookId !== bookId || invoice.direction !== "customer")
      return yield* failure("InternalError");
    const party = groups.get(invoice.counterpartyId) ?? new Map<string, Balance>();
    const key = `${invoice.currency}:${invoice.currencyScale}`;

    const group = party.get(key) ?? {
      currency: invoice.currency,
      currencyScale: invoice.currencyScale,
      year,
      outstanding: 0n,
      invoiced: 0n,
      overdue: false,
    };

    if (invoice.outstandingMinor === null) group.outstanding = null;
    else if (group.outstanding !== null) group.outstanding += BigInt(invoice.outstandingMinor);

    if (invoice.issuedOn.slice(0, 4) === year)
      group.invoiced += BigInt(invoice.effectiveAmountMinor ?? invoice.amountMinor);

    if (
      invoice.outstandingMinor !== null &&
      BigInt(invoice.outstandingMinor) > 0n &&
      invoice.currentRevision.dueOn < today
    )
      group.overdue = true;

    party.set(key, group);
    groups.set(invoice.counterpartyId, party);
  }

  for (const id of partyIds) {
    result.set(
      id,
      [...(groups.get(id)?.values() ?? [])].map((group) => ({
        currency: group.currency,
        currencyScale: group.currencyScale,
        year: group.year,
        outstandingMinor: group.outstanding?.toString() ?? null,
        invoicedYearMinor: group.invoiced.toString(),
        overdue: group.overdue,
      })),
    );
  }

  return result;
});

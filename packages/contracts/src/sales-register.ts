import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";

export const SalesStatus = Schema.Literals([
  "all",
  "draft",
  "open",
  "overdue",
  "settled",
  "cancelled",
]);

export const SalesSort = Schema.Literals(["newest", "oldest", "customer", "due"]);

export const SalesQuery = Schema.Struct({
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  status: Schema.optional(SalesStatus),
  sort: Schema.optional(SalesSort),
  page: Schema.optional(Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/))),
});

export const SalesRow = Schema.Struct({
  id: Accounting.Identifier,
  kind: Schema.Literals(["draft", "invoice"]),
  title: Schema.String,
  number: Schema.NullOr(Schema.String),
  customer: Schema.String,
  date: Schema.String,
  dueOn: Schema.NullOr(Accounting.AccountingDate),
  currency: Schema.String,
  currencyScale: Schema.Int,
  amountMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  outstandingMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  status: Schema.Literals([
    "draft",
    "open",
    "partially_allocated",
    "allocated",
    "blocked",
    "cancelled",
  ]),
  needsDetails: Schema.Boolean,
  overdue: Schema.Boolean,
  draftId: Schema.NullOr(Accounting.Identifier),
  issueReviewId: Schema.NullOr(Accounting.Identifier),
});

export const SalesPage = Schema.Struct({
  scope: Accounting.Scope,
  checkedAt: Schema.String,
  asOf: Accounting.AccountingDate,
  page: Schema.Int,
  pageSize: Schema.Literal(50),
  total: Schema.Int,
  counts: Schema.Struct({
    all: Schema.Int,
    draft: Schema.Int,
    open: Schema.Int,
    overdue: Schema.Int,
    settled: Schema.Int,
    cancelled: Schema.Int,
  }),
  items: Schema.Array(SalesRow),
});

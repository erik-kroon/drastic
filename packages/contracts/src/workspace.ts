import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

export const WorkQuery = Schema.Struct({
  period: Schema.optional(Accounting.Identifier),
  status: Schema.optional(Schema.Literals(["all", "open", "completed"])),
  sort: Schema.optional(Schema.Literals(["newest", "oldest"])),
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  after: Schema.optional(Accounting.Identifier),
});

export const WorkItem = Schema.Struct({
  kind: Schema.Literal("journal_proposal"),
  id: Accounting.Identifier,
  revision: Accounting.Digest,
  description: Schema.String,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  periodId: Accounting.Identifier,
  amountMinor: Accounting.AggregateMinorUnits,
  currency: Schema.String,
  state: Schema.Literals(["unposted", "posted", "posted_elsewhere"]),
  receiptId: Schema.NullOr(Accounting.Identifier),
});

export const WorkPage = Schema.Struct({
  scope: Accounting.Scope,
  actorId: Accounting.Identifier,
  checkedAt: Schema.String,
  sequence: Accounting.AggregateMinorUnits,
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  filters: Schema.Struct({
    period: Schema.NullOr(Accounting.Identifier),
    status: Schema.Literals(["all", "open", "completed"]),
    sort: Schema.Literals(["newest", "oldest"]),
    q: Schema.String,
  }),
  coverage: Schema.Literal("journal_proposals_only"),
  total: Accounting.AggregateMinorUnits,
  counts: Schema.Struct({
    open: Accounting.AggregateMinorUnits,
    completed: Accounting.AggregateMinorUnits,
  }),
  items: Schema.Array(WorkItem),
  next: Schema.NullOr(Accounting.Identifier),
});

export const AttentionQuery = Schema.Struct({
  ...WorkQuery.fields,
  kind: Schema.optional(Schema.Literals(["all", "journal", "invoice", "expense"])),
  after: Schema.optional(
    Schema.String.check(Schema.isPattern(/^(journal|invoice|expense)_[a-z][a-z0-9_-]{2,127}$/)),
  ),
});
export const AttentionItem = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literals(["journal", "invoice", "expense"]),
  id: Accounting.Identifier,
  revision: Accounting.Digest,
  title: Schema.String,
  date: Schema.NullOr(Accounting.AccountingDate),
  updatedAt: Schema.String,
  amountMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  currency: Schema.NullOr(Schema.String),
  currencyScale: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))),
  state: Schema.Literals(["open", "completed"]),
  reason: Schema.Literals([
    "journal_review",
    "journal_posted",
    "invoice_draft",
    "invoice_issued",
    "expense_review",
    "expense_reviewed",
  ]),
});
export const AttentionPage = Schema.Struct({
  scope: Accounting.Scope,
  checkedAt: Schema.String,
  coverage: Schema.Literal("journals_invoice_drafts_expense_reviews"),
  filters: Schema.Struct({
    ...WorkPage.fields.filters.fields,
    kind: Schema.Literals(["all", "journal", "invoice", "expense"]),
  }),
  total: Accounting.AggregateMinorUnits,
  counts: WorkPage.fields.counts,
  items: Schema.Array(AttentionItem),
  next: Schema.NullOr(Schema.String),
});

export const WorkspaceCapabilities = {
  workspace_attention: {
    description:
      "Read a scoped, bounded work list covering standalone journal proposals, commercial invoice drafts and expense reviews. Counts reflect the same filters. Completion names the domain transition, never company completeness.",
    input: Schema.Struct({ scope: Accounting.Scope, ...AttentionQuery.fields }),
    output: AttentionPage,
    readOnly: true,
  },
  workspace_list_work: {
    description:
      "List scoped journal proposals with exact amounts, period/search filters, status facets and bounded pagination. Unposted is an observation, not approval. Coverage is journal proposals only; no source or period completeness is implied.",
    input: Schema.Struct({ scope: Accounting.Scope, ...WorkQuery.fields }),
    output: WorkPage,
    readOnly: true,
  },
};

export const WorkspaceApi = HttpApiGroup.make("workspace").add(
  HttpApiEndpoint.get("listAttention", "/v1/entities/:entityId/books/:bookId/attention", {
    params: Accounting.Scope,
    query: AttentionQuery,
    success: AttentionPage,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listWorkspaceWork", "/v1/entities/:entityId/books/:bookId/work", {
    params: Accounting.Scope,
    query: WorkQuery,
    success: WorkPage,
    error: accountingErrors,
  }),
);

import type {} from "@/router";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Sales from "@open-erp/contracts/sales-register";
import * as Sources from "@open-erp/contracts/source-intake";
import { AttentionQuery } from "@open-erp/contracts/workspace";
import {
  defaultParseSearch,
  defaultStringifySearch,
  useParams,
  useSearch,
} from "@tanstack/react-router";

export const WorkReturnSearch = Schema.optional(
  Schema.String.check(Schema.isPattern(/^\?/), Schema.isMaxLength(8192)),
);

export const WorkQueueQuery = Schema.Struct({
  ...AttentionQuery.fields,
  manifest: Schema.optional(Accounting.Identifier),
});

export type WorkReturn = typeof WorkQueueQuery.Type;

export const WorkHomeQuery = Schema.Struct({
  after: AttentionQuery.fields.after,
  status: Schema.optional(Schema.Literals(["open", "completed", "watch"])),
  task: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  stage: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

export function decodeWorkReturn(search: string | undefined) {
  if (!search) return undefined;

  const decoded = Schema.decodeOption(WorkQueueQuery)(defaultParseSearch(search));

  return Option.getOrUndefined(decoded);
}

export function encodeWorkReturn(work: WorkReturn | undefined) {
  if (!work) return undefined;

  return defaultStringifySearch(work) || "?";
}

export function workReturnHref(
  base: string,
  view: string,
  work: WorkReturn | undefined,
  owner?: OwnerReturn,
) {
  const encoded = encodeWorkReturn(work);

  const target = encoded
    ? `${base}?view=${view}&work=${encodeURIComponent(encoded)}`
    : `${base}?view=${view}`;

  return owner ? `${target}&returnTo=${encodeURIComponent(encodeOwnerReturn(owner))}` : target;
}

export function workQueueHref(base: string, work: WorkReturn | undefined) {
  return `${base}/work${defaultStringifySearch(work ?? {})}`;
}

export function useWorkReturn() {
  const search = useSearch({ strict: false });
  const params = useParams({ strict: false });

  return params.planId
    ? Schema.decodeUnknownSync(WorkQueueQuery)(search)
    : decodeWorkReturn(search.work);
}

export const DocumentQuery = Schema.Struct({
  work: WorkReturnSearch,
  ...Sources.ArchiveFilters.fields,
  draftRevision: Schema.optional(Commerce.Version),
  expenseRevision: Schema.optional(Commerce.Version),
  expenseReviewId: Schema.optional(Accounting.Identifier),
  view: Schema.optional(Schema.String),
  record: Schema.optional(Schema.String),
});

export const PurchasesOwnerQuery = Schema.Struct({
  ...DocumentQuery.fields,
  review: Schema.optional(Accounting.Identifier),
  occurrence: Schema.optional(Accounting.Identifier),
  returnTo: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
});

const pageNumber = Schema.optional(
  Schema.Union([
    Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/)),
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999999 })),
  ]),
);

export const BankOwnerQuery = Schema.Struct({
  view: Schema.optional(Schema.String),
  record: Schema.optional(Schema.String),
  account: Schema.optional(Accounting.Identifier),
  from: Schema.optional(Accounting.AccountingDate),
  to: Schema.optional(Accounting.AccountingDate),
  tab: Schema.optional(Schema.Literals(["unmatched", "all", "matched", "ledger"])),
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  page: pageNumber,
  statement: Schema.optional(Accounting.Identifier),
  row: pageNumber,
  plan: Schema.optional(Accounting.Identifier),
  undo: Schema.optional(Accounting.Identifier),
  report: Schema.optional(Accounting.Identifier),
});

const SalesOwnerQuery = Schema.Struct({
  work: WorkReturnSearch,
  ...Sales.SalesQuery.fields,
  page: pageNumber,
  view: Schema.optional(Schema.String),
  record: Schema.optional(Accounting.Identifier),
  reminder: Schema.optional(Accounting.Identifier),
  job: Schema.optional(Accounting.Identifier),
  kind: Schema.optional(Schema.Literals(["draft", "invoice"])),
  stage: Schema.optional(Schema.Literals(["review", "payments"])),
  review: Schema.optional(Accounting.Identifier),
  allocation: Schema.optional(Accounting.Identifier),
  release: Schema.optional(Accounting.Identifier),
  paymentPage: pageNumber,
  paymentHistoryPage: pageNumber,
});

export const OwnerReturn = Schema.Union([
  Schema.Struct({ owner: Schema.Literal("home"), search: WorkHomeQuery }),
  Schema.Struct({ owner: Schema.Literal("sales"), search: SalesOwnerQuery }),
  Schema.Struct({ owner: Schema.Literal("documents"), search: DocumentQuery }),
  Schema.Struct({ owner: Schema.Literal("purchases"), search: PurchasesOwnerQuery }),
  Schema.Struct({ owner: Schema.Literal("bank"), search: BankOwnerQuery }),
  Schema.Struct({ owner: Schema.Literal("work"), search: WorkQueueQuery }),
]);

export type OwnerReturn = typeof OwnerReturn.Type;

export const OwnerReturnSearch = Schema.optional(Schema.String.check(Schema.isMaxLength(8192)));

export function decodeOwnerReturn(search: string | undefined) {
  if (!search?.startsWith("owner:")) return undefined;
  let encoded: string;

  try {
    encoded = decodeURIComponent(search.slice(6));
  } catch {
    return undefined;
  }

  const decoded = Schema.decodeOption(Schema.fromJsonString(OwnerReturn))(encoded);

  return Option.getOrUndefined(decoded);
}

export function encodeOwnerReturn(owner: OwnerReturn) {
  return `owner:${encodeURIComponent(Schema.encodeSync(Schema.fromJsonString(OwnerReturn))(owner))}`;
}

export function ownerReturnDestination(base: string, owner: OwnerReturn) {
  switch (owner.owner) {
    case "home":
      return { to: `${base}/`, search: owner.search };
    case "sales":
      return { to: `${base}/sales`, search: owner.search };
    case "documents":
      return { to: `${base}/purchases`, search: { ...owner.search, view: "documents" } };
    case "purchases":
      return { to: `${base}/purchases`, search: owner.search };
    case "bank":
      return { to: `${base}/accounts`, search: owner.search };
    case "work":
      return { to: `${base}/work`, search: owner.search };
  }
}

export function ownerReturnHref(base: string, owner: OwnerReturn) {
  const destination = ownerReturnDestination(base, owner);

  return `${destination.to}${defaultStringifySearch(destination.search)}`;
}

export function useOwnerReturn() {
  const search = useSearch({ strict: false });

  return decodeOwnerReturn(search.returnTo);
}

export const OwnerReviewQuery = Schema.Struct({
  ...WorkQueueQuery.fields,
  returnTo: OwnerReturnSearch,
});

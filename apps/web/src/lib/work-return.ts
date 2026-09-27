import type {} from "@/router";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { AttentionQuery } from "@open-erp/contracts/workspace";
import {
  defaultParseSearch,
  defaultStringifySearch,
  useParams,
  useSearch,
} from "@tanstack/react-router";

// A record page opened from the work queue carries the queue's own search, so
// returning lands on the same filtered list instead of an unfiltered one.
//
// It travels as one opaque parameter because a record area already uses these
// names for its own filters: a sales `status` is a draft state, not a work
// state. The parameter is a serialized search and grants no authority. A page
// decodes it and re-validates it with the queue's own schema before it uses it,
// so a hand-edited parameter is dropped rather than echoed into a link, and the
// queue still decides what that link means.
export const WorkReturnSearch = Schema.optional(
  Schema.String.check(Schema.isPattern(/^\?/), Schema.isMaxLength(8192)),
);

// The queue's own search plus the prepared selection this page is about. The
// attention read is not given `manifest`: it filters a list, and the selection
// is not a filter on that list.
export const WorkQueueQuery = Schema.Struct({
  ...AttentionQuery.fields,
  manifest: Schema.optional(Accounting.Identifier),
});

export type WorkReturn = typeof WorkQueueQuery.Type;

export function decodeWorkReturn(search: string | undefined) {
  if (!search) return undefined;

  const decoded = Schema.decodeOption(WorkQueueQuery)(defaultParseSearch(search));

  return decoded._tag === "Some" ? decoded.value : undefined;
}

export function encodeWorkReturn(work: WorkReturn | undefined) {
  if (!work) return undefined;

  return encodeURIComponent(defaultStringifySearch(work) || "?");
}

export function workReturnHref(base: string, view: string, work: WorkReturn | undefined) {
  const encoded = encodeWorkReturn(work);

  return encoded ? `${base}?view=${view}&work=${encoded}` : `${base}?view=${view}`;
}

export function workQueueHref(base: string, work: WorkReturn | undefined) {
  return `${base}/work${defaultStringifySearch(work ?? {})}`;
}

// Record areas carry an opaque queue search; journal reviews use its fields directly.
export function useWorkReturn() {
  const search = useSearch({ strict: false });
  const params = useParams({ strict: false });

  return params.planId
    ? Schema.decodeUnknownSync(WorkQueueQuery)(search)
    : decodeWorkReturn(search.work);
}

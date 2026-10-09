import type * as Accounting from "@open-erp/contracts/accounting";
import { usePreference } from "@/lib/preference";

// ADR 0019: one ledger, three audiences. The audience selects shell composition
// only. Book roles, firm membership and approval binding still decide what a
// user may do, and every write keeps its own authority check.
export const audiences = ["bureau", "client", "founder"] as const;

export type Audience = (typeof audiences)[number];

export type NavDestination =
  | "todo"
  | "overview"
  | "bank"
  | "sales"
  | "purchases"
  | "documents"
  | "bookkeeping"
  | "tax"
  | "reports"
  | "closing"
  | "portfolio"
  | "tools";

// Navigation filters by audience; order and grouping stay shared so the same
// destination is always found in the same place.
const hidden = {
  bureau: new Set<NavDestination>(),
  // A bureau client answers questions, sends evidence, approves exact actions
  // and reads the position. Bookkeeping, tax and closing stay with the bureau.
  client: new Set<NavDestination>([
    "bank",
    "sales",
    "purchases",
    "bookkeeping",
    "tax",
    "closing",
    "portfolio",
    "tools",
  ]),
  founder: new Set<NavDestination>(),
} satisfies Record<Audience, ReadonlySet<NavDestination>>;

export function showsDestination(audience: Audience, destination: NavDestination) {
  return !hidden[audience].has(destination);
}

export function useAudience(book: typeof Accounting.Book.Type) {
  return usePreference(`drastic.audience.${book.id}`, audiences, "bureau");
}

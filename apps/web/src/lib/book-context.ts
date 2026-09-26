import { createContext, useContext } from "react";
import type * as Accounting from "@open-erp/contracts/accounting";
import type { Locale } from "@/paraglide/runtime";

export const BookContext = createContext<{
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
} | null>(null);

export function useBookWorkspace() {
  const context = useContext(BookContext);

  if (!context) throw new Error("Book workspace is required");

  return context;
}

export function workspacePath(book: typeof Accounting.Book.Type) {
  return `/entities/${encodeURIComponent(book.entityId)}/books/${encodeURIComponent(book.id)}`;
}

export function reviewPath(book: typeof Accounting.Book.Type, id: string, digest?: string) {
  return `${workspacePath(book)}/reviews/${encodeURIComponent(id)}${digest ? `/${encodeURIComponent(digest)}` : "/"}`;
}

export type ReviewTarget =
  | {
      readonly kind: "standalone";
      readonly changeSetId: string;
      readonly planDigest: string;
    }
  | { readonly kind: "correction"; readonly bundleId: string; readonly bundleDigest: string };

// Review destinations are selected from this local table. A resolved bundle or
// plan never supplies a stored URI to navigate to.
export function reviewTargetPath(book: typeof Accounting.Book.Type, target: ReviewTarget) {
  return target.kind === "standalone"
    ? reviewPath(book, target.changeSetId, target.planDigest)
    : `${workspacePath(book)}/tools?view=corrections&bundle=${encodeURIComponent(target.bundleId)}`;
}

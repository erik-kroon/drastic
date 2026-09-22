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

import type * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";

const key = "open-erp:firm-portfolio-return";

const ReturnLocation = Schema.Struct({
  entityId: Schema.String,
  bookId: Schema.String,
  href: Schema.String,
});

export function rememberPortfolio(book: typeof Accounting.Book.Type, href: string) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ entityId: book.entityId, bookId: book.id, href }));
  } catch {
    // The company remains reachable when browser storage is unavailable.
  }
}

export function portfolioReturn(book: typeof Accounting.Book.Type) {
  try {
    const saved = Schema.decodeUnknownOption(ReturnLocation)(
      JSON.parse(sessionStorage.getItem(key) ?? "null"),
    );

    if (saved._tag === "None") return null;
    const value = saved.value;

    if (value.entityId !== book.entityId || value.bookId !== book.id) return null;
    const url = new URL(value.href, window.location.origin);

    if (url.origin !== window.location.origin || url.pathname !== "/firms") return null;

    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

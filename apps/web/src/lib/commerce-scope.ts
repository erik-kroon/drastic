import type * as Accounting from "@open-erp/contracts/accounting";
import { bookKey, bookPath } from "./accounting-api";

type Book = typeof Accounting.Book.Type;

export const commercePath = (book: Book) => `${bookPath(book)}/commerce`;

export const commerceKey = (book: Book) => [...bookKey(book), "commerce"];

export function checkScope(book: Book, scope: typeof Accounting.Scope.Type) {
  if (scope.bookId !== book.id || scope.entityId !== book.entityId)
    throw new Error("Commerce response scope mismatch");
}

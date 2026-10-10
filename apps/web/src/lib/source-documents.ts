import { bookScope } from "@/lib/contract-client";
import { queryOptions } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Sources from "@open-erp/contracts/source-intake";
import { bookKey, readAccounting } from "./accounting-api";

export const EnteredExpenseEvidence = Schema.Struct({
  kind: Schema.Literals(["expense_entry_v1", "supplier_invoice_source_v1"]),
  source: Schema.NullOr(
    Schema.Struct({
      occurrenceId: Accounting.Identifier,
      sha256: Accounting.Digest,
      filename: Schema.String,
    }),
  ),
  fields: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export function enteredExpenseSource(content: string) {
  return enteredExpenseDocument(content)?.source ?? null;
}

export function enteredExpenseDocument(content: string) {
  try {
    const parsed = Schema.decodeUnknownOption(EnteredExpenseEvidence)(JSON.parse(content));

    return Option.getOrNull(parsed);
  } catch {
    return null;
  }
}

export function sourceDocumentOptions(book: typeof Accounting.Book.Type, id: string) {
  return queryOptions({
    queryKey: [...bookKey(book), "source-occurrence", id],
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.sourceIntake.getSourceOccurrence({ params: { ...bookScope(book), id: id } }),
        Sources.SourceOccurrenceView,
        { signal },
      );

      if (
        result.occurrence.id !== id ||
        result.occurrence.scope.bookId !== book.id ||
        result.occurrence.scope.entityId !== book.entityId
      )
        throw new Error("Document scope mismatch");

      return result;
    },
    retry: false,
  });
}

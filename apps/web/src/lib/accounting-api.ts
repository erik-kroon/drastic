import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";

export const booksKey = ["accounting", "books"];

export const Books = Schema.Array(Accounting.Book);

export function bookPath(book: typeof Accounting.Book.Type) {
  return `/api/v1/entities/${encodeURIComponent(book.entityId)}/books/${encodeURIComponent(book.id)}`;
}

export function bookKey(book: typeof Accounting.Book.Type) {
  return ["accounting", book.entityId, book.id];
}

export async function readAccounting<S extends Schema.Top & { readonly DecodingServices: never }>(
  path: string,
  schema: S,
  options?: RequestInit,
): Promise<S["Type"]> {
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  const timeout = AbortSignal.timeout(20_000);

  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers,
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const failure = Schema.decodeUnknownOption(Accounting.AccountingError)(payload);

    if (failure._tag === "Some") throw failure.value;

    const accessCode =
      response.status === 401
        ? "Unauthorized"
        : response.status === 403
          ? "Forbidden"
          : response.status === 404
            ? "NotFound"
            : null;

    if (accessCode !== null) {
      throw new Accounting.AccountingError({
        code: accessCode,
        message: `HTTP ${response.status}`,
      });
    }

    throw new Error(`HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();

  return Schema.decodeUnknownSync(schema)(payload);
}

// The same payload keeps its key after an uncertain network outcome.
export function mutationOptions(
  path: string,
  body: string,
  keys: Map<string, string>,
): RequestInit {
  const identity = `${path}:${body}`;
  const key = keys.get(identity) ?? crypto.randomUUID();
  keys.set(identity, key);

  return { method: "POST", body, headers: { "Idempotency-Key": key } };
}

export function isUncertainWriteError(error: Error | null) {
  return (
    error !== null &&
    (!(error instanceof Accounting.AccountingError) ||
      error.code === "Unavailable" ||
      error.code === "InternalError")
  );
}

export function requiresNewProposal(error: Error | null) {
  return (
    error instanceof Accounting.AccountingError &&
    [
      "StaleDependency",
      "ApprovalRequired",
      "PeriodLocked",
      "UnsupportedProfile",
      "AlreadyPosted",
    ].includes(error.code)
  );
}

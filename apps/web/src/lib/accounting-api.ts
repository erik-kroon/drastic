import type { CommandKeys } from "./command-keys";
import type * as Effect from "effect/Effect";
import { runAccountingClient, type AccountingClient } from "./contract-client";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";

const responseStatuses = new WeakMap<Accounting.AccountingError, number>();

export function accountingResponseStatus(error: Accounting.AccountingError) {
  return responseStatuses.get(error);
}

export const booksKey = ["accounting", "books"];

export const Books = Schema.Array(Accounting.Book);

export function bookPath(book: typeof Accounting.Book.Type) {
  return `/api/v1/entities/${encodeURIComponent(book.entityId)}/books/${encodeURIComponent(book.id)}`;
}

export function bookKey(book: typeof Accounting.Book.Type) {
  return ["accounting", book.entityId, book.id];
}

export async function readAccounting<S extends Schema.Top & { readonly DecodingServices: never }>(
  path: string | ((client: AccountingClient) => Effect.Effect<S["Type"], unknown>),
  schema: S,
  options?: RequestInit,
  timeoutMs = 20_000,
): Promise<S["Type"]> {
  if (typeof path === "function") return runAccountingClient(path, options, timeoutMs);

  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  const timeout = AbortSignal.timeout(timeoutMs);

  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers,
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const failure = Schema.decodeUnknownOption(Accounting.AccountingError)(payload);

    if (Option.isSome(failure)) {
      responseStatuses.set(failure.value, response.status);

      throw failure.value;
    }

    const accessCode = Match.value(response.status).pipe(
      Match.when(401, () => "Unauthorized" as const),
      Match.when(403, () => "Forbidden" as const),
      Match.when(404, () => "NotFound" as const),
      Match.orElse(() => null),
    );

    if (accessCode !== null) {
      throw new Accounting.AccountingError({
        code: accessCode,
        message: `HTTP ${response.status}`,
        recovery: Accounting.failureRecovery(accessCode),
      });
    }

    throw new Error(`HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();

  return Schema.decodeUnknownSync(schema)(payload);
}

// The same payload keeps its key after an uncertain network outcome.
export function mutationOptions(path: string, body: string, keys: CommandKeys): RequestInit {
  return keys.options(path, body);
}

export function isUncertainWriteError(error: Error | null) {
  return (
    error !== null &&
    (!(error instanceof Accounting.AccountingError) ||
      Accounting.failureRecovery(error.code) === "outcome-unknown")
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
      "AccountingPeriodMissing",
      "PostingDateOutsidePeriod",
      "AccountMissing",
      "AccountInactive",
    ].includes(error.code)
  );
}

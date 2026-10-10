import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient, type HttpApiEndpoint } from "effect/http-api";
import { Api } from "@open-erp/contracts/api";
import type * as Accounting from "@open-erp/contracts/accounting";

export type AccountingClient = HttpApiClient.ForApi<typeof Api>;

export function bookScope(book: typeof Accounting.Book.Type) {
  return { entityId: book.entityId, bookId: book.id };
}

export function httpQuery<
  Endpoint extends HttpApiEndpoint.ConstraintRequest & { readonly query: Schema.Top | undefined },
>(endpoint: Endpoint, query: string | URLSearchParams): HttpApiEndpoint.Query<Endpoint>["Type"] {
  if (!endpoint.query) throw new Error("This operation has no query contract.");

  const schema = Schema.make<Schema.Codec<HttpApiEndpoint.Query<Endpoint>["Type"], unknown>>(
    endpoint.query.ast,
  );

  return Schema.decodeUnknownSync(schema)(Object.fromEntries(new URLSearchParams(query)));
}

export async function runAccountingClient<A>(
  request: (client: AccountingClient) => Effect.Effect<A, unknown>,
  options?: RequestInit,
  timeoutMs = 20_000,
): Promise<A> {
  const timeout = AbortSignal.timeout(timeoutMs);

  const result = await Effect.runPromise(
    HttpApiClient.make(Api, { baseUrl: window.location.origin }).pipe(
      Effect.flatMap(request),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, {
        ...options,
        credentials: "same-origin",
      }),
      Effect.result,
    ),
    { signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout },
  );

  if (Result.isFailure(result)) throw result.failure;

  return result.success;
}

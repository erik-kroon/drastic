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

type HttpRequestScope<Endpoint> = Omit<
  HttpApiEndpoint.Request<Endpoint>,
  "request" | "endpoint" | "group" | "headers" | "payload"
>;

type HttpRequest<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  HttpApiEndpoint.ClientRequest<
    HttpApiEndpoint.Params<Endpoint>,
    HttpApiEndpoint.Query<Endpoint>,
    HttpApiEndpoint.Payload<Endpoint>,
    HttpApiEndpoint.Headers<Endpoint>,
    "decoded-only"
  >;

export function httpRequest<
  Endpoint extends HttpApiEndpoint.ConstraintRequest &
    Pick<HttpApiEndpoint.Top, "params" | "query" | "headers" | "payload">,
>(
  endpoint: Endpoint,
  scope: HttpRequestScope<Endpoint>,
  options: RequestInit,
): HttpRequest<Endpoint> {
  const fields: Record<string, Schema.Top> = {};

  if (endpoint.params) fields.params = endpoint.params;

  if (endpoint.query) fields.query = endpoint.query;

  if (endpoint.headers) fields.headers = endpoint.headers;

  const payloads = [...endpoint.payload.values()].flatMap((payload) => payload.schemas);

  let payload: Schema.Json | undefined;

  if (payloads.length) {
    if (typeof options.body !== "string")
      throw new Error("This operation requires a JSON request body.");

    fields.payload = Schema.Union(payloads);
    payload = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(options.body);
  }

  const values = {
    params: endpoint.params
      ? Schema.encodeUnknownSync(Schema.make<Schema.Codec<unknown, unknown>>(endpoint.params.ast))(
          "params" in scope ? scope.params : undefined,
        )
      : undefined,
    query: endpoint.query
      ? Schema.encodeUnknownSync(Schema.make<Schema.Codec<unknown, unknown>>(endpoint.query.ast))(
          "query" in scope ? scope.query : undefined,
        )
      : undefined,
    headers: endpoint.headers ? Object.fromEntries(new Headers(options.headers)) : undefined,
    payload,
  };

  const schema = Schema.make<Schema.Codec<HttpRequest<Endpoint>, unknown>>(
    Schema.Struct(fields).ast,
  );

  return Schema.decodeUnknownSync(schema)(values);
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

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { HttpApiEndpoint } from "effect/http-api";
import type { AccountingError } from "@open-erp/contracts/accounting";
import type { HttpServerRequest } from "effect/http";
import type { RequestEnvironment } from "../../runtime/environment";
import { failure } from "../failures";

type OperationEndpoint = HttpApiEndpoint.ConstraintRequest &
  Pick<
    HttpApiEndpoint.Top,
    "params" | "query" | "headers" | "payload" | "success" | "method" | "path"
  >;

type OperationInput<Endpoint> = Omit<
  HttpApiEndpoint.Request<Endpoint>,
  "request" | "endpoint" | "group"
>;

export function bindHttpOperation<
  Endpoint extends OperationEndpoint,
  Input,
  Output,
  E extends AccountingError,
  R,
>(
  endpoint: Endpoint,
  operation: {
    readonly execute: (token: string, input: Input) => Effect.Effect<Output, E, R>;
    readonly input: Schema.Decoder<Input>;
    readonly output: Schema.Top;
    readonly description: string;
    readonly readOnly: boolean;
    readonly agentCallable?: boolean;
    readonly invoke: (
      token: string,
      input: Schema.Json,
    ) => Effect.Effect<Schema.Json, E | AccountingError | Schema.SchemaError, R>;
  },
  input: (request: HttpApiEndpoint.Request<Endpoint>) => Input,
) {
  return {
    endpoint,
    operation,
    handler:
      (
        authenticate: Effect.Effect<
          string,
          AccountingError,
          RequestEnvironment | HttpServerRequest.HttpServerRequest
        >,
      ) =>
      (request: HttpApiEndpoint.Request<Endpoint>) =>
        Effect.flatMap(authenticate, (token) => operation.execute(token, input(request))),
  };
}

export function defineHttpOperation<
  Endpoint extends OperationEndpoint,
  Output,
  E extends AccountingError,
  R,
>(
  endpoint: Endpoint,
  execute: (token: string, input: OperationInput<Endpoint>) => Effect.Effect<Output, E, R>,
) {
  const fields: Record<string, Schema.Top> = {};

  if (endpoint.params) fields.params = endpoint.params;

  if (endpoint.query) fields.query = endpoint.query;

  if (endpoint.headers) fields.headers = endpoint.headers;

  const payload = [...endpoint.payload.values()][0];

  if (payload) fields.payload = Schema.Union(payload.schemas);

  // Each field is taken from this exact endpoint, including its decoded types.
  const input = Schema.make<Schema.Codec<OperationInput<Endpoint>, unknown>>(
    Schema.Struct(fields).ast,
  );

  const output = Schema.Union([...endpoint.success]);

  const operation = {
    input,
    output,
    description: `${endpoint.method} ${endpoint.path}`,
    readOnly: endpoint.method === "GET",
    agentCallable: false,
    execute,
    invoke: (token: string, value: Schema.Json) =>
      Schema.decodeUnknownEffect(input)(value, { onExcessProperty: "error" }).pipe(
        Effect.mapError((cause) => failure("InvalidRequest", cause)),
        Effect.flatMap((decoded) => execute(token, decoded)),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
      ),
  };

  return bindHttpOperation(endpoint, operation, (request) => request);
}

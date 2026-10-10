import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";
import type { AccountingError } from "@open-erp/contracts/accounting";
import type { Database } from "../db/connection";
import type { RequestEnvironment } from "../runtime/environment";
import { capabilities } from "./capabilities";
import { httpOperations } from "./operations";

export type CataloguedOperation = {
  readonly input: Schema.Top;
  readonly output: Schema.Top;
  readonly description: string;
  readonly readOnly: boolean;
  readonly agentCallable?: boolean;
  readonly invoke: (
    token: string,
    input: Schema.Json,
  ) => Effect.Effect<
    Schema.Json,
    AccountingError | Schema.SchemaError,
    Database | RequestEnvironment
  >;
};

// Reviewed aliases retain their public MCP names. HTTP-only bindings are also
// registered, but remain withheld until their owner adopts an agent policy.
export const operationCatalogue: ReadonlyMap<string, CataloguedOperation> = new Map([
  ...Object.entries(capabilities),
  ...Object.entries(httpOperations).flatMap(([group, bindings]) =>
    Object.entries(bindings)
      .filter(([, binding]) => binding.operation.agentCallable === false)
      .map(([endpoint, binding]) => [`http_${group}_${endpoint}`, binding.operation] as const),
  ),
]);

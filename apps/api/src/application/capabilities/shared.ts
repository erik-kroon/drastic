import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import type { RequestEnvironment } from "../../runtime/environment";
import type { Database } from "../../db/connection";

function effectCapability<I, O extends Schema.Json>(
  definition: {
    readonly input: Schema.Decoder<I>;
    readonly output: Schema.Decoder<O>;
    readonly description: string;
    readonly readOnly: boolean;
    // An owner may withhold any capability from MCP. The separate agent policy
    // also requires explicit write classification; omission is not permission.
    readonly agentCallable?: boolean;
  },
  execute: (
    token: string,
    input: I,
  ) => Effect.Effect<O, Accounting.AccountingError, RequestEnvironment | Database>,
) {
  return {
    ...definition,
    execute,
    invoke: (token: string, input: Schema.Json) =>
      Schema.decodeEffect(definition.input)(input, { onExcessProperty: "error" }).pipe(
        Effect.flatMap((decoded) => execute(token, decoded)),
      ),
  };
}

export { effectCapability };

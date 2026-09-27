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
    // Set to false by the capability's own owner when the capability carries
    // approval or statutory activation authority. Such a capability stays out of
    // the ordinary agent catalogue: an agent must not be able to grant, commit or
    // inspect the authority that every other capability's family resolution
    // depends on. Only an explicit false withholds a capability.
    //
    // This is default-open, because 294 capabilities would otherwise each have to
    // declare their own agent visibility. A capability added to an
    // authority-bearing family must set this itself.
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

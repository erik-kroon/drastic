import * as Effect from "effect/Effect";
import * as Accounting from "@open-erp/contracts/accounting";
import { PreparationJob } from "@open-erp/contracts/automation";
import { failure } from "./failures";
import { query, scopeParameter } from "../db/query";
import { RequestEnvironment } from "../runtime/environment";

export const executePreparationJob = Effect.fn("Preparation.executeJob")(function* (
  payload: { jobId: string; scope: typeof Accounting.Scope.Type },
  step: number,
) {
  const { bindings } = yield* RequestEnvironment;
  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  return yield* query(
    "executePreparationJob",
    [
      bindings.OPENERP_PREPARATION_TOKEN,
      scopeParameter(payload.scope),
      payload.jobId,
      String(step),
    ],
    PreparationJob,
  );
});

export const startPreparationJob = Effect.fn("Preparation.startJob")(function* (
  token: string,
  input: { scope: typeof Accounting.Scope.Type; runId: string; idempotencyKey: string },
) {
  const { bindings } = yield* RequestEnvironment;
  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  return yield* query(
    "admitPreparationJob",
    [
      token,
      scopeParameter(input.scope),
      input.runId,
      input.idempotencyKey,
      bindings.OPENERP_PREPARATION_TOKEN,
    ],
    PreparationJob,
  );
});

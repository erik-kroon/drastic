import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const BankSourceCoverageHandlers = HttpApiBuilder.group(Api, "bankSourceCoverage", (handlers) =>
  handlers
    .handle("createBankSourceCoverage", ({ params, headers, payload }) =>
      Effect.gen(function*() {
        const token = yield* authenticate;
        return yield* capabilities.bank_create_source_coverage.execute(token, {
          scope: params, idempotencyKey: headers["idempotency-key"], input: payload,
        });
      }),
    )
    .handle("getBankSourceCoverage", ({ params }) =>
      Effect.gen(function*() {
        const token = yield* authenticate;
        return yield* capabilities.bank_get_source_coverage.execute(token, { scope: params, id: params.id });
      }),
    )
    .handle("listBankSourceCoverage", ({ params }) =>
      Effect.gen(function*() {
        const token = yield* authenticate;
        return yield* capabilities.bank_list_source_coverage.execute(token, { scope: params });
      }),
    ),
);

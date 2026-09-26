import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  createBankSourceCoverage,
  getBankSourceCoverage,
  listBankSourceCoverage,
} from "../../../application/banking/coverage";

export const BankSourceCoverageHandlers = HttpApiBuilder.group(
  Api,
  "bankSourceCoverage",
  (handlers) =>
    handlers
      .handle("createBankSourceCoverage", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          createBankSourceCoverage(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getBankSourceCoverage", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getBankSourceCoverage(token, { scope: scopeFromPath(params), reportId: params.id }),
        ),
      )
      .handle("listBankSourceCoverage", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          listBankSourceCoverage(token, { scope: scopeFromPath(params) }),
        ),
      ),
);

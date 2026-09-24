import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const CompanySetupHandlers = HttpApiBuilder.group(Api, "companySetup", (handlers) =>
  handlers
    .handle("createCompany", ({ headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.company_create.execute(token, {
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCompanySetup", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.company_get_setup.execute(token, { scope: params }),
      ),
    )
    .handle("saveCompanySetup", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.company_save_setup.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);

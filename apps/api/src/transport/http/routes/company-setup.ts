import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as CompanySetup from "../../../application/company-setup";

export const CompanySetupHandlers = HttpApiBuilder.group(Api, "companySetup", (handlers) =>
  handlers
    .handle("createCompany", ({ headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanySetup.createCompany(token, {
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCompanySetup", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanySetup.getCompanySetup(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("saveCompanySetup", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanySetup.saveCompanySetup(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);

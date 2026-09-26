import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as CompanyProfiles from "../../../application/company-profiles";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const CompanyProfileHandlers = HttpApiBuilder.group(Api, "companyProfile", (handlers) =>
  handlers
    .handle("getCompanyProfile", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.getCompanyProfile(token, {
          scope: scopeFromPath(params),
          recordClass: query.recordClass,
          dates: {
            postingOn: query.postingOn,
            taxPointOn: query.taxPointOn,
            paymentOn: query.paymentOn,
            reportOn: query.reportOn,
          },
        }),
      ),
    )
    .handle("recordCompanyFact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.recordCompanyFact(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviewCompanyFact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.reviewCompanyFact(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: { ...payload, factRevisionId: params.factRevisionId },
        }),
      ),
    )
    .handle("recordCompanyRoleBinding", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.recordCompanyRoleBinding(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareCompanyActivation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.prepareCompanyActivation(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCompanyActivation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.approveCompanyActivation(token, {
          scope: scopeFromPath(params),
          planId: params.planId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCompanyActivation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.executeCompanyActivation(token, {
          scope: scopeFromPath(params),
          planId: params.planId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCompanyActivation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        CompanyProfiles.getCompanyActivation(token, {
          scope: scopeFromPath(params),
          activationId: params.activationId,
        }),
      ),
    ),
);

import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import * as CompanyProfiles from "../company-profiles";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CompanyProfileOperations = {
  getCompanyActivation: bindHttpOperation(
    Api.groups.companyProfile.endpoints.getCompanyActivation,
    capabilities.company_get_activation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      activationId: params.activationId,
    }),
  ),
  executeCompanyActivation: bindHttpOperation(
    Api.groups.companyProfile.endpoints.executeCompanyActivation,
    capabilities.company_execute_activation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      planId: params.planId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approveCompanyActivation: bindHttpOperation(
    Api.groups.companyProfile.endpoints.approveCompanyActivation,
    capabilities.company_approve_activation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      planId: params.planId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  prepareCompanyActivation: bindHttpOperation(
    Api.groups.companyProfile.endpoints.prepareCompanyActivation,
    capabilities.company_prepare_activation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  recordCompanyRoleBinding: bindHttpOperation(
    Api.groups.companyProfile.endpoints.recordCompanyRoleBinding,
    capabilities.company_bind_role,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  reviewCompanyFact: bindHttpOperation(
    Api.groups.companyProfile.endpoints.reviewCompanyFact,
    capabilities.company_review_fact,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: { ...payload, factRevisionId: params.factRevisionId },
    }),
  ),
  recordCompanyFact: bindHttpOperation(
    Api.groups.companyProfile.endpoints.recordCompanyFact,
    capabilities.company_record_fact,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getCompanyProfile: bindHttpOperation(
    Api.groups.companyProfile.endpoints.getCompanyProfile,
    capabilities.company_get_profile,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      recordClass: query.recordClass,
      dates: {
        postingOn: query.postingOn,
        taxPointOn: query.taxPointOn,
        paymentOn: query.paymentOn,
        reportOn: query.reportOn,
        taxPeriodOn: query.taxPeriodOn ?? null,
      },
    }),
  ),
  listCompanyFacts: defineHttpOperation(
    Api.groups.companyProfile.endpoints.listCompanyFacts,
    (token, { params, query }) =>
      CompanyProfiles.listCompanyFacts(token, { scope: scopeFromPath(params), ...query }),
  ),
};

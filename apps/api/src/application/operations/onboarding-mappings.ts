import { Api } from "@open-erp/contracts/api";

import { getOnboardingMappings, saveOnboardingMapping } from "../onboarding/index";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const OnboardingMappingOperations = {
  getOnboardingMappings: defineHttpOperation(
    Api.groups.onboardingMappings.endpoints.getOnboardingMappings,
    (token, { params, query }) =>
      getOnboardingMappings(token, {
        scope: scopeFromPath(params),
        previewId: query.previewId,
      }),
  ),
  saveOnboardingMapping: defineHttpOperation(
    Api.groups.onboardingMappings.endpoints.saveOnboardingMapping,
    (token, { params, headers, payload }) =>
      saveOnboardingMapping(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};

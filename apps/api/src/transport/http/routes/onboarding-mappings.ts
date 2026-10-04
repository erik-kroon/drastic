import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  getOnboardingMappings,
  saveOnboardingMapping,
} from "../../../application/onboarding-mappings";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const OnboardingMappingHandlers = HttpApiBuilder.group(
  Api,
  "onboardingMappings",
  (handlers) =>
    handlers
      .handle("saveOnboardingMapping", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          saveOnboardingMapping(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getOnboardingMappings", ({ params, query }) =>
        Effect.flatMap(authenticate, (token) =>
          getOnboardingMappings(token, {
            scope: scopeFromPath(params),
            previewId: query.previewId,
          }),
        ),
      ),
);

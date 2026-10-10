import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { OnboardingMappingOperations } from "../../../application/operations/onboarding-mappings";
import { operationHandlers } from "../operation-handlers";

export const OnboardingMappingHandlers = HttpApiBuilder.group(
  Api,
  "onboardingMappings",
  (handlers) => handlers.handleAll(operationHandlers(OnboardingMappingOperations)),
);

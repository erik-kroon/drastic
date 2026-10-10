import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { OnboardingDeltaOperations } from "../../../application/operations/onboarding-deltas";
import { operationHandlers } from "../operation-handlers";

export const OnboardingDeltaHandlers = HttpApiBuilder.group(Api, "onboardingDeltas", (handlers) =>
  handlers.handleAll(operationHandlers(OnboardingDeltaOperations)),
);

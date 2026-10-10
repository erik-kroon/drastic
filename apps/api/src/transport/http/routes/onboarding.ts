import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { OnboardingOperations } from "../../../application/operations/onboarding";
import { operationHandlers } from "../operation-handlers";

export const OnboardingHandlers = HttpApiBuilder.group(Api, "onboarding", (handlers) =>
  handlers.handleAll(operationHandlers(OnboardingOperations)),
);

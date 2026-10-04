import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Onboarding from "../../../application/onboarding";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const OnboardingHandlers = HttpApiBuilder.group(Api, "onboarding", (handlers) =>
  handlers
    .handle("startOnboarding", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.startOnboarding(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveOnboarding", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.saveOnboarding(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("attachOnboardingSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.attachOnboardingSource(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getOnboardingHistory", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.getOnboardingHistory(token, { scope: scopeFromPath(params), ...query }),
      ),
    )
    .handle("getOnboarding", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.getOnboarding(token, { scope: scopeFromPath(params), ...query }),
      ),
    ),
);

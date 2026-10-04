import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Onboarding from "../../../application/onboarding";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const OnboardingHandlers = HttpApiBuilder.group(Api, "onboarding", (handlers) =>
  handlers
    .handle("qualifyOnboardingControl", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.qualifyOnboardingControl(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveOnboardingResponsibilities", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.saveOnboardingResponsibilities(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("captureOnboardingSnapshot", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.captureOnboardingSnapshot(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("decideOnboardingSnapshot", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.decideOnboardingSnapshot(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("requestOnboardingActivation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.requestOnboardingActivation(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("completeOnboardingFirstPeriod", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.completeOnboardingFirstPeriod(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getOnboardingLifecycle", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Onboarding.getOnboardingLifecycle(token, { scope: scopeFromPath(params) }),
      ),    )
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

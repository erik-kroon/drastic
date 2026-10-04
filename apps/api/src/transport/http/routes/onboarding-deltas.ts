import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  compareOnboardingDelta,
  decideOnboardingDelta,
  getOnboardingDelta,
  listOnboardingDeltas,
} from "../../../application/onboarding-deltas";
import {
  prepareOnboardingDeltaEffect,
  getOnboardingDeltaProposal,
  approveOnboardingDeltaEffect,
  executeOnboardingDeltaEffect,
} from "../../../application/onboarding-delta-effects";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const OnboardingDeltaHandlers = HttpApiBuilder.group(Api, "onboardingDeltas", (handlers) =>
  handlers
    .handle("compareOnboardingDelta", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        compareOnboardingDelta(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listOnboardingDeltas", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listOnboardingDeltas(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("getOnboardingDelta", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getOnboardingDelta(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("prepareOnboardingDeltaEffect", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareOnboardingDeltaEffect(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getOnboardingDeltaProposal", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getOnboardingDeltaProposal(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("approveOnboardingDeltaEffect", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveOnboardingDeltaEffect(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeOnboardingDeltaEffect", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeOnboardingDeltaEffect(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("decideOnboardingDelta", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        decideOnboardingDelta(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);

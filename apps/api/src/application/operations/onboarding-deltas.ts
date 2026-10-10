import { Api } from "@open-erp/contracts/api";

import {
  compareOnboardingDelta,
  decideOnboardingDelta,
  getOnboardingDelta,
  listOnboardingDeltas,
} from "../onboarding/index";
import {
  prepareOnboardingDeltaEffect,
  getOnboardingDeltaProposal,
  approveOnboardingDeltaEffect,
  executeOnboardingDeltaEffect,
} from "../onboarding/index";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const OnboardingDeltaOperations = {
  decideOnboardingDelta: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.decideOnboardingDelta,
    (token, { params, headers, payload }) =>
      decideOnboardingDelta(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeOnboardingDeltaEffect: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.executeOnboardingDeltaEffect,
    (token, { params, headers, payload }) =>
      executeOnboardingDeltaEffect(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveOnboardingDeltaEffect: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.approveOnboardingDeltaEffect,
    (token, { params, headers, payload }) =>
      approveOnboardingDeltaEffect(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getOnboardingDeltaProposal: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.getOnboardingDeltaProposal,
    (token, { params }) =>
      getOnboardingDeltaProposal(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  prepareOnboardingDeltaEffect: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.prepareOnboardingDeltaEffect,
    (token, { params, headers, payload }) =>
      prepareOnboardingDeltaEffect(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getOnboardingDelta: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.getOnboardingDelta,
    (token, { params }) =>
      getOnboardingDelta(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  listOnboardingDeltas: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.listOnboardingDeltas,
    (token, { params }) => listOnboardingDeltas(token, { scope: scopeFromPath(params) }),
  ),
  compareOnboardingDelta: defineHttpOperation(
    Api.groups.onboardingDeltas.endpoints.compareOnboardingDelta,
    (token, { params, headers, payload }) =>
      compareOnboardingDelta(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};

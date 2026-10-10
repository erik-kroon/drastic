import { startOnboardingImport } from "../onboarding/index";
import * as ImportBatches from "../onboarding/index";
import { prepareOnboardingImportPlan } from "../onboarding/index";
import { getOnboardingActivationArtifact } from "../onboarding/index";
import { Api } from "@open-erp/contracts/api";

import * as Onboarding from "../onboarding/index";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const OnboardingOperations = {
  getOnboarding: defineHttpOperation(
    Api.groups.onboarding.endpoints.getOnboarding,
    (token, { params, query }) =>
      Onboarding.getOnboarding(token, { scope: scopeFromPath(params), ...query }),
  ),
  getOnboardingHistory: defineHttpOperation(
    Api.groups.onboarding.endpoints.getOnboardingHistory,
    (token, { params, query }) =>
      Onboarding.getOnboardingHistory(token, { scope: scopeFromPath(params), ...query }),
  ),
  attachOnboardingSource: defineHttpOperation(
    Api.groups.onboarding.endpoints.attachOnboardingSource,
    (token, { params, headers, payload }) =>
      Onboarding.attachOnboardingSource(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  saveOnboarding: defineHttpOperation(
    Api.groups.onboarding.endpoints.saveOnboarding,
    (token, { params, headers, payload }) =>
      Onboarding.saveOnboarding(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  startOnboarding: defineHttpOperation(
    Api.groups.onboarding.endpoints.startOnboarding,
    (token, { params, headers, payload }) =>
      Onboarding.startOnboarding(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getOnboardingLifecycle: defineHttpOperation(
    Api.groups.onboarding.endpoints.getOnboardingLifecycle,
    (token, { params }) =>
      Onboarding.getOnboardingLifecycle(token, { scope: scopeFromPath(params) }),
  ),
  completeOnboardingFirstPeriod: defineHttpOperation(
    Api.groups.onboarding.endpoints.completeOnboardingFirstPeriod,
    (token, { params, headers, payload }) =>
      Onboarding.completeOnboardingFirstPeriod(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  requestOnboardingActivation: defineHttpOperation(
    Api.groups.onboarding.endpoints.requestOnboardingActivation,
    (token, { params, headers, payload }) =>
      Onboarding.requestOnboardingActivation(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  decideOnboardingSnapshot: defineHttpOperation(
    Api.groups.onboarding.endpoints.decideOnboardingSnapshot,
    (token, { params, headers, payload }) =>
      Onboarding.decideOnboardingSnapshot(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  captureOnboardingSnapshot: defineHttpOperation(
    Api.groups.onboarding.endpoints.captureOnboardingSnapshot,
    (token, { params, headers, payload }) =>
      Onboarding.captureOnboardingSnapshot(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  saveOnboardingResponsibilities: defineHttpOperation(
    Api.groups.onboarding.endpoints.saveOnboardingResponsibilities,
    (token, { params, headers, payload }) =>
      Onboarding.saveOnboardingResponsibilities(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  qualifyOnboardingControl: defineHttpOperation(
    Api.groups.onboarding.endpoints.qualifyOnboardingControl,
    (token, { params, headers, payload }) =>
      Onboarding.qualifyOnboardingControl(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getOnboardingActivationArtifact: defineHttpOperation(
    Api.groups.onboarding.endpoints.getOnboardingActivationArtifact,
    (token, { params }) => getOnboardingActivationArtifact(token, { scope: scopeFromPath(params) }),
  ),
  prepareOnboardingImportPlan: defineHttpOperation(
    Api.groups.onboarding.endpoints.prepareOnboardingImportPlan,
    (token, { params, headers, payload }) =>
      prepareOnboardingImportPlan(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  startOnboardingImport: defineHttpOperation(
    Api.groups.onboarding.endpoints.startOnboardingImport,
    (token, { params, headers, payload }) =>
      startOnboardingImport(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeOnboardingImportBatch: defineHttpOperation(
    Api.groups.onboarding.endpoints.executeOnboardingImportBatch,
    (token, { params, headers, payload }) =>
      ImportBatches.executeOnboardingImportBatch(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveOnboardingImportBatch: defineHttpOperation(
    Api.groups.onboarding.endpoints.approveOnboardingImportBatch,
    (token, { params, headers, payload }) =>
      ImportBatches.approveOnboardingImportBatch(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareOnboardingImportBatch: defineHttpOperation(
    Api.groups.onboarding.endpoints.prepareOnboardingImportBatch,
    (token, { params, headers, payload }) =>
      ImportBatches.prepareOnboardingImportBatch(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getOnboardingImportBatch: defineHttpOperation(
    Api.groups.onboarding.endpoints.getOnboardingImportBatch,
    (token, { params, query }) =>
      ImportBatches.getOnboardingImportBatch(token, {
        scope: scopeFromPath(params),
        financialRunId: query.financialRunId,
      }),
  ),
};

import { startOnboardingImport } from "../../../application/onboarding-import-start";
import * as ImportBatches from "../../../application/onboarding-import-batches";
import { prepareOnboardingImportPlan } from "../../../application/onboarding-import-plan";
import { getOnboardingActivationArtifact } from "../../../application/onboarding-receipt";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Onboarding from "../../../application/onboarding";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const OnboardingHandlers = HttpApiBuilder.group(Api, "onboarding", (handlers) =>
  handlers
    .handle("getOnboardingImportBatch", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        ImportBatches.getOnboardingImportBatch(token, {
          scope: scopeFromPath(params),
          financialRunId: query.financialRunId,
        }),
      ),
    )
    .handle("prepareOnboardingImportBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ImportBatches.prepareOnboardingImportBatch(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveOnboardingImportBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ImportBatches.approveOnboardingImportBatch(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeOnboardingImportBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ImportBatches.executeOnboardingImportBatch(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("startOnboardingImport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        startOnboardingImport(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareOnboardingImportPlan", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareOnboardingImportPlan(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getOnboardingActivationArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getOnboardingActivationArtifact(token, { scope: scopeFromPath(params) }),
      ),
    )
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
      ),
    )
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

import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { approveCorrectionBundle } from "../../../application/posting-corrections";

export const CorrectionHandlers = HttpApiBuilder.group(Api, "corrections", (handlers) =>
  handlers
    .handle("prepareCorrectionImpact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_review_impact.execute(token, {
          scope: scopeFromPath(params),
          voucherId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCorrectionImpact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_get_impact.execute(token, {
          scope: scopeFromPath(params),
          impactId: params.id,
        }),
      ),
    )
    .handle("getCorrectionChain", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_chain.execute(token, {
          scope: scopeFromPath(params),
          voucherId: params.id,
        }),
      ),
    )
    .handle("listCorrectionBundles", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_list.execute(token, {
          scope: scopeFromPath(params),
          after: page.after,
        }),
      ),
    )
    .handle("recoverCorrectionRequest", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_recover_request.execute(token, {
          scope: scopeFromPath(params),
          key: params.key,
        }),
      ),
    )
    .handle("prepareCorrectionBundle", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_prepare.execute(token, {
          scope: scopeFromPath(params),
          voucherId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCorrectionBundle", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_get.execute(token, {
          scope: scopeFromPath(params),
          bundleId: params.id,
        }),
      ),
    )
    .handle("getCorrectionBundleForVoucher", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_for_voucher.execute(token, {
          scope: scopeFromPath(params),
          voucherId: params.id,
        }),
      ),
    )
    .handle("approveCorrectionBundle", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveCorrectionBundle(token, {
          scope: scopeFromPath(params),
          bundleId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCorrectionBundle", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.corrections_execute.execute(token, {
          scope: scopeFromPath(params),
          bundleId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);

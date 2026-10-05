import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import * as Sie from "../../../application/sie/import";

export const SieImportHandlers = HttpApiBuilder.group(Api, "sieImport", (handlers) =>
  handlers
    .handle("listSieSourcePreviews", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.listSourcePreviews(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("captureSieSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.captureSource(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          input: { encoding: payload.encoding, profile: payload.profile ?? "sie4_source_v1" },
        }),
      ),
    )
    .handle("getSieSource", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.getSource(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("sealSieSourcePlan", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.sealSourcePlan(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          input: payload,
        }),
      ),
    )
    .handle("getSieSourcePlan", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.getSourcePlan(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("startSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.startSourceRun(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          digest: payload.digest,
        }),
      ),
    )
    .handle("getSieSourceRun", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.getSourceRun(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("advanceSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.advanceSourceRun(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          input: payload,
        }),
      ),
    )
    .handle("reclaimSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.reclaimSourceRun(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          action: payload.action,
        }),
      ),
    ),
);

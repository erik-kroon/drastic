import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import {
  prepareFilingIntent,
  authorizeFiling,
  uploadFiling,
  certifyFiling,
  collectFiling,
  retainFilingObservation,
  getFiling,
  filingHistory,
} from "../../../application/documents/filing";

import {
  captureFilingAdoption,
  reviewFilingAdoption,
} from "../../../application/documents/adoption";

export const FilingLifecycleHandlers = HttpApiBuilder.group(Api, "filingLifecycle", (handlers) =>
  handlers
    .handle("captureFilingAdoption", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        captureFilingAdoption(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviewFilingAdoption", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        reviewFilingAdoption(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("retainFilingObservation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        retainFilingObservation(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareFilingIntent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareFilingIntent(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("authorizeFiling", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        authorizeFiling(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("uploadFiling", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        uploadFiling(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("certifyFiling", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        certifyFiling(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("collectFiling", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        collectFiling(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getFiling", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getFiling(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("filingHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        filingHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);

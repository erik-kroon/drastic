import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  appendSyncPage,
  claimSyncWindow,
  publishSyncGeneration,
  readSyncWindow,
} from "../../../application/banking/sync-windows";

// The complete sync window over the existing bank connector owner. A claim
// fences the stream and resumes or opens a generation, a page append retains
// the exact response bytes under the current fence, and a publication marks
// one complete generation visible. No provider call happens inside any of
// these; the persistent job owns the HTTP call and the page loop.
export const BankSyncWindowsHandlers = HttpApiBuilder.group(Api, "bankSyncWindows", (handlers) =>
  handlers
    .handle("claimSyncWindow", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        claimSyncWindow(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("appendSyncPage", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        appendSyncPage(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("publishSyncGeneration", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        publishSyncGeneration(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("readSyncWindow", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        readSyncWindow(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);

import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  admitProviderObservation,
  applyProviderRevision,
  readProviderObservation,
} from "../../../application/banking/source-revisions";

// Provider revisions over the connector and sync-window owners. The amount is
// derived from the retained provider bytes, never taken from the request, and
// admission adopts an existing statement-backed observation rather than
// creating one. Nothing here posts, matches or reverses.
export const BankSourceRevisionsHandlers = HttpApiBuilder.group(
  Api,
  "bankSourceRevisions",
  (handlers) =>
    handlers
      .handle("applyProviderRevision", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          applyProviderRevision(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("admitProviderObservation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          admitProviderObservation(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("readProviderObservation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          readProviderObservation(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      ),
);

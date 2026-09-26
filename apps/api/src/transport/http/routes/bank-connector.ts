import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  getConnectorBatch,
  getConnectorConsent,
  ingestConnectorBatch,
  listConnectorBatches,
  listConnectorConsents,
  listConnectorFeeds,
  recoverConnectorBatch,
  revokeConnectorConsent,
  saveConnectorConsent,
} from "../../../application/banking/connector";

export const BankConnectorHandlers = HttpApiBuilder.group(Api, "bankConnector", (handlers) =>
  handlers
    .handle("listConnectorFeeds", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        listConnectorFeeds(token, {
          scope: scopeFromPath(params),
          cursor: search.cursor,
          consentId: search.consentId,
        }),
      ),
    )
    .handle("listConnectorConsents", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        listConnectorConsents(token, { scope: scopeFromPath(params), cursor: search.cursor }),
      ),
    )
    .handle("listConnectorBatches", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        listConnectorBatches(token, {
          scope: scopeFromPath(params),
          consentId: params.id,
          cursor: search.cursor,
        }),
      ),
    )
    .handle("recoverConnectorBatch", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        recoverConnectorBatch(token, { scope: scopeFromPath(params), key: params.key }),
      ),
    )
    .handle("saveConnectorConsent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        saveConnectorConsent(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getConnectorConsent", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getConnectorConsent(token, { scope: scopeFromPath(params), consentId: params.id }),
      ),
    )
    .handle("revokeConnectorConsent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        revokeConnectorConsent(token, {
          scope: scopeFromPath(params),
          consentId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ingestConnectorBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ingestConnectorBatch(token, {
          scope: scopeFromPath(params),
          consentId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getConnectorBatch", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getConnectorBatch(token, { scope: scopeFromPath(params), batchId: params.id }),
      ),
    ),
);

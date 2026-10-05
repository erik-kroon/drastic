import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import {
  captureDocumentGovernance,
  reviewDocumentGovernance,
} from "../../../application/documents/support";
import { validateSignatureDocument } from "../../../application/documents/validation";
import {
  prepareDocumentManifest,
  prepareDocumentSignature,
  startDocumentSignature,
  collectDocumentSignature,
  retainDocumentSignature,
  getDocumentSignatureManifest,
  getDocumentSignatureIntent,
} from "../../../application/documents/signatures";

export const DocumentSignatureHandlers = HttpApiBuilder.group(
  Api,
  "documentSignatures",
  (handlers) =>
    handlers
      .handle("captureDocumentGovernance", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          captureDocumentGovernance(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("reviewDocumentGovernance", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          reviewDocumentGovernance(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("validateSignatureDocument", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          validateSignatureDocument(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("prepareDocumentManifest", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareDocumentManifest(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("prepareDocumentSignature", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareDocumentSignature(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("startDocumentSignature", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          startDocumentSignature(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("collectDocumentSignature", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          collectDocumentSignature(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("retainDocumentSignature", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          retainDocumentSignature(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getDocumentSignatureManifest", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getDocumentSignatureManifest(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("getDocumentSignatureIntent", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getDocumentSignatureIntent(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      ),
);

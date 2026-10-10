import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { captureDocumentGovernance, reviewDocumentGovernance } from "../documents/support";
import { validateSignatureDocument } from "../documents/validation";
import {
  prepareDocumentManifest,
  prepareDocumentSignature,
  startDocumentSignature,
  collectDocumentSignature,
  retainDocumentSignature,
} from "../documents/signatures";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const DocumentSignatureOperations = {
  getDocumentSignatureIntent: bindHttpOperation(
    Api.groups.documentSignatures.endpoints.getDocumentSignatureIntent,
    capabilities.documents_get_signature_intent,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getDocumentSignatureManifest: bindHttpOperation(
    Api.groups.documentSignatures.endpoints.getDocumentSignatureManifest,
    capabilities.documents_get_signature_manifest,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  retainDocumentSignature: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.retainDocumentSignature,
    (token, { params, headers, payload }) =>
      retainDocumentSignature(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  collectDocumentSignature: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.collectDocumentSignature,
    (token, { params, headers, payload }) =>
      collectDocumentSignature(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  startDocumentSignature: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.startDocumentSignature,
    (token, { params, headers, payload }) =>
      startDocumentSignature(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareDocumentSignature: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.prepareDocumentSignature,
    (token, { params, headers, payload }) =>
      prepareDocumentSignature(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareDocumentManifest: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.prepareDocumentManifest,
    (token, { params, headers, payload }) =>
      prepareDocumentManifest(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  validateSignatureDocument: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.validateSignatureDocument,
    (token, { params, headers, payload }) =>
      validateSignatureDocument(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reviewDocumentGovernance: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.reviewDocumentGovernance,
    (token, { params, headers, payload }) =>
      reviewDocumentGovernance(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  captureDocumentGovernance: defineHttpOperation(
    Api.groups.documentSignatures.endpoints.captureDocumentGovernance,
    (token, { params, headers, payload }) =>
      captureDocumentGovernance(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};

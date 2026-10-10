import { Api } from "@open-erp/contracts/api";

import * as Owner from "../commerce/peppol-exchange";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const PeppolExchangeOperations = {
  getPeppolInbound: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.getPeppolInbound,
    (token, { params }) => Owner.getPeppolInbound(token, scopeFromPath(params), params.id),
  ),
  receivePeppolEnvelope: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.receivePeppolEnvelope,
    (token, { params, headers, payload }) =>
      Owner.receivePeppolEnvelope(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  collectPeppolOutcome: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.collectPeppolOutcome,
    (token, { params, headers, payload }) =>
      Owner.collectPeppolOutcome(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        attemptId: params.id,
        input: payload,
      }),
  ),
  getPeppolAttempt: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.getPeppolAttempt,
    (token, { params }) => Owner.getPeppolAttempt(token, scopeFromPath(params), params.id),
  ),
  dispatchPeppolExchange: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.dispatchPeppolExchange,
    (token, { params, headers, payload }) =>
      Owner.dispatchPeppolExchange(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        artifactId: params.id,
        input: payload,
      }),
  ),
  approvePeppolExchange: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.approvePeppolExchange,
    (token, { params, headers, payload }) =>
      Owner.approvePeppolExchange(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        artifactId: params.id,
        input: payload,
      }),
  ),
  getPeppolArtifact: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.getPeppolArtifact,
    (token, { params }) => Owner.getPeppolArtifact(token, scopeFromPath(params), params.id),
  ),
  preparePeppolArtifact: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.preparePeppolArtifact,
    (token, { params, headers, payload }) =>
      Owner.preparePeppolArtifact(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getPeppolBinding: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.getPeppolBinding,
    (token, { params }) => Owner.getPeppolBinding(token, scopeFromPath(params), params.id),
  ),
  registerPeppolBinding: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.registerPeppolBinding,
    (token, { params, headers, payload }) =>
      Owner.registerPeppolBinding(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  returnPeppolReview: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.returnPeppolReview,
    (token, { params, headers, payload }) =>
      Owner.returnPeppolReview(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  listPeppolReviews: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.listPeppolReviews,
    (token, { params, query }) => Owner.listPeppolReviews(token, scopeFromPath(params), query),
  ),
  getPeppolReview: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.getPeppolReview,
    (token, { params }) => Owner.getPeppolReview(token, scopeFromPath(params), params.id),
  ),
  preparePeppolReview: defineHttpOperation(
    Api.groups.peppolExchange.endpoints.preparePeppolReview,
    (token, { params, headers, payload }) =>
      Owner.preparePeppolReview(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};

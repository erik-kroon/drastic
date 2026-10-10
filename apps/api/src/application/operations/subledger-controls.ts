import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Controls from "../subledger/controls";
import * as Valuations from "../subledger/valuations";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SubledgerControlsOperations = {
  listSubledgerControls: bindHttpOperation(
    Api.groups.subledgerControls.endpoints.listSubledgerControls,
    capabilities.subledger_list_controls,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getSubledgerControl: bindHttpOperation(
    Api.groups.subledgerControls.endpoints.getSubledgerControl,
    capabilities.subledger_get_control,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  createSubledgerControl: bindHttpOperation(
    Api.groups.subledgerControls.endpoints.createSubledgerControl,
    capabilities.subledger_create_control,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listSubledgerBases: bindHttpOperation(
    Api.groups.subledgerControls.endpoints.listSubledgerBases,
    capabilities.subledger_list_bases,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getSubledgerBasis: bindHttpOperation(
    Api.groups.subledgerControls.endpoints.getSubledgerBasis,
    capabilities.subledger_get_basis,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  recordSubledgerBasis: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.recordSubledgerBasis,
    (token, { params, headers, payload }) =>
      Controls.recordBasis(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listAssetDisposalReviews: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.listAssetDisposalReviews,
    (token, { params }) =>
      Controls.listDisposalReviews(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getAssetDisposalReview: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.getAssetDisposalReview,
    (token, { params }) =>
      Controls.getDisposalReview(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeAssetDisposal: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.executeAssetDisposal,
    (token, { params, headers, payload }) =>
      Controls.executeDisposal(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveAssetDisposal: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.approveAssetDisposal,
    (token, { params, headers, payload }) =>
      Controls.approveDisposal(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareAssetDisposal: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.prepareAssetDisposal,
    (token, { params, headers, payload }) =>
      Controls.prepareDisposal(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listAssetImpairmentReviews: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.listAssetImpairmentReviews,
    (token, { params }) =>
      Controls.listImpairmentReviews(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getAssetImpairmentReview: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.getAssetImpairmentReview,
    (token, { params }) =>
      Controls.getImpairmentReview(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeAssetImpairment: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.executeAssetImpairment,
    (token, { params, headers, payload }) =>
      Controls.executeImpairment(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveAssetImpairment: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.approveAssetImpairment,
    (token, { params, headers, payload }) =>
      Controls.approveImpairment(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareAssetImpairment: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.prepareAssetImpairment,
    (token, { params, headers, payload }) =>
      Controls.prepareImpairment(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getAssetValuation: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.getAssetValuation,
    (token, { params }) => Valuations.get(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  listAssetValuations: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.listAssetValuations,
    (token, { params }) => Valuations.list(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeAssetValuation: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.executeAssetValuation,
    (token, { params, headers, payload }) =>
      Valuations.execute(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveAssetValuation: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.approveAssetValuation,
    (token, { params, headers, payload }) =>
      Valuations.approve(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareAssetValuation: defineHttpOperation(
    Api.groups.subledgerControls.endpoints.prepareAssetValuation,
    (token, { params, headers, payload }) =>
      Valuations.prepare(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};

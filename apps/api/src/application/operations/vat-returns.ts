import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Vat from "../vat/returns";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const VatReturnsOperations = {
  listActualVatReturns: bindHttpOperation(
    Api.groups.vatReturns.endpoints.listActualVatReturns,
    capabilities.vat_return_list_actuals,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getActualVatReturn: bindHttpOperation(
    Api.groups.vatReturns.endpoints.getActualVatReturn,
    capabilities.vat_return_get_actual,
    ({ params }) => ({ scope: scopeFromPath(params), returnId: params.id }),
  ),
  prepareActualVatReturn: bindHttpOperation(
    Api.groups.vatReturns.endpoints.prepareActualVatReturn,
    capabilities.vat_return_prepare_actual,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listVatDrafts: bindHttpOperation(
    Api.groups.vatReturns.endpoints.listVatDrafts,
    capabilities.vat_return_list_drafts,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getVatDraft: bindHttpOperation(
    Api.groups.vatReturns.endpoints.getVatDraft,
    capabilities.vat_return_get_draft,
    ({ params }) => ({ scope: scopeFromPath(params), draftId: params.id }),
  ),
  prepareVatDraft: bindHttpOperation(
    Api.groups.vatReturns.endpoints.prepareVatDraft,
    capabilities.vat_return_prepare_draft,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getVatFact: bindHttpOperation(
    Api.groups.vatReturns.endpoints.getVatFact,
    capabilities.vat_return_get_fact,
    ({ params }) => ({ scope: scopeFromPath(params), factId: params.id }),
  ),
  vatReturnBasis: bindHttpOperation(
    Api.groups.vatReturns.endpoints.vatReturnBasis,
    capabilities.vat_return_basis,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  recordVatFact: defineHttpOperation(
    Api.groups.vatReturns.endpoints.recordVatFact,
    (token, { params, headers, payload }) =>
      Vat.recordFact(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listVatAmendments: bindHttpOperation(
    Api.groups.vatReturns.endpoints.listVatAmendments,
    capabilities.vat_return_list_amendments,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getVatAmendment: bindHttpOperation(
    Api.groups.vatReturns.endpoints.getVatAmendment,
    capabilities.vat_return_get_amendment,
    ({ params }) => ({ scope: scopeFromPath(params), amendmentId: params.id }),
  ),
  reviewVatAmendment: defineHttpOperation(
    Api.groups.vatReturns.endpoints.reviewVatAmendment,
    (token, { params, headers, payload }) =>
      Vat.reviewAmendment(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  compareVatDrafts: bindHttpOperation(
    Api.groups.vatReturns.endpoints.compareVatDrafts,
    capabilities.vat_return_compare_drafts,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
  withdrawVatFact: defineHttpOperation(
    Api.groups.vatReturns.endpoints.withdrawVatFact,
    (token, { params, headers, payload }) =>
      Vat.withdrawFact(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recoverVatControlReclassification: bindHttpOperation(
    Api.groups.vatReturns.endpoints.recoverVatControlReclassification,
    capabilities.vat_return_recover_reclassification,
    ({ params }) => ({ scope: scopeFromPath(params), key: params.key }),
  ),
  listVatControlReclassifications: defineHttpOperation(
    Api.groups.vatReturns.endpoints.listVatControlReclassifications,
    (token, { params }) => Vat.listReclassifications(token, { scope: scopeFromPath(params) }),
  ),
  getVatControlReclassification: defineHttpOperation(
    Api.groups.vatReturns.endpoints.getVatControlReclassification,
    (token, { params }) =>
      Vat.getReclassification(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeVatControlReclassification: defineHttpOperation(
    Api.groups.vatReturns.endpoints.executeVatControlReclassification,
    (token, { params, headers, payload }) =>
      Vat.executeReclassification(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveVatControlReclassification: defineHttpOperation(
    Api.groups.vatReturns.endpoints.approveVatControlReclassification,
    (token, { params, headers, payload }) =>
      Vat.approveReclassification(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareVatControlReclassification: defineHttpOperation(
    Api.groups.vatReturns.endpoints.prepareVatControlReclassification,
    (token, { params, headers, payload }) =>
      Vat.prepareReclassification(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};

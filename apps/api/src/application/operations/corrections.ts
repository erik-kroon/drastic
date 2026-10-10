import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import { approveCorrectionBundle } from "../posting-corrections";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const CorrectionOperations = {
  executeCorrectionBundle: bindHttpOperation(
    Api.groups.corrections.endpoints.executeCorrectionBundle,
    capabilities.corrections_execute,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      bundleId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approveCorrectionBundle: defineHttpOperation(
    Api.groups.corrections.endpoints.approveCorrectionBundle,
    (token, { params, headers, payload }) =>
      approveCorrectionBundle(token, {
        scope: scopeFromPath(params),
        bundleId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getCorrectionBundleForVoucher: bindHttpOperation(
    Api.groups.corrections.endpoints.getCorrectionBundleForVoucher,
    capabilities.corrections_for_voucher,
    ({ params }) => ({
      scope: scopeFromPath(params),
      voucherId: params.id,
    }),
  ),
  getCorrectionBundle: bindHttpOperation(
    Api.groups.corrections.endpoints.getCorrectionBundle,
    capabilities.corrections_get,
    ({ params }) => ({
      scope: scopeFromPath(params),
      bundleId: params.id,
    }),
  ),
  prepareCorrectionBundle: bindHttpOperation(
    Api.groups.corrections.endpoints.prepareCorrectionBundle,
    capabilities.corrections_prepare,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      voucherId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  recoverCorrectionRequest: bindHttpOperation(
    Api.groups.corrections.endpoints.recoverCorrectionRequest,
    capabilities.corrections_recover_request,
    ({ params }) => ({
      scope: scopeFromPath(params),
      key: params.key,
    }),
  ),
  listCorrectionBundles: bindHttpOperation(
    Api.groups.corrections.endpoints.listCorrectionBundles,
    capabilities.corrections_list,
    ({ params, query: page }) => ({
      scope: scopeFromPath(params),
      after: page.after,
    }),
  ),
  getCorrectionChain: bindHttpOperation(
    Api.groups.corrections.endpoints.getCorrectionChain,
    capabilities.corrections_chain,
    ({ params }) => ({
      scope: scopeFromPath(params),
      voucherId: params.id,
    }),
  ),
  getCorrectionImpact: bindHttpOperation(
    Api.groups.corrections.endpoints.getCorrectionImpact,
    capabilities.corrections_get_impact,
    ({ params }) => ({
      scope: scopeFromPath(params),
      impactId: params.id,
    }),
  ),
  prepareCorrectionImpact: bindHttpOperation(
    Api.groups.corrections.endpoints.prepareCorrectionImpact,
    capabilities.corrections_review_impact,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      voucherId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

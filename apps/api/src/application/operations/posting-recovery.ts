import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import { runPostingAuthorityRequest, savePostingAuthorityRequest } from "../posting-recovery";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const PostingRecoveryOperations = {
  recoverPostingRequest: bindHttpOperation(
    Api.groups.postingRecovery.endpoints.recoverPostingRequest,
    capabilities.posting_recover_request,
    ({ params }) => ({
      scope: scopeFromPath(params),
      key: params.key,
    }),
  ),
  getPostingRecovery: bindHttpOperation(
    Api.groups.postingRecovery.endpoints.getPostingRecovery,
    capabilities.posting_get_recovery,
    ({ params, query: page }) => ({
      scope: scopeFromPath(params),
      changeSetId: params.id,
      after: page.after,
    }),
  ),
  listPostingRecovery: bindHttpOperation(
    Api.groups.postingRecovery.endpoints.listPostingRecovery,
    capabilities.posting_list_recovery,
    ({ params, query: page }) => ({
      scope: scopeFromPath(params),
      after: page.after,
    }),
  ),
  runPostingAuthorityRequest: defineHttpOperation(
    Api.groups.postingRecovery.endpoints.runPostingAuthorityRequest,
    (token, { params }) =>
      runPostingAuthorityRequest(token, { scope: scopeFromPath(params), key: params.key }),
  ),
  savePostingAuthorityRequest: defineHttpOperation(
    Api.groups.postingRecovery.endpoints.savePostingAuthorityRequest,
    (token, { params, headers, payload }) =>
      savePostingAuthorityRequest(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        command: payload,
      }),
  ),
  listSavedPostingRequests: bindHttpOperation(
    Api.groups.postingRecovery.endpoints.listSavedPostingRequests,
    capabilities.posting_list_saved_requests,
    ({ params, query: page }) => ({
      scope: scopeFromPath(params),
      after: page.after,
    }),
  ),
  getSavedPostingRequest: bindHttpOperation(
    Api.groups.postingRecovery.endpoints.getSavedPostingRequest,
    capabilities.posting_get_saved_request,
    ({ params }) => ({
      scope: scopeFromPath(params),
      key: params.key,
    }),
  ),
  runPostingRequest: bindHttpOperation(
    Api.groups.postingRecovery.endpoints.runPostingRequest,
    capabilities.posting_run_request,
    ({ params }) => ({
      scope: scopeFromPath(params),
      key: params.key,
    }),
  ),
  savePostingRequest: bindHttpOperation(
    Api.groups.postingRecovery.endpoints.savePostingRequest,
    capabilities.posting_save_request,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      command: payload,
    }),
  ),
};

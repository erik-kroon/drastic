import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const AccountantReviewOperations = {
  reviewPackArtifact: bindHttpOperation(
    Api.groups.accountantReview.endpoints.reviewPackArtifact,
    capabilities.accountant_review_artifact,
    ({ params }) => ({
      scope: scopeFromPath(params),
      packId: params.id,
      format: params.format,
    }),
  ),
  reviewPackRows: bindHttpOperation(
    Api.groups.accountantReview.endpoints.reviewPackRows,
    capabilities.accountant_review_rows,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      packId: params.id,
      section: params.section,
      after: query.after,
    }),
  ),
  getReviewPack: bindHttpOperation(
    Api.groups.accountantReview.endpoints.getReviewPack,
    capabilities.accountant_review_get,
    ({ params }) => ({
      scope: scopeFromPath(params),
      packId: params.id,
    }),
  ),
  listReviewPacks: bindHttpOperation(
    Api.groups.accountantReview.endpoints.listReviewPacks,
    capabilities.accountant_review_list,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      after: query.after,
    }),
  ),
  prepareReviewPack: bindHttpOperation(
    Api.groups.accountantReview.endpoints.prepareReviewPack,
    capabilities.accountant_review_prepare,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

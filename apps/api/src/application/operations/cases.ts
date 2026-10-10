import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const CaseOperations = {
  resolveReviewTarget: bindHttpOperation(
    Api.groups.cases.endpoints.resolveReviewTarget,
    capabilities.cases_resolve_review,
    ({ params }) => ({
      scope: scopeFromPath(params),
      changeSetId: params.changeSetId,
    }),
  ),
  getCaseContext: bindHttpOperation(
    Api.groups.cases.endpoints.getCaseContext,
    capabilities.cases_get_context,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      snapshotId: params.snapshotId,
      caseId: params.caseId,
      maxItems: query.maxItems,
      cursor: query.cursor,
      detail: query.detail,
    }),
  ),
  listCases: bindHttpOperation(
    Api.groups.cases.endpoints.listCases,
    capabilities.cases_list,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      snapshotId: params.snapshotId,
      maxItems: query.maxItems,
      cursor: query.cursor,
    }),
  ),
  prepareCaseSnapshot: bindHttpOperation(
    Api.groups.cases.endpoints.prepareCaseSnapshot,
    capabilities.cases_prepare_snapshot,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

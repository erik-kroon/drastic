import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const ReportStatementOperations = {
  compareStatementSnapshots: bindHttpOperation(
    Api.groups.reportStatements.endpoints.compareStatementSnapshots,
    capabilities.reports_compare_statements,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      snapshotId: params.id,
      otherId: params.otherId,
      after: query.after,
    }),
  ),
  explainStatementRow: bindHttpOperation(
    Api.groups.reportStatements.endpoints.explainStatementRow,
    capabilities.reports_explain_statement_row,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      snapshotId: params.id,
      rowId: params.rowId,
      after: query.after,
    }),
  ),
  getStatementSnapshot: bindHttpOperation(
    Api.groups.reportStatements.endpoints.getStatementSnapshot,
    capabilities.reports_get_statement,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      snapshotId: params.id,
      statement: query.statement,
      after: query.after,
    }),
  ),
  listStatementSnapshots: bindHttpOperation(
    Api.groups.reportStatements.endpoints.listStatementSnapshots,
    capabilities.reports_list_statements,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      after: query.after,
    }),
  ),
  prepareStatementSnapshot: bindHttpOperation(
    Api.groups.reportStatements.endpoints.prepareStatementSnapshot,
    capabilities.reports_prepare_statement,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

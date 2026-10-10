import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bankWorkspace } from "../banking/workspace";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const ReconciliationOperations = {
  getBankReconciliation: bindHttpOperation(
    Api.groups.reconciliation.endpoints.getBankReconciliation,
    capabilities.bank_get_reconciliation,
    ({ params }) => ({ scope: scopeFromPath(params), reconciliationId: params.id }),
  ),
  reconcileBank: bindHttpOperation(
    Api.groups.reconciliation.endpoints.reconcileBank,
    capabilities.bank_reconcile,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  matchBankObservation: bindHttpOperation(
    Api.groups.reconciliation.endpoints.matchBankObservation,
    capabilities.bank_match_observation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getBankStatement: bindHttpOperation(
    Api.groups.reconciliation.endpoints.getBankStatement,
    capabilities.bank_get_statement,
    ({ params }) => ({ scope: scopeFromPath(params), statementId: params.id }),
  ),
  importBankStatement: bindHttpOperation(
    Api.groups.reconciliation.endpoints.importBankStatement,
    capabilities.bank_import_statement,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  bankWorkspace: defineHttpOperation(
    Api.groups.reconciliation.endpoints.bankWorkspace,
    (token, { params, query: input }) =>
      bankWorkspace(token, { scope: scopeFromPath(params), input }),
  ),
};

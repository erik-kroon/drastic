import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approveBankMatchReversal,
  revokeBankMatchReversalApproval,
} from "../banking/match-reversals";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const BankMatchReversalOperations = {
  executeBankMatchReversal: bindHttpOperation(
    Api.groups.bankMatchReversals.endpoints.executeBankMatchReversal,
    capabilities.bank_execute_match_reversal,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      planId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  revokeBankMatchReversalApproval: defineHttpOperation(
    Api.groups.bankMatchReversals.endpoints.revokeBankMatchReversalApproval,
    (token, { params, headers, payload }) =>
      revokeBankMatchReversalApproval(token, {
        scope: scopeFromPath(params),
        approvalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveBankMatchReversal: defineHttpOperation(
    Api.groups.bankMatchReversals.endpoints.approveBankMatchReversal,
    (token, { params, headers, payload }) =>
      approveBankMatchReversal(token, {
        scope: scopeFromPath(params),
        planId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listBankMatchReversals: bindHttpOperation(
    Api.groups.bankMatchReversals.endpoints.listBankMatchReversals,
    capabilities.bank_list_match_reversals,
    ({ params, query: page }) => ({ scope: scopeFromPath(params), after: page.after }),
  ),
  getBankMatchReversal: bindHttpOperation(
    Api.groups.bankMatchReversals.endpoints.getBankMatchReversal,
    capabilities.bank_get_match_reversal,
    ({ params }) => ({ scope: scopeFromPath(params), planId: params.id }),
  ),
  prepareBankMatchReversal: bindHttpOperation(
    Api.groups.bankMatchReversals.endpoints.prepareBankMatchReversal,
    capabilities.bank_prepare_match_reversal,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

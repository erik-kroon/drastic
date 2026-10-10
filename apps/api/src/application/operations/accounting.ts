import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import { approveChange } from "../posting";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const AccountingOperations = {
  getReceipt: bindHttpOperation(
    Api.groups.accounting.endpoints.getReceipt,
    capabilities.receipts_get,
    ({ params }) => ({ scope: scopeFromPath(params), key: params.key }),
  ),
  ledgerSnapshot: bindHttpOperation(
    Api.groups.accounting.endpoints.ledgerSnapshot,
    capabilities.ledger_snapshot,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  listVouchers: bindHttpOperation(
    Api.groups.accounting.endpoints.listVouchers,
    capabilities.ledger_list,
    ({ params, query: page }) => ({
      scope: scopeFromPath(params),
      after: page.after,
    }),
  ),
  getVoucher: bindHttpOperation(
    Api.groups.accounting.endpoints.getVoucher,
    capabilities.ledger_get_voucher,
    ({ params }) => ({
      scope: scopeFromPath(params),
      voucherId: params.id,
    }),
  ),
  prepareCorrection: bindHttpOperation(
    Api.groups.accounting.endpoints.prepareCorrection,
    capabilities.ledger_prepare_correction,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      voucherId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  executeChange: bindHttpOperation(
    Api.groups.accounting.endpoints.executeChange,
    capabilities.changes_execute,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      changeSetId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approveChange: defineHttpOperation(
    Api.groups.accounting.endpoints.approveChange,
    (token, { params, headers, payload }) =>
      approveChange(token, {
        scope: scopeFromPath(params),
        changeSetId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  validateChange: bindHttpOperation(
    Api.groups.accounting.endpoints.validateChange,
    capabilities.changes_validate,
    ({ params, headers }) => ({
      scope: scopeFromPath(params),
      changeSetId: params.id,
      idempotencyKey: headers["idempotency-key"],
    }),
  ),
  getChange: bindHttpOperation(
    Api.groups.accounting.endpoints.getChange,
    capabilities.changes_get,
    ({ params }) => ({
      scope: scopeFromPath(params),
      changeSetId: params.id,
    }),
  ),
  prepareJournal: bindHttpOperation(
    Api.groups.accounting.endpoints.prepareJournal,
    capabilities.ledger_prepare_journal,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getEvidence: bindHttpOperation(
    Api.groups.accounting.endpoints.getEvidence,
    capabilities.evidence_get,
    ({ params }) => ({
      scope: scopeFromPath(params),
      evidenceId: params.id,
    }),
  ),
  createEvidence: bindHttpOperation(
    Api.groups.accounting.endpoints.createEvidence,
    capabilities.evidence_create,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  bookSetup: bindHttpOperation(
    Api.groups.accounting.endpoints.bookSetup,
    capabilities.book_get_setup,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  listBooks: bindHttpOperation(
    Api.groups.accounting.endpoints.listBooks,
    capabilities.book_list,
    (_request) => ({}),
  ),
  bookStatus: bindHttpOperation(
    Api.groups.accounting.endpoints.bookStatus,
    capabilities.book_get_status,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
};

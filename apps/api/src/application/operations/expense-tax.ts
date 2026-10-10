import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as ExpenseTax from "../vat/expense-tax";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const ExpenseTaxOperations = {
  listExpenseTaxSnapshots: bindHttpOperation(
    Api.groups.expenseTax.endpoints.listExpenseTaxSnapshots,
    capabilities.expense_tax_list_snapshots,
    ({ params, query: search }) => ({ scope: scopeFromPath(params), ...search }),
  ),
  getExpenseTaxSnapshot: bindHttpOperation(
    Api.groups.expenseTax.endpoints.getExpenseTaxSnapshot,
    capabilities.expense_tax_get_snapshot,
    ({ params }) => ({ scope: scopeFromPath(params), snapshotId: params.id }),
  ),
  prepareExpenseTaxSnapshot: bindHttpOperation(
    Api.groups.expenseTax.endpoints.prepareExpenseTaxSnapshot,
    capabilities.expense_tax_prepare_snapshot,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  reviewExpenseTaxSource: defineHttpOperation(
    Api.groups.expenseTax.endpoints.reviewExpenseTaxSource,
    (token, { params, headers, payload }) =>
      ExpenseTax.reviewSource(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getExpenseTaxSource: bindHttpOperation(
    Api.groups.expenseTax.endpoints.getExpenseTaxSource,
    capabilities.expense_tax_get_source,
    ({ params }) => ({ scope: scopeFromPath(params), sourceId: params.id }),
  ),
  expenseTaxInventory: bindHttpOperation(
    Api.groups.expenseTax.endpoints.expenseTaxInventory,
    capabilities.expense_tax_inventory,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  recordExpenseTaxSource: bindHttpOperation(
    Api.groups.expenseTax.endpoints.recordExpenseTaxSource,
    capabilities.expense_tax_record_source,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  withdrawExpenseTaxSource: defineHttpOperation(
    Api.groups.expenseTax.endpoints.withdrawExpenseTaxSource,
    (token, { params, headers, payload }) =>
      ExpenseTax.withdrawSource(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};

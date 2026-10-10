import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { signBankInventory } from "../banking/inventory-signoffs";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const BankInventorySignoffOperations = {
  listBankInventorySignoffs: bindHttpOperation(
    Api.groups.bankInventorySignoffs.endpoints.listBankInventorySignoffs,
    capabilities.bank_list_inventory_signoffs,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getBankInventorySignoff: bindHttpOperation(
    Api.groups.bankInventorySignoffs.endpoints.getBankInventorySignoff,
    capabilities.bank_get_inventory_signoff,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  signBankInventory: defineHttpOperation(
    Api.groups.bankInventorySignoffs.endpoints.signBankInventory,
    (token, { params, headers, payload }) =>
      signBankInventory(token, {
        scope: scopeFromPath(params),
        planId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareBankInventorySignoff: bindHttpOperation(
    Api.groups.bankInventorySignoffs.endpoints.prepareBankInventorySignoff,
    capabilities.bank_prepare_inventory_signoff,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

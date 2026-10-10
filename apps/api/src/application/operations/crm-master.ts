import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/crm-master";
import * as Defaults from "../commerce/customer-invoice-defaults";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CrmMasterOperations = {
  crmAddAnnotation: defineHttpOperation(
    Api.groups.crmMaster.endpoints.crmAddAnnotation,
    (token, { params, headers, payload }) =>
      Commerce.addAnnotation(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  crmDirectoryExport: defineHttpOperation(
    Api.groups.crmMaster.endpoints.crmDirectoryExport,
    (token, { params, query }) =>
      Commerce.readDirectoryExport(token, {
        scope: scopeFromPath(params),
        filters: { search: query.search ?? "", role: query.role ?? "", after: query.after ?? "" },
      }),
  ),
  crmDirectory: defineHttpOperation(
    Api.groups.crmMaster.endpoints.crmDirectory,
    (token, { params, query }) =>
      Commerce.readDirectory(token, {
        scope: scopeFromPath(params),
        filters: { search: query.search ?? "", role: query.role ?? "", after: query.after ?? "" },
      }),
  ),
  crmApplyCustomerInvoiceDefaults: defineHttpOperation(
    Api.groups.crmMaster.endpoints.crmApplyCustomerInvoiceDefaults,
    (token, { params, payload }) =>
      Defaults.applyCustomerInvoiceDefaults(token, {
        scope: scopeFromPath(params),
        partyId: params.partyId,
        input: payload,
      }),
  ),
  crmSaveCustomerRecipient: defineHttpOperation(
    Api.groups.crmMaster.endpoints.crmSaveCustomerRecipient,
    (token, { params, headers, payload }) =>
      Defaults.saveCustomerRecipient(token, {
        scope: scopeFromPath(params),
        partyId: params.partyId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  crmSaveCustomerInvoiceDefaults: defineHttpOperation(
    Api.groups.crmMaster.endpoints.crmSaveCustomerInvoiceDefaults,
    (token, { params, headers, payload }) =>
      Defaults.saveCustomerInvoiceDefaults(token, {
        scope: scopeFromPath(params),
        partyId: params.partyId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  crmCustomerRecipient: bindHttpOperation(
    Api.groups.crmMaster.endpoints.crmCustomerRecipient,
    capabilities.crm_get_reviewed_recipient,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      partyId: params.partyId,
      revision: query.revision,
    }),
  ),
  crmCustomerInvoiceDefaults: bindHttpOperation(
    Api.groups.crmMaster.endpoints.crmCustomerInvoiceDefaults,
    capabilities.crm_get_invoice_defaults,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      partyId: params.partyId,
      revision: query.revision,
    }),
  ),
};

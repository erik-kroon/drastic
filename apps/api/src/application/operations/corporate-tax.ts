import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import { scopeFromPath } from "../operation-scope";
import { bindHttpOperation } from "../capabilities/http-operation";

export const CorporateTaxOperations = {
  listTaxDeclarations: bindHttpOperation(
    Api.groups.corporateTax.endpoints.listTaxDeclarations,
    capabilities.tax_list_declarations,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      fiscalYearId: query.fiscalYearId,
      after: query.after,
    }),
  ),
  getTaxDeclaration: bindHttpOperation(
    Api.groups.corporateTax.endpoints.getTaxDeclaration,
    capabilities.tax_get_declaration,
    ({ params }) => ({
      scope: scopeFromPath(params),
      declarationId: params.id,
    }),
  ),
  prepareTaxDeclaration: bindHttpOperation(
    Api.groups.corporateTax.endpoints.prepareTaxDeclaration,
    capabilities.tax_prepare_declaration,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listTaxEffects: bindHttpOperation(
    Api.groups.corporateTax.endpoints.listTaxEffects,
    capabilities.tax_list_effects,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      fiscalYearId: query.fiscalYearId,
      after: query.after,
    }),
  ),
  executeTaxEffect: bindHttpOperation(
    Api.groups.corporateTax.endpoints.executeTaxEffect,
    capabilities.tax_execute_effect,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      bridgeId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listTaxBridges: bindHttpOperation(
    Api.groups.corporateTax.endpoints.listTaxBridges,
    capabilities.tax_list_bridges,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      fiscalYearId: query.fiscalYearId,
      after: query.after,
    }),
  ),
  getTaxBridge: bindHttpOperation(
    Api.groups.corporateTax.endpoints.getTaxBridge,
    capabilities.tax_get_bridge,
    ({ params }) => ({
      scope: scopeFromPath(params),
      bridgeId: params.id,
    }),
  ),
  prepareTaxBridge: bindHttpOperation(
    Api.groups.corporateTax.endpoints.prepareTaxBridge,
    capabilities.tax_prepare_bridge,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

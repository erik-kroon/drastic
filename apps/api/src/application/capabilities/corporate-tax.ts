import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  executeEffect,
  getBridge,
  getDeclaration,
  listBridges,
  listDeclarations,
  listEffects,
  prepareBridge,
  prepareDeclaration,
} from "../tax/corporate";

export const corporateTaxCapabilities = {
  tax_prepare_bridge: effectCapability(Capabilities.tax_prepare_bridge, prepareBridge),
  tax_get_bridge: effectCapability(Capabilities.tax_get_bridge, getBridge),
  tax_list_bridges: effectCapability(Capabilities.tax_list_bridges, listBridges),
  tax_execute_effect: effectCapability(Capabilities.tax_execute_effect, executeEffect),
  tax_list_effects: effectCapability(Capabilities.tax_list_effects, listEffects),
  tax_prepare_declaration: effectCapability(
    Capabilities.tax_prepare_declaration,
    prepareDeclaration,
  ),
  tax_get_declaration: effectCapability(Capabilities.tax_get_declaration, getDeclaration),
  tax_list_declarations: effectCapability(Capabilities.tax_list_declarations, listDeclarations),
};

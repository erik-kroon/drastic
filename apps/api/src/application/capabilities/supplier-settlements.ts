import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  prepareSupplierSettlement,
  getSupplierSettlement,
} from "../purchases/supplier-settlements";

export const supplierSettlementCapabilities = {
  purchases_prepare_supplier_settlement: effectCapability(
    Capabilities.purchases_prepare_supplier_settlement,
    prepareSupplierSettlement,
  ),
  purchases_get_supplier_settlement: effectCapability(
    Capabilities.purchases_get_supplier_settlement,
    getSupplierSettlement,
  ),
};

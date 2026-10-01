import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  listSupplierSettlements,
  listSupplierSettlementCancellationApprovals,
  getSupplierSettlementCancellation,
  prepareSupplierSettlement,
  getSupplierSettlement,
  executeSupplierSettlement,
  getSupplierSettlementReceipt,
  prepareSupplierSettlementCancellation,
  executeSupplierSettlementCancellation,
} from "../purchases/supplier-settlements";

export const supplierSettlementCapabilities = {
  purchases_list_supplier_settlement_cancellation_approvals: effectCapability(
    Capabilities.purchases_list_supplier_settlement_cancellation_approvals,
    listSupplierSettlementCancellationApprovals,
  ),
  purchases_list_supplier_settlements: effectCapability(
    Capabilities.purchases_list_supplier_settlements,
    listSupplierSettlements,
  ),
  purchases_get_supplier_settlement_cancellation: effectCapability(
    Capabilities.purchases_get_supplier_settlement_cancellation,
    getSupplierSettlementCancellation,
  ),
  purchases_prepare_supplier_settlement: effectCapability(
    Capabilities.purchases_prepare_supplier_settlement,
    prepareSupplierSettlement,
  ),
  purchases_get_supplier_settlement: effectCapability(
    Capabilities.purchases_get_supplier_settlement,
    getSupplierSettlement,
  ),
  purchases_execute_supplier_settlement: effectCapability(
    Capabilities.purchases_execute_supplier_settlement,
    executeSupplierSettlement,
  ),
  purchases_get_supplier_settlement_receipt: effectCapability(
    Capabilities.purchases_get_supplier_settlement_receipt,
    getSupplierSettlementReceipt,
  ),
  purchases_prepare_supplier_settlement_cancellation: effectCapability(
    Capabilities.purchases_prepare_supplier_settlement_cancellation,
    prepareSupplierSettlementCancellation,
  ),
  purchases_execute_supplier_settlement_cancellation: effectCapability(
    Capabilities.purchases_execute_supplier_settlement_cancellation,
    executeSupplierSettlementCancellation,
  ),
};

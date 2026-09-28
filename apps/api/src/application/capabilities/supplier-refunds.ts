import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getSupplierRefundPosition, supplierRefundHistory } from "../purchases/refunds";

export const supplierRefundCapabilities = {
  commerce_get_supplier_refund_position: effectCapability(
    Capabilities.commerce_get_supplier_refund_position,
    (token, input) => getSupplierRefundPosition(token, { scope: input.scope, invoiceId: input.id }),
  ),
  commerce_supplier_refund_history: effectCapability(
    Capabilities.commerce_supplier_refund_history,
    (token, input) => supplierRefundHistory(token, { scope: input.scope, invoiceId: input.id }),
  ),
};

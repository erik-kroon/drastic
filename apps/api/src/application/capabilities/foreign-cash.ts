import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../banking/foreign-cash";

export const foreignCashCapabilities = {
  banking_prepare_foreign_cash: effectCapability(
    Capabilities.banking_prepare_foreign_cash,
    Owner.prepareForeignCash,
  ),
  banking_approve_foreign_cash: effectCapability(
    Capabilities.banking_approve_foreign_cash,
    Owner.approveForeignCash,
  ),
  banking_execute_foreign_cash: effectCapability(
    Capabilities.banking_execute_foreign_cash,
    Owner.executeForeignCash,
  ),
  banking_get_foreign_cash_holding: effectCapability(
    Capabilities.banking_get_foreign_cash_holding,
    Owner.getForeignCashHolding,
  ),
  banking_get_foreign_cash_review: effectCapability(
    Capabilities.banking_get_foreign_cash_review,
    Owner.getForeignCashReview,
  ),
  banking_reconcile_foreign_cash: effectCapability(
    Capabilities.banking_reconcile_foreign_cash,
    Owner.reconcileForeignCash,
  ),
};

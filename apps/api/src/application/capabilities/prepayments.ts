import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { readAccruedCost } from "../subledger/prepayments";

// Read-only agent surface for accrued costs. An agent may ask what an accrual
// was raised for, how much remains and how it was resolved. It may not link a
// recognition to a schedule, raise an accrual or resolve one: each is a
// reviewed statement about what service was received and what it cost, and a
// resolution posts a signed true-up that must not come from an agent's
// inference about an invoice.
export const prepaymentCapabilities = {
  subledger_read_accrued_cost: effectCapability(
    Capabilities.subledger_read_accrued_cost,
    (token, input) =>
      readAccruedCost(token, {
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
      }),
  ),
};

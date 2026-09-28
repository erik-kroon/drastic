import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { resolvePaymentInstruction } from "../purchases/payment-resolutions";

// Read-only agent surface for NEXT-08 resolutions. An agent may ask what a
// retained instruction resolves to under the retained outcome chain, and may
// reach the proof, the receipt and the reason a capacity stayed reserved. It
// may not prove no-execution by itself: unknown means unknown, and a new
// agent-side assertion is not retained evidence. Replacement stays
// operator-side, because a successor needs a fresh operator-initiated export.
export const paymentResolutionCapabilities = {
  payments_resolve_instruction: effectCapability(
    Capabilities.payments_resolve_instruction,
    (token, input) => resolvePaymentInstruction(token, input),
  ),
};

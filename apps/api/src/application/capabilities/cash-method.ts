import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { readCashMethodLine } from "../commerce/cash-method";

// Read-only agent surface for cash-method lines. An agent may ask how much of
// a document is paid, how much the book has recognized, and how much remains
// commercially unpaid. It may not register a line, recognize a payment or run
// a year end: each is a reviewed statement about which accounting method a
// book uses, and the year-end run in particular decides a whole population's
// recognition at once.
export const cashMethodCapabilities = {
  commerce_read_cash_method_line: effectCapability(
    Capabilities.commerce_read_cash_method_line,
    (token, input) =>
      readCashMethodLine(token, {
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
      }),
  ),
};

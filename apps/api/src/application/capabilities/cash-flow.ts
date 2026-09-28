import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { prepareCashFlowStatement } from "../reports/cash-flow-statement";

// Read-only agent surface for NEXT-45. The capability exposes the derived
// statement and every line's evidence; it cannot make the report complete. The
// report's own completeness flag comes from retained data, and an agent that
// sees false must report it rather than summarise the statement as final.
export const cashFlowCapabilities = {
  reports_cash_flow_statement: effectCapability(
    Capabilities.reports_cash_flow_statement,
    prepareCashFlowStatement,
  ),
};

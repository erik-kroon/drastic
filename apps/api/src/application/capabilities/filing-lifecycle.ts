import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getFiling, filingHistory } from "../documents/filing";

export const filingCapabilities = {
  filings_get_submission: effectCapability(Capabilities.filings_get_submission, (token, input) =>
    getFiling(token, input),
  ),
  filings_submission_history: effectCapability(
    Capabilities.filings_submission_history,
    (token, input) => filingHistory(token, input),
  ),
};

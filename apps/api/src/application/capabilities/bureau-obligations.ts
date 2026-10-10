import { Capabilities } from "@open-erp/contracts/capabilities";
import { listBureauObligations } from "../bureau-obligations";
import { effectCapability } from "./shared";

export const bureauObligationsCapabilities = {
  bureau_list_obligations: effectCapability(
    Capabilities.bureau_list_obligations,
    listBureauObligations,
  ),
};

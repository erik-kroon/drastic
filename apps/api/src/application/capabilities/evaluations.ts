import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { captureEvaluationContract, getEvaluationContract } from "../evaluations";

export const evaluationCapabilities = {
  evaluation_capture_contract: effectCapability(
    Capabilities.evaluation_capture_contract,
    captureEvaluationContract,
  ),
  evaluation_get_contract: effectCapability(
    Capabilities.evaluation_get_contract,
    getEvaluationContract,
  ),
};

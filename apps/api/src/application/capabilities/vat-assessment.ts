import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getVatAssessmentStatus, vatAssessmentHistory } from "../vat/assessment";

export const vatAssessmentCapabilities = {
  vat_get_assessment_status: effectCapability(
    Capabilities.vat_get_assessment_status,
    (token, input) => getVatAssessmentStatus(token, { scope: input.scope, returnId: input.id }),
  ),
  vat_assessment_history: effectCapability(Capabilities.vat_assessment_history, (token, input) =>
    vatAssessmentHistory(token, { scope: input.scope, returnId: input.id }),
  ),
};

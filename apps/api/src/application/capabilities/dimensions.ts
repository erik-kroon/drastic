import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { dimensionAssignmentReport } from "../dimensions/assignments";
import { dimensionClassificationView, dimensionRestatementView } from "../dimensions/restatement";

export const dimensionCapabilities = {
  dimensions_assignment_report: effectCapability(
    Capabilities.dimensions_assignment_report,
    dimensionAssignmentReport,
  ),
  dimensions_classification_view: effectCapability(
    Capabilities.dimensions_classification_view,
    dimensionClassificationView,
  ),
  dimensions_restatement_view: effectCapability(
    Capabilities.dimensions_restatement_view,
    dimensionRestatementView,
  ),
};

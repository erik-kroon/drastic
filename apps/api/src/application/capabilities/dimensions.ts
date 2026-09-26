import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { dimensionAssignmentReport } from "../dimensions/assignments";

export const dimensionCapabilities = {
  dimensions_assignment_report: effectCapability(
    Capabilities.dimensions_assignment_report,
    dimensionAssignmentReport,
  ),
};

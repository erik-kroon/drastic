import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { annualReportHistory, getAnnualReport } from "../reports/annual-report";

export const annualReportCapabilities = {
  reports_get_annual_report: effectCapability(
    Capabilities.reports_get_annual_report,
    (token, input) => getAnnualReport(token, { scope: input.scope, draftId: input.id }),
  ),
  reports_annual_report_history: effectCapability(
    Capabilities.reports_annual_report_history,
    (token, input) => annualReportHistory(token, { scope: input.scope, fiscalYearId: input.id }),
  ),
};

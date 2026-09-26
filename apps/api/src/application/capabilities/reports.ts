import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { bookSetup, bookStatus, listBooks } from "../posting";
import {
  compareReports,
  getReport,
  getReportFamily,
  listReports,
  prepareReport,
  prepareReportFamily,
  reportExplanation,
  reportGeneralLedger,
  reportLines,
} from "../reports";
import { createRegisterReport, getRegisterReport, listRegisterReports } from "../register-reports";

export const reportCapabilities = {
  commerce_create_register_report: effectCapability(
    Capabilities.commerce_create_register_report,
    createRegisterReport,
  ),
  commerce_get_register_report: effectCapability(
    Capabilities.commerce_get_register_report,
    (token, input) => getRegisterReport(token, { scope: input.scope, reportId: input.id }),
  ),
  commerce_list_register_reports: effectCapability(
    Capabilities.commerce_list_register_reports,
    listRegisterReports,
  ),
  book_get_status: effectCapability(Capabilities.book_get_status, bookStatus),
  reports_prepare: effectCapability(Capabilities.reports_prepare, prepareReport),
  reports_prepare_family: effectCapability(
    Capabilities.reports_prepare_family,
    prepareReportFamily,
  ),
  reports_get_family: effectCapability(Capabilities.reports_get_family, getReportFamily),
  reports_list: effectCapability(Capabilities.reports_list, listReports),
  reports_get: effectCapability(Capabilities.reports_get, getReport),
  reports_lines: effectCapability(Capabilities.reports_lines, reportLines),
  reports_compare: effectCapability(Capabilities.reports_compare, compareReports),
  reports_general_ledger: effectCapability(
    Capabilities.reports_general_ledger,
    reportGeneralLedger,
  ),
  reports_explain: effectCapability(Capabilities.reports_explain, reportExplanation),
  book_list: effectCapability(Capabilities.book_list, listBooks),
  book_get_setup: effectCapability(Capabilities.book_get_setup, bookSetup),
};

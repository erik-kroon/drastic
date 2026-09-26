import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  compareStatementSnapshots,
  explainStatementRow,
  getStatementSnapshot,
  listStatementSnapshots,
  prepareStatementSnapshot,
} from "../report-statements";

export const reportStatementCapabilities = {
  reports_prepare_statement: effectCapability(
    Capabilities.reports_prepare_statement,
    prepareStatementSnapshot,
  ),
  reports_get_statement: effectCapability(Capabilities.reports_get_statement, getStatementSnapshot),
  reports_explain_statement_row: effectCapability(
    Capabilities.reports_explain_statement_row,
    explainStatementRow,
  ),
  reports_compare_statements: effectCapability(
    Capabilities.reports_compare_statements,
    compareStatementSnapshots,
  ),
  reports_list_statements: effectCapability(
    Capabilities.reports_list_statements,
    listStatementSnapshots,
  ),
};

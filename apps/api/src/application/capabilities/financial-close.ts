import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  financialCloseHistory,
  getFinancialCloseCertificate,
  getFinancialOpeningSet,
  getFinancialYearStatus,
} from "../closing/financial-close";

export const financialCloseCapabilities = {
  closing_get_financial_year_status: effectCapability(
    Capabilities.closing_get_financial_year_status,
    (token, input) => getFinancialYearStatus(token, { scope: input.scope, fiscalYearId: input.id }),
  ),
  closing_get_financial_close_certificate: effectCapability(
    Capabilities.closing_get_financial_close_certificate,
    (token, input) =>
      getFinancialCloseCertificate(token, { scope: input.scope, certificateId: input.id }),
  ),
  closing_get_financial_opening_set: effectCapability(
    Capabilities.closing_get_financial_opening_set,
    (token, input) => getFinancialOpeningSet(token, { scope: input.scope, openingSetId: input.id }),
  ),
  closing_financial_close_history: effectCapability(
    Capabilities.closing_financial_close_history,
    (token, input) => financialCloseHistory(token, { scope: input.scope, fiscalYearId: input.id }),
  ),
};

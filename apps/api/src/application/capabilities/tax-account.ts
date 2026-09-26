import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  createControl,
  getControl,
  getEventClassification,
  getMatch,
  getStatement,
  listControls,
  listMatches,
  listStatements,
  listUnclassifiedEvents,
  previewMatch,
} from "../vat/tax-account";

export const taxAccountCapabilities = {
  tax_account_preview_match: effectCapability(Capabilities.tax_account_preview_match, previewMatch),
  tax_account_get_match: effectCapability(Capabilities.tax_account_get_match, getMatch),
  tax_account_list_matches: effectCapability(Capabilities.tax_account_list_matches, listMatches),
  tax_account_list_unclassified_events: effectCapability(
    Capabilities.tax_account_list_unclassified_events,
    listUnclassifiedEvents,
  ),
  tax_account_get_event_classification: effectCapability(
    Capabilities.tax_account_get_event_classification,
    (token, input) => getEventClassification(token, { scope: input.scope, id: input.eventId }),
  ),
  tax_account_get_statement: effectCapability(Capabilities.tax_account_get_statement, getStatement),
  tax_account_list_statements: effectCapability(
    Capabilities.tax_account_list_statements,
    listStatements,
  ),
  tax_account_create_control: effectCapability(
    Capabilities.tax_account_create_control,
    createControl,
  ),
  tax_account_get_control: effectCapability(Capabilities.tax_account_get_control, getControl),
  tax_account_list_controls: effectCapability(Capabilities.tax_account_list_controls, listControls),
};

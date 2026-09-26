import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { listObligations } from "../closing/deadlines";
import { listFulfillments } from "../closing/fulfillment";
import { getImpactSnapshot, listDecisions, listImpact, listNotices } from "../closing/rule-impact";
import {
  closingHistory,
  closingReadiness,
  executeClosing,
  getClosingCertificate,
  getClosingProposal,
  listClosingProposals,
  prepareClosing,
} from "../closing/proposals";

export const closingCapabilities = {
  deadlines_list: effectCapability(Capabilities.deadlines_list, listObligations),
  deadlines_fulfillment_list: effectCapability(
    Capabilities.deadlines_fulfillment_list,
    listFulfillments,
  ),
  rules_list_change_notices: effectCapability(Capabilities.rules_list_change_notices, listNotices),
  rules_list_impact: effectCapability(Capabilities.rules_list_impact, listImpact),
  rules_get_impact_snapshot: effectCapability(
    Capabilities.rules_get_impact_snapshot,
    getImpactSnapshot,
  ),
  rules_list_impact_decisions: effectCapability(
    Capabilities.rules_list_impact_decisions,
    listDecisions,
  ),
  periods_list_closing_proposals: effectCapability(
    Capabilities.periods_list_closing_proposals,
    listClosingProposals,
  ),
  periods_closing_readiness: effectCapability(
    Capabilities.periods_closing_readiness,
    closingReadiness,
  ),
  periods_prepare_closing: effectCapability(Capabilities.periods_prepare_closing, prepareClosing),
  periods_get_closing_proposal: effectCapability(
    Capabilities.periods_get_closing_proposal,
    getClosingProposal,
  ),
  periods_execute_closing: effectCapability(Capabilities.periods_execute_closing, executeClosing),
  periods_closing_history: effectCapability(Capabilities.periods_closing_history, closingHistory),
  periods_get_closing_certificate: effectCapability(
    Capabilities.periods_get_closing_certificate,
    getClosingCertificate,
  ),
};

import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getBankInventorySignoff, listBankInventorySignoffs, prepareBankInventorySignoff } from "../banking/inventory-signoffs";
import { getBankSignoff, listBankSignoffs, prepareBankSignoff } from "../banking/signoffs";
import { createBankSourceCoverage, getBankSourceCoverage, listBankSourceCoverage } from "../banking/coverage";
import { discoverBankMatchCandidates } from "../banking/candidates";
import { executeBankMatchReversal, getBankMatchReversal, listBankMatchReversals, prepareBankMatchReversal } from "../banking/match-reversals";
import { executeBankAllocation, getBankAllocation, prepareBankAllocation } from "../banking/allocations";
import { getBankCapacityReconciliation, getBankReconciliation, reconcileBank, reconcileBankCapacity } from "../banking/reconciliations";
import { getBankStatement, importBankStatement } from "../banking/source-statement";
import { matchBankObservation } from "../banking/matches";

export const bankingCapabilities = {
  bank_prepare_inventory_signoff: effectCapability(
    Capabilities.bank_prepare_inventory_signoff,
    prepareBankInventorySignoff,
  ),
  bank_get_inventory_signoff: effectCapability(
    Capabilities.bank_get_inventory_signoff,
    (token, input) => getBankInventorySignoff(token, { scope: input.scope, planId: input.id }),
  ),
  bank_list_inventory_signoffs: effectCapability(
    Capabilities.bank_list_inventory_signoffs,
    listBankInventorySignoffs,
  ),
  bank_prepare_signoff: effectCapability(Capabilities.bank_prepare_signoff, prepareBankSignoff),
  bank_get_signoff: effectCapability(Capabilities.bank_get_signoff, (token, input) =>
    getBankSignoff(token, { scope: input.scope, planId: input.id }),
  ),
  bank_list_signoffs: effectCapability(Capabilities.bank_list_signoffs, listBankSignoffs),
  bank_create_source_coverage: effectCapability(
    Capabilities.bank_create_source_coverage,
    createBankSourceCoverage,
  ),
  bank_get_source_coverage: effectCapability(
    Capabilities.bank_get_source_coverage,
    (token, input) => getBankSourceCoverage(token, { scope: input.scope, reportId: input.id }),
  ),
  bank_list_source_coverage: effectCapability(
    Capabilities.bank_list_source_coverage,
    listBankSourceCoverage,
  ),
  bank_discover_match_candidates: effectCapability(
    Capabilities.bank_discover_match_candidates,
    discoverBankMatchCandidates,
  ),
  bank_prepare_match_reversal: effectCapability(
    Capabilities.bank_prepare_match_reversal,
    prepareBankMatchReversal,
  ),
  bank_get_match_reversal: effectCapability(
    Capabilities.bank_get_match_reversal,
    getBankMatchReversal,
  ),
  bank_list_match_reversals: effectCapability(
    Capabilities.bank_list_match_reversals,
    listBankMatchReversals,
  ),
  bank_execute_match_reversal: effectCapability(
    Capabilities.bank_execute_match_reversal,
    executeBankMatchReversal,
  ),
  bank_prepare_allocation: effectCapability(
    Capabilities.bank_prepare_allocation,
    prepareBankAllocation,
  ),
  bank_get_allocation: effectCapability(Capabilities.bank_get_allocation, getBankAllocation),
  bank_execute_allocation: effectCapability(
    Capabilities.bank_execute_allocation,
    executeBankAllocation,
  ),
  bank_reconcile_capacity: effectCapability(
    Capabilities.bank_reconcile_capacity,
    reconcileBankCapacity,
  ),
  bank_get_capacity_reconciliation: effectCapability(
    Capabilities.bank_get_capacity_reconciliation,
    getBankCapacityReconciliation,
  ),
  bank_import_statement: effectCapability(Capabilities.bank_import_statement, importBankStatement),
  bank_get_statement: effectCapability(Capabilities.bank_get_statement, getBankStatement),
  bank_match_observation: effectCapability(
    Capabilities.bank_match_observation,
    matchBankObservation,
  ),
  bank_reconcile: effectCapability(Capabilities.bank_reconcile, reconcileBank),
  bank_get_reconciliation: effectCapability(
    Capabilities.bank_get_reconciliation,
    getBankReconciliation,
  ),
};

import type { Capabilities } from "@open-erp/contracts/capabilities";

type WriteClass =
  | "record"
  | "prepare"
  | "execute_approved"
  | "human_review"
  | "administration"
  | "statutory_activation"
  | "operator_preparation"
  | "operator_execution";

// Reviewed write exposure. Read declarations are explicit in the shared contracts.
// A new write has no MCP exposure until its owner classifies it here. These classes
// describe transport policy; the operation must still enforce current authority.
const writeClasses = {
  invoice_templates_apply: "prepare",
  collections_prepare_reminder: "prepare",
  workspace_capture_context: "prepare",
  workspace_advance_context: "record",
  purchases_prepare_supplier_settlement: "prepare",
  purchases_execute_supplier_settlement: "execute_approved",
  purchases_prepare_supplier_settlement_cancellation: "prepare",
  purchases_execute_supplier_settlement_cancellation: "execute_approved",
  evaluation_capture_contract: "operator_preparation",
  runs_start_background: "prepare",
  workspace_assign_work: "administration",
  workspace_save_view: "record",
  workspace_delete_view: "record",
  firm_create: "administration",
  firm_save_client: "administration",
  firm_remove_client: "administration",
  firm_save_member: "administration",
  company_create: "administration",
  company_save_setup: "administration",
  company_record_fact: "administration",
  company_review_fact: "human_review",
  company_bind_role: "administration",
  company_prepare_activation: "operator_preparation",
  company_approve_activation: "human_review",
  company_execute_activation: "statutory_activation",
  accountant_review_prepare: "prepare",
  source_capture_review: "prepare",
  source_retain: "record",
  source_preview_csv: "prepare",
  source_reparse_csv: "prepare",
  expense_tax_record_source: "record",
  expense_tax_prepare_snapshot: "prepare",
  owners_create_owner: "record",
  owners_create_record: "record",
  owners_revise_record: "record",
  owners_attach_proposal: "record",
  owners_attach_posted_line: "record",
  owners_prepare_allocation: "prepare",
  owners_apply_allocation: "execute_approved",
  owners_prepare_control: "prepare",
  owners_prepare_operation: "prepare",
  owners_execute_operation: "execute_approved",
  commerce_create_counterparty: "record",
  commerce_revise_counterparty: "record",
  commerce_create_invoice: "record",
  commerce_revise_invoice: "record",
  commerce_prepare_allocation: "prepare",
  commerce_apply_allocation: "execute_approved",
  commerce_create_register_report: "prepare",
  reports_prepare_family: "prepare",
  reports_prepare_statement: "prepare",
  vat_return_prepare_draft: "prepare",
  vat_return_prepare_actual: "prepare",
  sie_prepare: "prepare",
  sie_resume: "prepare",
  sie4e_prepare: "prepare",
  sie4e_resume: "prepare",
  subledger_create_control: "prepare",
  fx_capture_conversion: "prepare",
  commerce_prepare_invoice_document: "prepare",
  commerce_render_customer_credit_artifact: "prepare",
  commerce_resume_invoice_document: "prepare",
  commerce_prepare_allocation_reversal: "prepare",
  commerce_execute_allocation_reversal: "execute_approved",
  periods_prepare_closing: "prepare",
  periods_execute_closing: "execute_approved",
  runs_stop_background: "record",
  schedules_create: "record",
  schedules_revise: "record",
  schedules_prepare: "prepare",
  posting_save_request: "record",
  posting_run_request: "execute_approved",
  corrections_review_impact: "prepare",
  corrections_prepare: "prepare",
  corrections_execute: "execute_approved",
  bank_prepare_allocation: "prepare",
  bank_execute_allocation: "execute_approved",
  bank_reconcile_capacity: "prepare",
  bank_prepare_match_reversal: "prepare",
  bank_execute_match_reversal: "execute_approved",
  bank_create_source_coverage: "prepare",
  cash_capture_basis: "prepare",
  cash_capture_forecast: "prepare",
  bank_prepare_signoff: "prepare",
  bank_prepare_inventory_signoff: "prepare",
  tax_account_create_control: "prepare",
  payroll_prepare_calculation: "prepare",
  payroll_prepare_run: "operator_preparation",
  payroll_approve_run: "human_review",
  payroll_execute_run: "execute_approved",
  tax_prepare_bridge: "prepare",
  tax_execute_effect: "execute_approved",
  tax_prepare_declaration: "prepare",
  rules_propose: "prepare",
  rules_simulate: "prepare",
  runs_create_preparation: "prepare",
  runs_advance: "prepare",
  period_work_prepare_manifest: "operator_preparation",
  period_work_advance: "operator_preparation",
  period_work_prepare_batch: "operator_preparation",
  // Run control, like the rest of this family. It drives a selection and produces
  // no economic effect, so it is not execution; it makes no approval either, so it
  // is not the human gesture. Withheld here, which is the family's existing
  // posture: no period-work write is an agent tool.
  period_work_cancel: "operator_preparation",
  period_work_approve_batch: "human_review",
  period_work_execute_batch: "operator_execution",
  cases_prepare_snapshot: "prepare",
  bank_import_statement: "record",
  bank_match_observation: "record",
  bank_reconcile: "prepare",
  reports_prepare: "prepare",
  evidence_create: "record",
  ledger_prepare_journal: "prepare",
  changes_validate: "prepare",
  changes_execute: "execute_approved",
  ledger_prepare_correction: "prepare",
} satisfies Partial<Record<keyof typeof Capabilities, WriteClass>>;

const writes = new Map<string, WriteClass>(Object.entries(writeClasses));

export function capabilityAgentPolicy(
  name: string,
  definition: { readonly readOnly: boolean; readonly agentCallable?: boolean },
) {
  const classification = definition.readOnly ? "read" : (writes.get(name) ?? "unclassified");

  return {
    classification,
    exposed:
      definition.agentCallable !== false &&
      (classification === "read" ||
        classification === "record" ||
        classification === "prepare" ||
        classification === "execute_approved"),
  };
}

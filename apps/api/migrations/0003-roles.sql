-- Clean database baseline: the runtime role and its grants.
--
-- openerp_runtime is the one group role the application, its API tokens and the
-- effect-mq worker connect through; every environment creates its own login in it
-- after migrating, so this file creates no login at all. What follows is the whole
-- privilege set, reproduced from the reviewed chain: table and column reads and
-- writes, effect-mq sequence use, and EXECUTE on the two canonicalization helpers
-- the application calls. No kept guard is callable and no dropped function is
-- granted, so the integrity layer is reachable only through its triggers.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openerp_runtime') THEN
    CREATE ROLE openerp_runtime NOLOGIN;
  END IF;
END $$;

-- Per-schema defaults cannot remove PostgreSQL's global PUBLIC EXECUTE default.
-- Future functions remain private until the migration owner grants access.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA openerp, openerp_auth TO openerp_runtime;

-- Reads the application issues directly.
GRANT SELECT ON TABLE openerp.accounts, openerp.periods,
  openerp.actors, openerp.ar_legal_accounting_profiles, openerp.ar_legal_delivery_approvals,
  openerp.ar_legal_delivery_attempts, openerp.ar_legal_delivery_reconciliations,
  openerp.ar_legal_delivery_requests, openerp.ar_legal_issue_approvals,
  openerp.ar_legal_issue_reviews, openerp.ar_legal_issues,
  openerp.bank_active_allocation_legs, openerp.bank_active_matches,
  openerp.bank_capacity_reconciliations, openerp.commerce_active_allocation_legs,
  openerp.credentials, openerp.fiscal_years, openerp.identity_admissions,
  openerp.invoice_cancellation_approvals, openerp.invoice_cancellation_reviews,
  openerp.invoice_cancellation_revocations, openerp.sales_document_revisions,
  openerp.sales_documents, openerp.sales_order_conversions,
  openerp.subledger_disposal_reviews, openerp.subledger_impairment_reviews TO openerp_runtime;

-- Write paths the application owns: appends, updates and deletes
-- it performs itself, kept as the reviewed chain granted them.
GRANT SELECT, INSERT ON TABLE openerp.accountant_review_artifacts, openerp.accountant_review_packs,
  openerp.accountant_review_rows, openerp.approval_consumptions,
  openerp.approvals, openerp.ar_legal_pdf_artifacts, openerp.ar_legal_pdf_captures,
  openerp.ar_legal_policies, openerp.bank_allocation_approvals,
  openerp.bank_allocation_executions, openerp.bank_allocation_legs,
  openerp.bank_allocation_plans, openerp.bank_connector_batches,
  openerp.bank_connector_consents, openerp.bank_connector_records,
  openerp.bank_inventory_signoff_plans, openerp.bank_inventory_signoffs,
  openerp.bank_match_reversal_approvals, openerp.bank_match_reversal_plans,
  openerp.bank_match_reversal_revocations, openerp.bank_match_reversals,
  openerp.bank_matches, openerp.bank_observations, openerp.bank_reconciliation_signoffs,
  openerp.bank_reconciliations, openerp.bank_signoff_plans,
  openerp.bank_source_coverage_reports, openerp.bank_sources, openerp.bank_statements,
  openerp.books, openerp.case_context_items, openerp.case_context_plans,
  openerp.case_context_snapshots, openerp.catalog_article_revisions,
  openerp.catalog_articles, openerp.change_sets, openerp.closing_approvals,
  openerp.closing_certificates, openerp.closing_invalidations, openerp.closing_inventories,
  openerp.closing_proposals, openerp.closing_transitions, openerp.collection_disputes,
  openerp.collection_events, openerp.collection_statement_artifacts,
  openerp.collection_statements, openerp.command_receipts,
  openerp.commerce_allocation_approvals, openerp.commerce_allocation_legs,
  openerp.commerce_allocation_plans, openerp.commerce_allocation_receipts,
  openerp.commerce_allocation_reversal_approvals, openerp.commerce_allocation_reversal_plans,
  openerp.commerce_allocation_reversal_revocations, openerp.commerce_allocation_reversals,
  openerp.commerce_control_accounts, openerp.commerce_counterparties,
  openerp.commerce_counterparty_revisions, openerp.commerce_fx_items,
  openerp.commerce_fx_recognition_approvals, openerp.commerce_fx_recognition_reviews,
  openerp.commerce_fx_settlement_approvals,
  openerp.commerce_fx_settlement_correction_approvals,
  openerp.commerce_fx_settlement_correction_reviews,
  openerp.commerce_fx_settlement_corrections, openerp.commerce_fx_settlement_reviews,
  openerp.commerce_fx_settlements, openerp.commerce_invoice_revisions,
  openerp.commerce_invoices, openerp.commerce_register_allocation_dependencies,
  openerp.commerce_register_snapshots, openerp.company_setup_commands,
  openerp.company_setups, openerp.correction_bundle_approvals,
  openerp.correction_bundle_receipts, openerp.correction_bundles,
  openerp.correction_impact_reviews, openerp.crm_party_annotations,
  openerp.deadline_activity_history, openerp.deadline_feeds, openerp.deadline_obligations,
  openerp.deadline_revisions, openerp.dimension_revisions, openerp.dimension_value_revisions,
  openerp.dimension_values, openerp.dimensions, openerp.entities, openerp.events,
  openerp.evidence, openerp.exchange_conversion_reviews, openerp.exchange_rate_observations,
  openerp.exchange_rate_revisions, openerp.exchange_rate_withdrawals,
  openerp.execution_receipts, openerp.expense_tax_reviews, openerp.expense_tax_snapshots,
  openerp.expense_tax_source_revisions, openerp.expense_tax_source_withdrawals,
  openerp.expense_tax_sources, openerp.firm_commands, openerp.firm_members, openerp.firms,
  openerp.intake_admissions, openerp.intake_approvals, openerp.intake_contents,
  openerp.intake_occurrences, openerp.intake_preview_supersessions, openerp.intake_previews,
  openerp.invoice_cancellations, openerp.invoice_delivery_approvals,
  openerp.invoice_delivery_attempts, openerp.invoice_delivery_requests,
  openerp.invoice_delivery_resolutions, openerp.invoice_document_artifacts,
  openerp.invoice_document_captures, openerp.invoice_draft_revisions, openerp.invoice_drafts,
  openerp.invoice_issue_approvals, openerp.invoice_issue_counters,
  openerp.invoice_issue_reviews, openerp.invoice_issues, openerp.invoice_pdf_artifacts,
  openerp.invoice_pdf_captures, openerp.invoice_policy_candidates,
  openerp.invoice_policy_reviews, openerp.journal_lines, openerp.memberships, openerp.outbox,
  openerp.owner_allocation_approvals, openerp.owner_allocation_legs,
  openerp.owner_allocation_plans, openerp.owner_allocation_receipts,
  openerp.owner_control_accounts, openerp.owner_controls, openerp.owner_effects,
  openerp.owner_parties, openerp.owner_proposal_links, openerp.owner_records,
  openerp.owner_reviews, openerp.owner_revisions, openerp.payroll_current_revisions,
  openerp.payroll_employees, openerp.payroll_revisions,
  openerp.posting_approval_revocations, openerp.posting_group_receipts,
  openerp.posting_request_outcomes, openerp.posting_saved_requests, openerp.preparation_jobs,
  openerp.preparation_run_audit, openerp.preparation_runs, openerp.recurring_activations,
  openerp.recurring_deactivations, openerp.recurring_preparations, openerp.recurring_rules,
  openerp.recurring_simulations, openerp.report_lines, openerp.report_snapshots,
  openerp.series_counters, openerp.sie_transaction_artifacts,
  openerp.sie_transaction_captures, openerp.source_review_artifacts, openerp.source_uploads,
  openerp.subledger_bases, openerp.subledger_basis_lines,
  openerp.subledger_control_snapshots, openerp.subledger_disposals,
  openerp.subledger_impairments, openerp.subledger_preparations,
  openerp.subledger_schedule_revisions, openerp.subledger_schedules,
  openerp.supplier_acceptance_approvals, openerp.supplier_acceptance_reviews,
  openerp.supplier_acceptances, openerp.supplier_credit_approvals,
  openerp.supplier_credit_reviews, openerp.supplier_credits,
  openerp.supplier_extraction_attempts, openerp.supplier_inbox,
  openerp.supplier_invoice_draft_revisions, openerp.supplier_invoice_drafts,
  openerp.supplier_payee_proposals, openerp.supplier_payee_verifications,
  openerp.supplier_payment_batch_exports, openerp.supplier_payment_batch_items,
  openerp.supplier_payment_batch_previews, openerp.supplier_payment_outcomes,
  openerp.tax_account_classification_resolutions, openerp.tax_account_controls,
  openerp.tax_account_events, openerp.tax_account_matches, openerp.tax_account_sources,
  openerp.tax_account_statements, openerp.tax_account_unmatches,
  openerp.vat_control_account_roles, openerp.vat_control_profiles,
  openerp.vat_control_reclassification_approvals,
  openerp.vat_control_reclassification_effects, openerp.vat_control_reclassification_reviews,
  openerp.vat_draft_amendments, openerp.vat_fact_components, openerp.vat_fact_revisions,
  openerp.vat_fact_withdrawals, openerp.vat_reporting_obligations, openerp.vat_return_drafts,
  openerp.vouchers, openerp.workspace_assignments TO openerp_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE openerp.firm_clients, openerp.payroll_access, openerp.tax_account_match_capacity,
  openerp.workspace_views TO openerp_runtime;
GRANT SELECT, INSERT ON TABLE openerp.vat_control_reclassification_contributions,
  openerp.sie_source_previews, openerp.sie_source_plans, openerp.sie_source_runs,
  openerp.sie_source_chunks, openerp.sie_source_vouchers TO openerp_runtime;
GRANT UPDATE (next_ordinal, fence, lease_until, status) ON TABLE openerp.sie_source_runs TO openerp_runtime;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE openerp_auth."user", openerp_auth.account, openerp_auth.rate_limit, openerp_auth.session,
  openerp_auth.verification, public.effect_mq_dedupe, public.effect_mq_flow_children,
  public.effect_mq_flow_outbox, public.effect_mq_job_attempts, public.effect_mq_jobs,
  public.effect_mq_queue_control, public.effect_mq_schedules TO openerp_runtime;

-- Column-scoped updates. The application never rewrites a whole row where only one
-- column is mutable, so each update names its column instead of granting UPDATE on
-- the table.
GRANT UPDATE (book_id) ON TABLE openerp.accountant_review_artifacts, openerp.accountant_review_packs,
  openerp.accountant_review_rows, openerp.bank_allocation_approvals,
  openerp.bank_capacity_reconciliations, openerp.bank_match_reversal_approvals,
  openerp.bank_source_coverage_reports, openerp.closing_approvals,
  openerp.closing_invalidations, openerp.closing_proposals, openerp.command_receipts,
  openerp.commerce_allocation_reversal_approvals,
  openerp.commerce_allocation_reversal_revocations, openerp.commerce_control_accounts,
  openerp.commerce_counterparty_revisions, openerp.commerce_fx_items,
  openerp.commerce_fx_recognition_approvals, openerp.commerce_fx_recognition_reviews,
  openerp.commerce_fx_settlement_approvals,
  openerp.commerce_fx_settlement_correction_approvals,
  openerp.commerce_fx_settlement_correction_reviews,
  openerp.commerce_fx_settlement_corrections, openerp.commerce_fx_settlement_reviews,
  openerp.commerce_fx_settlements, openerp.deadline_feeds, openerp.deadline_obligations,
  openerp.evidence, openerp.exchange_rate_observations, openerp.exchange_rate_revisions,
  openerp.exchange_rate_withdrawals, openerp.intake_admissions, openerp.intake_approvals,
  openerp.intake_contents, openerp.intake_occurrences, openerp.intake_preview_supersessions,
  openerp.intake_previews, openerp.invoice_issues, openerp.invoice_pdf_captures,
  openerp.owner_control_accounts, openerp.payroll_access, openerp.preparation_runs,
  openerp.recurring_activations, openerp.recurring_deactivations, openerp.recurring_rules,
  openerp.recurring_simulations, openerp.report_snapshots, openerp.sales_document_revisions,
  openerp.sales_documents, openerp.sie_transaction_captures, openerp.source_review_artifacts,
  openerp.source_uploads, openerp.vat_control_account_roles, openerp.vat_fact_components,
  openerp.vat_fact_revisions, openerp.workspace_views TO openerp_runtime;
GRANT UPDATE (state) ON TABLE openerp.preparation_jobs, openerp.preparation_runs TO openerp_runtime;
GRANT UPDATE (cursor) ON TABLE openerp.bank_connector_consents, openerp.preparation_runs TO openerp_runtime;
GRANT UPDATE (results) ON TABLE openerp.preparation_runs TO openerp_runtime;
GRANT UPDATE (blocker) ON TABLE openerp.preparation_runs TO openerp_runtime;
GRANT UPDATE (expected_audit) ON TABLE openerp.preparation_jobs TO openerp_runtime;
GRANT UPDATE (checkpoint) ON TABLE openerp.preparation_jobs TO openerp_runtime;
GRANT UPDATE (reason) ON TABLE openerp.preparation_jobs TO openerp_runtime;
GRANT UPDATE (checked_at) ON TABLE openerp.preparation_jobs TO openerp_runtime;
GRANT UPDATE (active) ON TABLE openerp.accounts, openerp.firm_members TO openerp_runtime;
GRANT SELECT (id) ON TABLE openerp.actors, openerp_auth.session TO openerp_runtime;
GRANT UPDATE (name) ON TABLE openerp.actors, openerp.books, openerp.dimension_values, openerp.dimensions TO openerp_runtime;
GRANT UPDATE (consumed_at) ON TABLE openerp.approvals TO openerp_runtime;
GRANT UPDATE (revoked_at) ON TABLE openerp.bank_connector_consents, openerp.deadline_feeds TO openerp_runtime;
GRANT UPDATE (revision) ON TABLE openerp.bank_sources, openerp.company_setups, openerp.deadline_obligations,
  openerp.firm_clients, openerp.firm_members, openerp.firms TO openerp_runtime;
GRANT UPDATE (committed_sequence) ON TABLE openerp.books TO openerp_runtime;
GRANT UPDATE (current_revision) ON TABLE openerp.catalog_articles, openerp.commerce_counterparties, openerp.commerce_invoices,
  openerp.dimension_values, openerp.dimensions, openerp.invoice_drafts,
  openerp.owner_records, openerp.supplier_invoice_drafts TO openerp_runtime;
GRANT UPDATE (recorded_at) ON TABLE openerp.company_setup_commands, openerp.firm_commands TO openerp_runtime;
GRANT UPDATE (details) ON TABLE openerp.company_setups TO openerp_runtime;
GRANT SELECT (token_hash) ON TABLE openerp.credentials TO openerp_runtime;
GRANT SELECT (actor_id) ON TABLE openerp.credentials, openerp.identity_admissions TO openerp_runtime;
GRANT SELECT (expires_at) ON TABLE openerp.credentials, openerp_auth.session TO openerp_runtime;
GRANT SELECT (revoked_at), UPDATE (revoked_at) ON TABLE openerp.credentials TO openerp_runtime;
GRANT UPDATE (created_at) ON TABLE openerp.deadline_feeds TO openerp_runtime;
GRANT UPDATE (title) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (period_id) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (responsible_actor_id) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (due_at) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (time_zone) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (source_reference) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (source_revision) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (override_reason) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (outcome_kind) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (outcome_reference) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (outcome_at) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (reminder_dismissed_at) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (updated_at) ON TABLE openerp.deadline_obligations TO openerp_runtime;
GRANT UPDATE (effective_from) ON TABLE openerp.dimension_values, openerp.dimensions TO openerp_runtime;
GRANT UPDATE (effective_to) ON TABLE openerp.dimension_values, openerp.dimensions TO openerp_runtime;
GRANT UPDATE (archived_at) ON TABLE openerp.dimension_values, openerp.dimensions TO openerp_runtime;
GRANT UPDATE (lead_id) ON TABLE openerp.firm_clients TO openerp_runtime;
GRANT UPDATE (next_review_on) ON TABLE openerp.firm_clients TO openerp_runtime;
GRANT UPDATE (note) ON TABLE openerp.firm_clients TO openerp_runtime;
GRANT UPDATE (role) ON TABLE openerp.firm_members, openerp.memberships TO openerp_runtime;
GRANT SELECT (enabled), UPDATE (enabled) ON TABLE openerp.identity_admissions TO openerp_runtime;
GRANT UPDATE (last_number) ON TABLE openerp.invoice_issue_counters, openerp.series_counters TO openerp_runtime;
GRANT UPDATE (revision_id) ON TABLE openerp.payroll_current_revisions TO openerp_runtime;
GRANT UPDATE (locked) ON TABLE openerp.periods TO openerp_runtime;
GRANT UPDATE (draft_id) ON TABLE openerp.supplier_inbox TO openerp_runtime;
GRANT UPDATE (review_reason) ON TABLE openerp.supplier_inbox TO openerp_runtime;
GRANT UPDATE (review_attempt_id) ON TABLE openerp.supplier_inbox TO openerp_runtime;
GRANT SELECT (token) ON TABLE openerp_auth.session TO openerp_runtime;
GRANT SELECT (user_id) ON TABLE openerp_auth.session TO openerp_runtime;

-- Historical import records and progress belong to application transactions.
GRANT SELECT, INSERT ON TABLE openerp.historical_bases, openerp.historical_item_admissions,
  openerp.historical_items, openerp.historical_payments, openerp.historical_matches,
  openerp.superseded_historical_openings, openerp.sie_financial_runs,
  openerp.sie_financial_proposals, openerp.sie_financial_postings TO openerp_runtime;
GRANT UPDATE (change_set_id, body, opening_voucher_id) ON TABLE openerp.historical_bases TO openerp_runtime;
GRANT UPDATE (next_ordinal, fence, lease_until, status) ON TABLE openerp.sie_financial_runs TO openerp_runtime;

-- effect-mq queue sequences.
GRANT SELECT, USAGE ON SEQUENCE public.effect_mq_flow_outbox_id_seq, public.effect_mq_jobs_seq_seq TO openerp_runtime;

-- The kept guard functions are trigger bodies, not an API: nothing in the runtime
-- role may call them directly. Only the pure canonicalization helpers are callable.
GRANT EXECUTE ON FUNCTION openerp.canonical(value jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.digest(value jsonb) TO openerp_runtime;

-- PostgreSQL grants EXECUTE to PUBLIC on every function it creates, so every kept
-- function is opted out explicitly.
REVOKE ALL ON FUNCTION openerp.ar_legal_freeze_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.ar_legal_freeze_register() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.book_versions() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.bump_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.canonical(value jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.check_calendar() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.commerce_freeze_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.digest(value jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.dimension_identity_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.fail(code text, message text) FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.freeze_preparation_inputs() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.guard_journal_ordinal() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.immutable_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.invoice_issue_guard_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.posting_guard_approval_consumption() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.supplier_acceptance_guard_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.voucher_expected_line_count() FROM PUBLIC;

-- Application-owned asset reviews, approvals and immutable financial effects.
GRANT SELECT, INSERT ON openerp.subledger_disposal_reviews,
  openerp.subledger_disposal_approvals, openerp.subledger_disposals,
  openerp.subledger_impairment_reviews, openerp.subledger_impairment_approvals,
  openerp.subledger_impairments TO openerp_runtime;

-- Completed application command owners; no feature function execution privileges.
GRANT SELECT, INSERT ON openerp.ar_legal_accounting_profiles,
  openerp.ar_legal_issue_reviews, openerp.ar_legal_issue_approvals, openerp.ar_legal_issues,
  openerp.ar_legal_delivery_requests, openerp.ar_legal_delivery_approvals,
  openerp.ar_legal_delivery_attempts, openerp.ar_legal_delivery_reconciliations,
  openerp.ar_legal_issue_counters, openerp.invoice_cancellation_reviews,
  openerp.invoice_cancellation_approvals, openerp.invoice_cancellation_executions,
  openerp.invoice_cancellation_revocations, openerp.invoice_cancellations,
  openerp.sales_documents, openerp.sales_document_revisions, openerp.sales_order_conversions
  TO openerp_runtime;
GRANT UPDATE (last_number) ON openerp.ar_legal_issue_counters TO openerp_runtime;
GRANT UPDATE (current_revision) ON openerp.sales_documents TO openerp_runtime;

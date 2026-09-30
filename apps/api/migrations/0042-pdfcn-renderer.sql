-- Direct replacement of the synthetic credit presentation with owned pdfcn components.
ALTER TABLE openerp.customer_credit_artifacts
  DROP CONSTRAINT customer_credit_artifacts_renderer_version_check,
  ADD CONSTRAINT customer_credit_artifacts_renderer_version_check
    CHECK (renderer_version = 'openerp-se-credit-note-pdfcn-v1');

ALTER TABLE openerp.customer_credit_render_failures
  DROP CONSTRAINT customer_credit_render_failures_renderer_version_check,
  ADD CONSTRAINT customer_credit_render_failures_renderer_version_check
    CHECK (renderer_version = 'openerp-se-credit-note-pdfcn-v1');

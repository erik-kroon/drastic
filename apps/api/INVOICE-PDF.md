# Customer invoice policy, PDF and delivery handoff (AR-1/AR-2)

Forward7200 captures an immutable synthetic issue and review, renders a versioned portable PDF from the captured facts, and stores exact bytes with SHA256 and length in PostgreSQL. GET and history rediscover interrupted or completed rendering. Capture replay reuses the issue's unique capture; seal replay only accepts identical bytes. Old SYN issue numbers, receipts, HTML generators and saved HTML bytes are unchanged. The fixed English/WinAnsi Courier renderer paginates; it rejects unsupported characters and oversize artifacts, never silently replaces source facts. The PDF says **SYNTHETIC REVIEW DOCUMENT - NOT A LEGAL INVOICE - NOT DELIVERED**. An artifact download does not prove receipt.

Forward7201 stores up to 50 immutable, evidence-scoped candidate company invoice policies per book. The owner must assert a seller identity, numbering proposal, VAT treatment, rounding method, credit-note and correction policy, effective date and sources. A _different current operator_ may retain review findings tied to the exact candidate digest and review evidence. Both records are permanently **unactivated** and cannot issue a legal number, select a VAT rule, post a credit, or turn a synthetic receipt into a legal invoice. Revised assertions require a new candidate key. D-04/D-08, company facts and applicable primary-source review still govern activation; retained statements alone are not independent proof.

Forward7202 stores up to 50 immutable delivery intents per book. Each binds a sealed PDF capture, byte hash/length, explicit channel and destination. A different current operator approves only **review of the intent**, never sending. `email` and `peppol` are visible but `provider_blocked`; attempting them returns `UnsupportedProfile`. `local_simulation` can record a separately approved simulated-unknown attempt with no provider ID or external traffic. Its exact same-key replay returns the saved snapshot. A different-key attempt stays blocked while unknown. The starting operator may explicitly resolve **simulated_not_sent** with a reason; GET/history retain all attempts and outcomes. The same intent can simulate again only after that resolution, with a bounded attempt count. Simulation has no delivery effect. Neither export, planned destination nor simulation means the invoice was delivered.

Real-company legal issuance, credit/correction posting and email/Peppol dispatch remain unsupported. D-04/D-08 and provider/operator access must be resolved before an activated seller/numbering/VAT/rounding contract or sending authority is implemented. No real attempt, provider uncertainty, retry or receipt is fabricated. A future provider adapter must save an exact byte-hash-bound attempt identity _before_ crossing its side-effect boundary, retain timeout/unknown and reconcile the original provider request before retry. This synthetic dry-run state machine is not provider recovery proof.

## Root-owned shared wiring

- Export `./invoice-pdf`, `./invoice-policy`, `./invoice-delivery` from `packages/contracts/package.json`.
- Add `InvoicePdfApi`, `InvoicePolicyApi`, `InvoiceDeliveryApi` to `packages/contracts/src/api.ts`. Spread their read-only `InvoicePdfCapabilities`, `InvoicePolicyCapabilities`, `InvoiceDeliveryCapabilities` in `packages/contracts/src/capabilities.ts`.
- Compose `InvoicePdfHandlers`, `InvoicePolicyHandlers`, `InvoiceDeliveryHandlers` in `apps/api/src/index.ts`. Register `invoicePdfStatements`, `invoicePolicyStatements`, `invoiceDeliveryStatements` in `apps/api/src/db/query.ts`.
- In `apps/api/src/application/capabilities.ts`, bind `commerce_get_invoice_pdf`, `commerce_invoice_pdf_history`, `commerce_get_invoice_policy_candidate`, `commerce_get_invoice_delivery`, `commerce_invoice_delivery_history` to corresponding statement names with `[scopeParameter(input.scope), input.id]`. Bind `commerce_invoice_policy_history` with `[scopeParameter(input.scope)]`. Mutations are human operator-only REST, absent from ordinary MCP.
- Apply forward7200,7201,7202 in order through the versioned migration runner in an isolated database before using these routes. No migration, browser, provider, runtime or financial verification is claimed.

REST under `/v1/entities/:entityId/books/:bookId/commerce`:

- PDFs: POST `/invoice-pdfs`, GET `/invoice-pdfs/:id`, POST `/invoice-pdfs/:id/render`, GET `/invoice-issues/:id/pdfs`.
- Policy: POST `/invoice-policies`, POST `/invoice-policies/:id/review`, GET `/invoice-policies/:id`, GET `/invoice-policies`.
- Delivery: POST `/invoice-deliveries`, POST `/invoice-deliveries/:id/approve`, POST `/invoice-deliveries/:id/simulate`, POST `/invoice-delivery-attempts/:id/resolve`, GET `/invoice-deliveries/:id`, GET `/invoice-pdfs/:id/deliveries`.

All mutations require an `Idempotency-Key`. The old HTML review document routes remain available.

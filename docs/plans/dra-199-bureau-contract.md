# DRA-199 bureau obligations contract

Scope: expose a book-scoped bureau obligations read model through the existing shared application operation to HTTP and MCP. Show creditor, stored outstanding amount, due date, source freshness, deduplicated evidence and explicit unknowns. Coverage is complete only when supported stored records prove it; otherwise partial or unknown. No UI, client-side role policy, inferred runway or unlabelled estimates.

Failure cases: one obligation from two sources counted twice; missing date presented as known; stale source treated as current; partial source set marked complete; client amount trusted over stored balance; cross-book leak.

Acceptance: real PostgreSQL E2E through supported transport proves two-source dedupe, unknown date, stale and partial coverage, with a repeatable artifact. Required changed/full and owner checks pass.

## Decision still needed

The canonical registered invoice contract requires `dueOn`; no approved owner for undated obligations exists. An unknown due-date row cannot be synthesized without weakening the posting/invoice invariant or inventing source data. Coverage stays `partial` with known invoices and `unknown` when none are registered. The unknown-date E2E remains unproven pending an authoritative undated source owner. `freshness` compares the latest invoice revision timestamp to the database timestamp using a 24-hour age threshold; it describes recorded metadata age, not provider or company completeness. Supplier obligations outside the invoice register remain explicit coverage gaps.

Stale E2E remains blocked: immutable `commerce_invoice_revisions` reject UPDATE (`Accounting history is append-only`). The supported revision API records the database's present timestamp, and the HTTP request uses that same database clock; its age cannot be advanced by synthetic fixtures. A controlled test clock or provisioned historical snapshot is needed. Do not bypass the immutable-history trigger just to force a green test.

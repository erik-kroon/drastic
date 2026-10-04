# OpenERP documentation

OpenERP turns retained evidence into reviewed accounting decisions, approved postings, reconciled books and reproducible reports.

**Start with [work status and backlog](work-status.md) to see what is done and what remains.** It consolidates the accounting packets, NEXT designs, parity requirements, product work, defects, decisions, release gates and UI checklist. Each entry names its scope, source and remaining action. [The roadmap](roadmap.md) gives milestone order; [the area plans](plans/README.md) retain the detailed delivery contracts.

[ADR 0017](adr/0017-bureau-first-product-focus.md) prioritizes the bureau-led documents/bank/invoicing/VAT loop, one human-work queue and connected execution after approval. Native payroll and peripheral breadth follow that loop; Cash is sequenced later. [Book Zero](plans/15-book-zero-workflow-cash.md) retains the first-company accounting and reconciliation requirements. Automatic posting remains unadopted.

## Reading order

| Need | Start here |
| --- | --- |
| Find unmerged or uncommitted work | [Local/origin work audit](work-audit.md) |
| Find the next work item or check completion | [Work status and backlog](work-status.md) |
| Understand the product and supported boundaries | [Product](product.md), [frontend](frontend.md), [compliance](compliance.md), [design coverage](design-coverage.md) |
| Implement an accounting packet | [Area contracts and delivery order](plans/README.md) |
| Resolve a company fact, rule, provider or operational gate | [Open decisions](open-decisions.md) |
| Understand transaction, data and runtime ownership | [Architecture](architecture.md), [domain](domain.md), [ADRs](adr/README.md) |
| Run the product or operate a supported workflow | [Local development](local-development.md), [operation/review contracts](operations.md), [operations index](operations/README.md), [self-host setup](../infra/self-host/README.md) |
| Design or implement a screen | [UI prompt](ui-design-prompt.md), [UI checklist](ui-design-checklist.md), [current design index](design/current-screen-index.md), [Paper implementation baseline](../verification/paper/README.md) |
| Establish acceptance | [Scenarios](verification.md), [verification strategy](verification-strategy.md), [packet acceptance](plans/09-acceptance.md) |
| Consult retained external design or research | [Specifications and provenance](specs/README.md), [official sources](sources/README.md) |
| Understand a completed change or an older checkpoint | [Archive index](archive/README.md), [dated implementation evidence](plans/evidence/) |

The [current foundation reconciliation](plans/current-foundation-reconciliation.md) binds core observations to live application owners and identifies the Drastic September 2026 source prerequisites. It is a scoped observation, not a second backlog.

The wider Drastic Financial Platform PRD remains context rather than adopted OpenERP implementation scope. The [open-accounting decision](adr/0005-open-accounting-and-managed-services.md), [licensing policy](../LICENSING.md) and distribution documents retain their own boundaries.

## Authority and status

The user's current request and [repository instructions](../AGENTS.md) govern work. The work register owns current status summaries. Requirement documents own behavior, invariants, dependencies and acceptance. ADRs own decisions; evidence and archives retain dated observations.

“Done” applies to the scope stated in an entry. Source implementation, local synthetic proof, actual-company reconciliation and external acknowledgment remain distinct. A checked UI design item records static design coverage; screen completion still requires the repository's parity gate. A provider simulator or local artifact cannot establish an external result.

The [D-register](open-decisions.md) remains the authority for company facts and affected-stage gates. Missing facts stay explicit. A historical execution record cannot grant authority in a new task.

## Maintaining the docs

1. Update requirements in their existing owner; preserve stable IDs and the accounting dependency graph.
2. Update status, established scope, remaining action and evidence links in [work-items.json](work-items.json). Run `python3 docs/plans/check-plan.py` to regenerate the readable register and validate namespace coverage, archive preservation and local links.
3. Preserve dated proof with its revision, environment, expected/observed result and limitations. Update the work entry to point to later proof rather than asking readers to reconstruct chronology.
4. Archive completed increments and superseded execution logs with their unresolved obligations represented in the work register. Keep an old-path pointer and its anchors when other documents still link there. Do not archive a current requirement merely because one implementation slice is done.
5. Keep `docs/specs/` and retained evidence byte-stable. External dossiers remain design input; a preserved proposal does not become a maintained requirement through its filename.

Executable wire schemas stay in `packages/contracts`; generated OpenAPI and MCP descriptions follow them. Material decisions update the ADR, affected requirements and qualification gates together. Avoid another status ledger or a new plan for work already owned by an existing packet.

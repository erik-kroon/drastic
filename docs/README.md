# OpenERP documentation

OpenERP turns retained evidence into reviewed accounting decisions, approved postings, reconciled books and reproducible reports. These documents define the product, its accounting boundaries and the work needed to deliver it.

The repository contains a synthetic accounting implementation and ongoing domain work. Implementation, observed behavior, company readiness and external acceptance are separate claims. The [roadmap](roadmap.md) records progress and evidence; the [delivery plan](plans/README.md) specifies the remaining work.

The current first-company product direction is [Book Zero, daily work and Drastic Cash](plans/15-book-zero-workflow-cash.md): an independently reviewed Drastic period, a usable daily review journey and a read-only payment forecast. It maps the supplied openERP-specific PRD to existing owners and gates. The wider Drastic Financial Platform PRD is not adopted as implementation scope by this update.

The [Document Intelligence first journey](plans/document-intelligence-delivery.md) records the PDF/image-to-review-to-draft implementation and normal self-host synthetic verification. Live provider use remains disabled.

The [pdfcn decision](adr/0016-pdfcn-legal-documents.md) and [adoption record](plans/pdfcn-adoption.md) describe the current legal-invoice and credit-note presentation and its local E2E proof.

The [evaluation input contract](operations/evaluation-contracts.md) records the operator-only immutable capture/read unit and its remaining packet-2 boundaries.

## Reading order

The [open-accounting decision](adr/0005-open-accounting-and-managed-services.md), [application-owned replacement](adr/0010-application-owned-accounting-replacement.md), [architecture follow-up](architecture-followup.md), [licensing policy](../LICENSING.md) and [self-host setup](../infra/self-host/README.md) describe the open-source distribution and the latest design reconciliation.

[Cloudflare delivery and verification](operations/cloudflare.md) records stage isolation, private originals, durable preparation and the hosted observations still required.

| Document                                               | Question it answers                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [Book Zero delivery](plans/15-book-zero-workflow-cash.md) | How do the Drastic period, daily work and Cash requirements fit the existing plan? |
| [Product scope](product.md)                            | Who is the product for, and what must it do?                                                             |
| [Local development](local-development.md)              | How do I run the source against an isolated PostgreSQL database?                                         |
| [Customer frontend plan](frontend.md)                  | How should founders, finance teams and accountants navigate, review and finish work?                     |
| [Interface design brief](ui-design-brief.md)            | What should each OpenERP page help a user see and do, and what should Paper explore first?                |
| [Paper design prompt](ui-design-prompt.md)             | How do we carefully rebuild the intended product from Accounted, one screen and flow at a time?           |
| [Screen design checklist](ui-design-checklist.md)      | Which pages, subviews and flows remain to be designed and reviewed in Enthusiastic lantern?                |
| [Architecture](architecture.md)                        | Which module owns each responsibility, and where does it run?                                            |
| [Domain and invariants](domain.md)                     | What do the records mean, and what must never become false?                                              |
| [Operations and review](operations.md)                 | How do people and agents prepare, approve, execute and recover work?                                     |
| [Compliance and interoperability](compliance.md)       | Which capabilities need dated rules, formats and external acceptance?                                    |
| [Roadmap](roadmap.md)                                  | What has been observed, and what proves each phase complete?                                             |
| [Accounting delivery plan](plans/README.md)            | What remains across posting, corrections, imports, commerce, accounting depth, year-end and operations?  |
| [Accounted comparison reconciliation](plans/16-comparison-reconciliation.md) | Which FWD proposals still apply, and which existing owners deliver them? |
| [Reference parity backlog](plans/11-parity-backlog.md)  | What does the reference implementation still owe us, as work packets and preserved rule logic?             |
| [Reference parity ledger](plans/14-parity-ledger.md) | Which parts of the reference are we at parity with, better than, or short — and which shortfalls have no owner? |
| [ERPNext/Frappe reference review](plans/17-erpnext-reference-review.md) | Which ERPNext/Frappe concepts and algorithms are adoptable, under which license terms, and where would they live? |
| [Reference-derived defects](plans/13-reference-derived-defects.md) | What is already shipped that is wrong, and how is it fixed without editing the reviewed baseline? |
| [NEXT dossier plan](plans/12-next-implementation-dossier.md) | What does the vendored NEXT-01…125 implementation design say for each work item, and which maintained packet owns it? |
| [Vendored specifications](specs/README.md)             | Which external design documents are stored here, at which pinned revision, and how to verify them?           |
| [Owner-delegated decision pass](adr/0015-owner-delegated-decision-pass.md) | What was decided on 2026-09-28 about operating mode, test permission and product scope, and what is still open. |
| [FND-01 reconciliation](plans/fnd01-reconciliation.md) | Which contracts and callers exist, what must remain compatible, and what does the pinned evidence prove? |
| [Verification scenarios](verification.md)              | Which failures must the real application withstand?                                                      |
| [Verification strategy](verification-strategy.md)      | How should the runtime, browser and database produce repeatable evidence?                                |
| [Design coverage](design-coverage.md)                  | Where are the detailed requirements, edge cases and proof gates owned?                                   |
| [Open decisions](open-decisions.md)                    | Which company facts, contracts and evidence are still needed?                                            |
| [Architecture decisions](adr/README.md)                | What choices have been made, and why?                                                                    |
| [Official sources](sources/README.md)                  | Which primary sources need review before rules and integrations can be activated?                        |

## Authority and status

The user's current request and [repository instructions](../AGENTS.md) govern the work. A design document specifies intended behavior; it does not grant operational authority or prove that behavior has been implemented.

- **Established:** observed in repository code or explicitly required by the user or repository instructions.
- **Working decision:** the selected design, with its rationale and consequences. It remains revisable.
- **Open:** a missing decision, fact or proof with a named gate in [open decisions](open-decisions.md).
- **Verified:** a specific observation tied to an artifact, environment and revision. A build does not verify financial behavior.

## Maintaining the docs

High-level documents own requirements and invariants. The area plans own detailed delivery contracts and work packets. The roadmap owns progress and links to evidence. The coverage map connects these owners without creating a second specification. `docs/specs` holds externally produced design material kept byte-identical and separately rooted; it is evidence of a design's existence and revision, never a maintained requirement.

Change a material working decision through its ADR and update the affected requirements, operations and proof gates together. Record an unresolved question once and link its identifier. Do not create empty modules just to match an architecture diagram.

Executable wire schemas belong in `packages/contracts`; generated OpenAPI and MCP descriptions follow those schemas. Preserve supported routes and sealed-record interpretation. Retain dated research and runtime evidence with their limitations, and distinguish planned behavior from implementation and observed results.

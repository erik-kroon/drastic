# ADR 0017 — Bureau-first product focus

Status: accepted product direction, 2026-10-03. Authority: the owner instructed adoption after the product-focus review and the recommendation to keep automatic posting separate. This decision defines intended behavior and delivery priority; it claims no implementation, company readiness or provider acceptance.

## Decision

The primary commercial customer and distribution channel is the accounting bureau. Accountants own routine bookkeeping within assigned book authority. Business owners answer questions and approve payments; they are not required to approve each receipt prepared by their accountant. Retain the owner-operated Book Zero path. Role names, bureau membership and assignments never confer financial powers by themselves.

Make incoming documents, bank matching, invoicing and VAT the first commercial loop, with bureau portfolio, assignment, client questions and exception handling as core capabilities. Att göra is the single canonical queue for work needing a person. All other pending-work views filter or link the same scoped tasks. The actions log records history and links current work; it does not create another queue.

Use proportionate review: familiar supported bookkeeping can be approved in a bounded batch; new suppliers, unusual treatment, missing evidence and material amounts require individual attention; payments, external messages and filings require explicit approval of the exact action. Retain immutable effects, current authority, dependency checks and durable receipts for every financial group. Reduce interface ceremony without weakening integrity. Exact materiality thresholds and batch eligibility require a specified policy before activation. Automatic posting based on repeat matches is **not adopted**; rules continue to propose.

Adopt connected execution after approval as the commercial target: live bank feeds, Peppol invoice delivery, direct VAT filing, and BankID login/signing. Each connection must qualify its own consent, identity, permissions, official specifications, rule profile and outcome evidence. Login and signing are separate capabilities. Approval, dispatch, submission, acceptance and payment remain separate events; an unknown outcome requires reconciliation before retry. File/manual handoffs remain supported fallbacks and valid local engineering paths, rather than the commercial end-state.

Make assistant reasoning visible through concise account/treatment explanations, source basis and explicit uncertainty. Show a learned preference only when an authorized retained rule changes, with its scope and undo path. Personal assistants over the API remain advanced features. Onboarding should reach bank connection → invoice intake → explainable proposals matched to bank evidence, with conservative review defaults and detailed assistant policy later. Adopt the synthetic demo and guided tour for this same loop.

Measure document-to-booking time, unchanged approval share, month-close time and human touches per transaction, with correction rates, outstanding work and coverage alongside them. Definitions are in the adoption record; no numeric success target or measured improvement is claimed.

Drastic remains an internal provisional name. Choose and qualify a replacement before public branding; no replacement or name clearance is established.

## Scope and precedence

- Native payroll and employer-declaration delivery are deferred from the commercial wedge. Evaluate a specialist integration first; no specialist is selected. Preserve existing payroll work and the accounting/correction contracts for any supported handoff. Do not advertise partial native payroll compliance.
- Quotes, orders, incoming orders, recurring-billing extensions, ROT/RUT, currency extensions, advanced assets/dimensions, intraday forecasting and broad ERP surfaces are later work. This changes sequence, not retained evidence or already implemented behavior.
- Book Zero's actual-period reconciliation, normal daily work, first-year handoff, recovery and separate cutover gates remain. Cash is later optional product work and no longer a prerequisite to the first useful period or commercial wedge. Retain its read-only design and source traceability; do not rewrite the supplied PRD.
- Import, corrections, reconciliation, readable reports and closing remain required where the selected company needs them. Applicable payroll, asset, FX or other accounting treatments cannot be declared inapplicable because their product surface is deferred. Deliver a qualified handoff or keep the company's release blocked by the unsupported case.
- This decision supersedes earlier commercial ordering and the file/manual-only target in D-10. It does not supersede R-05, ADR 0002 financial approval, ADR 0008 accounting contracts, ADR 0014 correction semantics or ADR 0015 owner-operated acceptance and test authority. NEXT priorities remain source design metadata, not the current commercial sequence.
- Credentials, provider selection, live exercises, production data, payments, filings, deployment and external contact remain separately gated. Adopting a connected product target does not authorize a real external action. Better Auth and existing backend ownership remain; BankID adds a qualified identity/signature path rather than replacing accounting authorization.

## Alternatives rejected

A mature-incumbent feature surface as the first commercial milestone; owner approval of every accountant-prepared receipt; disconnected pending queues; manual handoffs as the permanent commercial limit; automatic posting inferred from repeated approvals; and weakening source, approval or recovery checks for small amounts.

## Delivery and validation

Use the [adoption backlog](../ui-design-checklist.md#product-direction-adoption-backlog--2026-10-03) before resuming the inherited screen order. Preserve prior static review records, then review changed jobs one screen and flow at a time in Paper. Existing frames do not establish coverage of this decision.

Future implementation must prove through synthetic, repeatable public-boundary journeys: one task resolved consistently across filtered views; accountant posting within book authority while owner-only payment powers remain protected; exact batch approval with changed-item exclusion and independent receipts; provenance and retained rule changes; the onboarding loop; and connected-adapter interruption/recovery without invented external outcomes. Produce retained E2E artifacts. Provider acceptance requires separate observed evidence under D-10. This documentation change runs no provider or product journey.

Historical planning links and captures omitted from this source distribution remain in the private working archive.

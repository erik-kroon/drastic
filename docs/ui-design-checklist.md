# OpenERP screen design checklist

Working file: **Enthusiastic lantern**. Method: [design prompt](ui-design-prompt.md). Baseline: Accounted actual screens and workflows. Current OpenERP application screenshots are excluded.

Initial status reset on 2026-10-01: all items were unchecked. Existing Paper screens are drafts that need reconsideration and refinement. Subsequent screen reviews are recorded below; no previously created frame is counted as finished merely because it exists.

## How to use this checklist

Choose one screen and its flow per iteration. A checked item means the job and hierarchy were considered, the desktop design was inspected and refined, the requested compositions and material states were designed, control destinations were recorded, and frame links/decisions were saved. It does not certify product approval, implementation or runtime behavior. Owner update, 2026-10-01: narrow/mobile design is deferred for now; desktop items can be reviewed independently and F002 remains pending.

For each item, record: **Paper frames · design decision · desktop/narrow inspection · state/flow coverage · remaining dependencies**. Source routes identify the inherited job; intended URLs and grouping may improve. A shared target screen can cover aliases without duplicating frames.

Source inventory: **129 Accounted routes + 21 OpenERP URLs = 150**. The main page list contains **131 target screen/route items**: 125 Accounted-derived entries plus six additional scoped OpenERP jobs. The 21 OpenERP aliases are mapped below. Additional controls, subviews and planned flows are listed where a route template alone would hide the work. Four source routes have explicit dispositions, not silent omissions.

## 01. Shared foundations, before page work

- [x] **F001 — Application shell: navigation, company/book switcher and period context**. Desktop static review, 2026-10-01: [frames, decisions, controls, recovery and dependencies](design/2026-10-01-shell-company-context.md). Shared shell for scoped book pages; company/book and view-period overlays. Accounted home, company menu and bookkeeping period interaction inspected. To do is provisional host content; the reviewed P017 body is on its own page and P126 remains pending. No runtime or owner approval claim.
- [ ] **F002 — Narrow navigation and company switching; distinguish global and book-scoped pages**. Deferred by owner, 2026-10-01. Preliminary narrow studies remain drafts; no completion claim.
- [x] **F003 — Typography, semantic colors, density, amount alignment, focus and control states**. Route/overlay assignment to be recorded during design. Static review, 2026-10-03: shared tokens, density, tabular amounts, focus and control states on Paper page 13 ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **F004 — Register, document editor, review and setup patterns after they have been tested on distinct tasks**. Route/overlay assignment to be recorded during design. Static review, 2026-10-03: register (M1, N1, Q1), document editor (M9), review (L2), form/setup (T9, V10) on pages 01 to 11 ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **F005 — Shared loading, no-access, error and unknown-outcome patterns with recovery**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: loading skeleton that keeps headers and filters, read error that keeps last data and states its age, unknown outcome that says check before retry (K20); no-access (U12) and blocked (R2, R6) from earlier frames. These are inline patterns applied in registers and reviews, not separate routes. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 02. Entry and access

- [x] **P001 — Sign in** — Accounted reference: `/login`. Desktop static review, 2026-10-01: [configured methods, session return, feedback, controls and dependencies](design/2026-10-01-entry-sign-in.md). Refined on **02 / Entry & company context**. Recovery/factor/invitation/directory screens remain independent items; mobile deferred, runtime unverified.
- [x] **P002 — Create an account** — Accounted reference: `/register`. Static, 2026-10-03: invitation-only. The sign-in page no longer offers public sign-up (U1) and account creation is bound to an invitation with a read-only email and the inviter named (U11). Field validation states are not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P003 — Password recovery and reset** — Accounted reference: `/reset-password`. Static, 2026-10-03: recovery request with a neutral response, acknowledgement that does not reveal whether the account exists, new-password form with a mismatch state, and an expired-link state (U17 to U20). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P004 — Set an initial password** — Accounted reference: `/account/set-password`. Static, 2026-10-03: choose a password for an invited account with the email fixed (U11) and the shared password form with visibility toggle and mismatch validation (U19). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P005 — Confirm an email change** — Accounted reference: `/auth/email-change`. Static, 2026-10-03: signed-in confirmation of an email change showing current and new address, with cancel (U28). The signed-out and expired states are not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P006 — Set up two-factor authentication** — Accounted reference: `/mfa/enroll`. Static, 2026-10-03: enable two-factor with a QR placeholder, manual key, code field and a skip, then one-time recovery codes shown once (U24, U26). Whether two-factor is required is an undecided session/MFA policy (D-01), so skip is shown. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P007 — Verify a factor and recover access** — Accounted reference: `/mfa/verify`. Static, 2026-10-03: code entry with a wrong-code state (U25) and recovery-code entry that points to an administrator when no codes remain (U27). Lockout and rate-limit states are not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P008 — Accept an invitation, including expired or invalid links** — Accounted reference: `/invite/[token]`. Static, 2026-10-03: invitation review for the matching signed-in recipient showing inviter, role and scope with a recheck on accept (U21), signed in as another account (U22), and an invalid, expired or used link that reveals nothing about the company (U23). A signed-out recipient continues through sign-in (U1) or invitation-bound account creation (U11). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 03. Companies and setup

- [x] **P009 — Company chooser and switching** — Accounted reference: the actual in-app company switcher. Source clarification, 2026-10-01: `/select-company` chooses newly discovered companies to add, with an onboarding/invite handoff; it is not the existing-company directory. Preserve that addition job under P010/P012 while designing OpenERP's authorized-book directory separately. Desktop static review: [register, controls, states, source limits and dependencies](design/2026-10-01-company-directory.md). Mobile deferred; runtime unverified.
- [x] **P010 — Create a company** — Accounted reference: `/companies/new`. Static, 2026-10-03: company chooser (U2) and step 1 of a four-step setup (U13); details are entered by the user and not fetched from a register. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P011 — Create a client company** — Accounted reference: `/companies/new-client`. Static, 2026-10-03: client form (V10) on page 11 ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **P012 — Company identity and accounting setup** — Accounted reference: `/onboarding`. Static, 2026-10-03: setup step 2 with fiscal year, chart of accounts, VAT period and method; VAT choices marked unverified (U14). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P013 — Choose opening balances and historical bookkeeping** — Accounted reference: `/onboarding/books`. Static, 2026-10-03: setup step 3, start from zero, import opening balances from a SIE file, or import earlier bookkeeping; nothing is booked before review (U15). The opening-balance review itself is F042. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P014 — Choose assistance and review policy during setup** — Accounted reference: `/onboarding/agent`. Static, 2026-10-03: setup step 4 with assistant permissions that match the assistant policy page and approval, posting and payment fixed to a person (U16). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P015 — Enter a clearly labelled demo workspace** — Accounted reference: `/sandbox`. Static, 2026-10-03: a clearly labelled demo company with what is real (nothing) and what is never sent (U29). Scope question: the demo workspace is derived from Accounted and not owned by an OpenERP plan, so this is a proposal pending owner confirmation. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P016 — Guided demo journey** — Accounted reference: `/sandbox/journey`. Static, 2026-10-03: guided walkthrough inside the shell with a persistent demo banner, the demo company name in the switcher, step state and a reset (U30). Same scope question as P015. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 04. Daily work and overview

- [x] **P017 — To do: prioritized decisions and resumable work** — Accounted reference: `/`. Desktop static review, 2026-10-02: [attention/resume decisions, all controls, coverage, recovery and results](design/2026-10-02-to-do.md). Refined on **03 / To do & overview** after actual home, proposal, transaction and invoice-continuation inspection. P018/P019/P126 and full review remain independent items; P020 has its separate review below; mobile deferred, runtime unverified.
- [x] **P018 — Prepared work and exceptions queue** — Accounted reference: `/pending`. Merged into the P126 target (route matrix counterpart); desktop static review, 2026-10-03: [work queue ledger](design/2026-10-03-work-queue.md). Bulk selection is F010; runtime unverified.
- [x] **P019 — Deadlines and obligations** — Accounted reference: `/deadlines`. Desktop static review, 2026-10-03: [dated obligations with stated basis, reminder overlay and tax date drawer](design/2026-10-03-deadlines.md). Statutory dates stay unverified pending D-04. Mobile deferred; runtime unverified.
- [x] **P020 — Company overview and performance, with dated source basis** — Accounted reference: `/kpi`. Desktop static review, 2026-10-02: [dated balances, source drawer, unfinished period, controls and return flow](design/2026-10-02-overview.md). Refined on **03 / To do & overview** after actual KPI/help/period/customization inspection. Working, source drilldown and first-use empty frames; owner reduced failure-state scope. Mobile deferred; runtime unverified.
- [x] **P126 — Filtered work queue with return context** — current scoped route: `/entities/:entityId/books/:bookId/work`. Desktop static review, 2026-10-03: [open register with inspector, completed results, no-match/refresh/completion states](design/2026-10-03-work-queue.md) on **03 / To do & overview**. Mobile deferred; runtime unverified.

## 05. Evidence review

- [x] **P127 — Resolve the current review version and deep-link guard** — current scoped route: `/entities/:entityId/books/:bookId/reviews/:planId`. Desktop static review, 2026-10-03: resolver/redirect contract and the superseded-version guard frame in the [revision handoff ledger](design/2026-10-03-revision-handoff.md). Runtime unverified.
- [x] **P128 — Full evidence review: original, facts, proposed treatment and exact effects** — current scoped route: `/entities/:entityId/books/:bookId/reviews/:planId/:revision`.

Additional screens, subviews or flow steps:

Desktop P128/F008 review: [design ledger](design/2026-10-02-evidence-review.md). Original → exact approval → separate posting → retained receipt inspected. Revision, correction and change-request handoff (P127/F006/F007): [design ledger](design/2026-10-03-revision-handoff.md). Runtime unverified and narrow deferred.

- [x] **F006 — Correct interpreted facts and prepare a new revision**. Fact-correction overlay (2026-10-02) plus in-place treatment editor, saved-version comparison and approval-invalidation, 2026-10-03: [ledger](design/2026-10-03-revision-handoff.md). Desktop static; runtime unverified.
- [x] **F007 — Request changes and return to the originating queue**. Request overlay with reason category, paused review and persistent queue-return result, 2026-10-03: [ledger](design/2026-10-03-revision-handoff.md). Assignee/notification model is an open owner decision. Desktop static; runtime unverified.
- [x] **F008 — Approve a revision, then separately review posting and its durable receipt**. Route/overlay assignment to be recorded during design.
- [x] **F009 — Changed source, stale approval, failed save and uncertain posting outcome**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: source changed after approval, failed save that keeps the entered values, and unconfirmed posting that sends the person to Verifikat (K21), together with the superseded-version guard in the revision handoff ledger. Inline patterns, not separate routes. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **F010 — Batch review with partial completion and per-item failures**. Desktop static, 2026-10-03 (selection and an illustrated post-run result): [per-item decisions, no batch rollback](design/2026-10-03-work-queue.md); runtime unverified.

## 06. Banking and reconciliation

- [x] **P021 — Bank account directory and account workspace** — Accounted reference: `/accounts`. Desktop static review, 2026-10-03: [directory and account workspace with separate statement, ledger, difference and coverage facts](design/2026-10-03-accounts.md). Mobile deferred; runtime unverified.
- [x] **P022 — Transaction register and matching detail** — Accounted reference: `/transactions`. Desktop static review, 2026-10-03: [register with event inspector](design/2026-10-03-transactions.md). Mobile deferred; runtime unverified.
- [x] **P023 — Reconcile a period, investigate differences and coverage** — Accounted reference: `/reconciliation`. Desktop static review, 2026-10-03: [bridge from statement to ledger, completion checkpoint](design/2026-10-03-reconciliation.md); first airy and tight-direction compositions both shown ([direction note](design/2026-10-03-tight-direction.md)). Mobile deferred; runtime unverified.
- [x] **P024 — Import: choose a source, preview, map and confirm** — Accounted reference: `/import`. Desktop static review, 2026-10-03, bank statement path only, designed in the tight direction: [source list, review of every row, retention with coverage effect](design/2026-10-03-import.md). SIE, opening-balance, register and skattekonto imports not designed; runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F011 — Manual/suggested match detail, split allocation and match correction**. Customer-payment allocation drawer and matched-event correction entry, 2026-10-03: [ledger](design/2026-10-03-transactions.md). Supplier-payment mirror not designed; desktop static; runtime unverified.
- [x] **F012 — Import mapping, duplicate detection, rejected rows and coverage gaps**. Bank statement path, desktop static, 2026-10-03: [column mapping, row-level duplicate and rejected results, continuity/coverage check](design/2026-10-03-import.md). Gap-with-wrong-balance is a contract note, not a frame; runtime unverified.

## 07. Sales

- [x] **P025 — Customer invoices register** — Accounted reference: `/invoices`. Desktop static review, 2026-10-03, tight direction: [register with coverage-qualified payment status](design/2026-10-03-sales-invoices.md). Runtime unverified.
- [x] **P026 — Create an invoice in a document editor** — Accounted reference: `/invoices/new`. Desktop static review, 2026-10-03, tight direction: [draft editor with derived totals and a separate issue step](design/2026-10-03-sales-invoices.md); issue-preview step, ROT/RUT, articles and foreign currency not designed; runtime unverified.
- [x] **P027 — Invoice detail: document, delivery, settlement and history** — Accounted reference: `/invoices/[id]`. Desktop static review, 2026-10-03, tight direction: [overdue invoice with settlement from booked payments and a bank-event link](design/2026-10-03-sales-invoices.md). Runtime unverified.
- [x] **P028 — Edit and resume an invoice draft** — Accounted reference: `/invoices/[id]/edit`. Desktop static, 2026-10-03 (the P026 frame is the resumed draft; resume rules as contract notes): [resume rules](design/2026-10-03-sales-invoices.md); runtime unverified.
- [x] **P029 — Credit review and the resulting credit document** — Accounted reference: `/invoices/[id]/credit`. Desktop static, 2026-10-03: [partial credit with derived effects](design/2026-10-03-sales-invoices.md); runtime unverified.
- [x] **P030 — Recurring invoices and schedule detail** — Accounted reference: `/invoices/recurring`. Desktop static, 2026-10-03: [schedules create drafts, never issue](design/2026-10-03-sales-invoices.md); runtime unverified.
- [x] **P031 — ROT/RUT claims and claim detail** — Accounted reference: `/invoices/rot-rut`. Static, 2026-10-03: ROT/RUT claims register with detail, derived deduction and customer share; the user submits to Skatteverket and registers the outcome (M11). Rates and caps unverified. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified. Outcome registration, 2026-10-03: decision type, date, amount from the decision and a required attached decision file; the payout is booked only when linked to a bank event (M20).
- [x] **P032 — Customer directory** — Accounted reference: `/customers`. Desktop static, 2026-10-03: [receivables by customer, identity origin](design/2026-10-03-sales-invoices.md); runtime unverified.
- [x] **P033 — Customer detail and related work** — Accounted reference: `/customers/[id]`. Desktop static, 2026-10-03: [sourced facts, overdue invoice, related work](design/2026-10-03-sales-invoices.md); runtime unverified.
- [x] **P034 — Sales articles register** — Accounted reference: `/articles`. Desktop static, 2026-10-03: [articles as row templates, change applies to new rows](design/2026-10-03-sales-invoices.md); runtime unverified.
- [x] **P035 — Article detail and editing** — Accounted reference: `/articles/[id]`. Desktop static, 2026-10-03: [detail with price-change form](design/evidence/2026-10-03-sales/article-detail.png); ledger `design/2026-10-03-sales-invoices.md`.
- [x] **P036 — Quotes entry and register; decide relationship to sales orders** — Accounted reference: `/quotes`. Desktop static, 2026-10-03: [register](design/evidence/2026-10-03-sales/quotes-register.png), [entry](design/evidence/2026-10-03-sales/new-quote.png); ledger `design/2026-10-03-sales-invoices.md`. Relationship decision recorded as design position (offers go straight to invoice drafts); the sales-order question stays open.
- [x] **P037 — Quotes and sales orders register** — Accounted reference: `/sales-orders`. Static, 2026-10-03: quotes and sales orders register with status (M12). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P038 — Create a quote or sales order** — Accounted reference: `/sales-orders/new`. Static, 2026-10-03: new quote in the shared document editor with derived totals and a saved draft that has no number until saved; the product does not send it (M14). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P039 — Sales order detail and invoice handoff** — Accounted reference: `/sales-orders/[id]`. Static, 2026-10-03: quote detail with separate invoice-draft handoff, nothing booked (M13). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P040 — Edit a quote or sales order** — Accounted reference: `/sales-orders/[id]/edit`. Partial, 2026-10-03: uses the same editor as M14; the edit state of a saved quote (assigned number, changed-after-sent revision) is not drawn. Resolved 2026-10-03: M24 draws the edit state of a sent quote (O-2026-0007 keeps its number, change saved as revision 2, revision 1 retained, customer sees nothing until it is sent, nothing booked). Sales-order edit uses the same editor. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P041 — Incoming commerce orders and accounting handoff** — Accounted reference: `/orders`. Static, 2026-10-03: incoming webshop orders with a failed-to-read state and a draft-invoice handoff that issues and books nothing; shop payment is not treated as booked (M15). Webshop intake is in scope per product.md. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P042 — Recipient invoice action, including expired links** — Accounted reference: `/invoice-action/[token]`. Static, 2026-10-03: recipient invoice page and the expired-link state that shows no invoice data (M16, M17). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F013 — Invoice payment allocation, partial payment, overpayment and correction**. Desktop static, 2026-10-03: [partial payment from an unknown-sender deposit](design/2026-10-03-sales-invoices.md); over/underpayment and multi-invoice allocation follow the same pattern, not drawn; runtime unverified.
- [x] **F014 — Collections/reminders with preview, delivery state and recorded outcome**. Desktop static, 2026-10-03: [first reminder with full preview and separate delivery and outcome states](design/2026-10-03-sales-invoices.md); escalation steps and fee policy open; runtime unverified.
- [x] **F015 — Customer/article create and edit overlays**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: new customer (copied payment terms stay changeable per invoice) and new article (account 3041, unverified VAT rate, edits affect only new drafts) overlays (M18, M19). The edit overlay reuses the same fields; a separate edit frame was not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 08. Purchases and expenses

- [x] **P043 — Purchases entry and workspace** — Accounted reference: `/purchases`. Desktop static, 2026-10-03: [to-do plus booked debt, proposals kept out](design/2026-10-03-purchases.md); runtime unverified.
- [x] **P044 — Supplier invoices register** — Accounted reference: `/supplier-invoices`. Desktop static review, 2026-10-03, tight direction: [register with the payment-file boundary stated](design/2026-10-03-purchases.md). Runtime unverified.
- [x] **P045 — Create a supplier invoice from evidence or entered facts** — Accounted reference: `/supplier-invoices/new`. Desktop static, 2026-10-03 (entered-facts path drawn): [entered claims, unproven without original](design/2026-10-03-purchases.md); runtime unverified.
- [x] **P046 — Supplier invoice detail: original, treatment and settlement** — Accounted reference: `/supplier-invoices/[id]`. Desktop static review, 2026-10-03, tight direction: [posted unpaid invoice, settlement from booked payments](design/2026-10-03-purchases.md). Runtime unverified.
- [x] **P047 — Payment files: prepare, review, export and record outcome** — Accounted reference: `/supplier-invoices/payment-files`. Partial, 2026-10-03, tight direction: [review-before-export step drawn; prepare, export confirmation and record-outcome steps only described; the file pays nothing](design/2026-10-03-purchases.md). Open until the other steps are drawn; runtime unverified. Static, 2026-10-03: prepare (N2), wait and outcome (N6, N7), no payment executed by the product ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **P048 — Supplier directory** — Accounted reference: `/suppliers`. Desktop static, 2026-10-03: [directory with booked liability separate from proposals](design/2026-10-03-suppliers.md); runtime unverified.
- [x] **P049 — Supplier detail and related work** — Accounted reference: `/suppliers/[id]`. Desktop static, 2026-10-03: [supplier facts with source and invoices](design/2026-10-03-suppliers.md); runtime unverified.
- [x] **P050 — Expenses register** — Accounted reference: `/expenses`. Desktop static, 2026-10-03: [receipt-backed expenses, card purchase without receipt kept apart](design/2026-10-03-purchases.md); runtime unverified.
- [x] **P051 — Create and review an expense** — Accounted reference: `/expenses/new` (redirect only). Desktop static, 2026-10-03: [receipt-backed proposal review](design/evidence/2026-10-03-purchases/expense-proposal.png); ledger `design/2026-10-03-purchases.md`.
- [x] **P052 — Resolve counterparty identities and inspect related activity** — Accounted reference: `/parties`. Desktop static, 2026-10-03: [unclear identities first, unconfirmed payer](design/2026-10-03-suppliers.md); runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F016 — Expense detail: retained receipt, entered facts, treatment and review**. Desktop static, 2026-10-03: [receipt, read values, treatment and review lineage](design/2026-10-03-purchases.md); runtime unverified.
- [x] **F017 — Supplier create and edit overlays; duplicate/identity resolution**. Desktop static, 2026-10-03 (duplicate resolution; create/edit form not designed): [comparison and merge consequences](design/2026-10-03-suppliers.md); runtime unverified.

## 09. Documents and archive

- [x] **P053 — Documents inbox and archive** — Accounted reference: `/arkiv`. Desktop static review, 2026-10-03, tight direction: [archive table with bookkeeping status and a single waiting-for-you line](design/2026-10-03-documents.md). Runtime unverified.
- [x] **P054 — Documents needing review** — Accounted reference: `/arkiv/granska`. Desktop static review, 2026-10-03, tight direction: [grouped questions with evidence pane; answers are corrections, not postings](design/2026-10-03-documents.md). Findings group and held-at-the-door removal semantics open; runtime unverified.
- [x] **P055 — Original document detail, facts and accounting lineage** — Accounted reference: `/arkiv/dokument/[id]`. Desktop static review, 2026-10-03, tight direction: [original beside read facts and lineage that names what has not happened](design/2026-10-03-documents.md). Runtime unverified.
- [x] **P056 — Agreements register** — Accounted reference: `/arkiv/avtal`. Desktop static, 2026-10-03: [register derived from the recurring schedules; illustrated state](design/evidence/2026-10-03-documents/agreements-register.png); ledger `design/2026-10-03-documents.md`.
- [x] **P057 — Agreement detail, documents and obligations** — Accounted reference: `/arkiv/avtal/[id]`. Desktop static, 2026-10-03: [original, read terms and obligations; illustrated state](design/evidence/2026-10-03-documents/agreement-detail.png); ledger `design/2026-10-03-documents.md`.
- [x] **P058 — Authority correspondence and documents** — Accounted reference: `/arkiv/myndighet`. Desktop static, 2026-10-03: [register with the F-skatt decision, no submission implied](design/evidence/2026-10-03-documents/authority-documents.png); ledger `design/2026-10-03-documents.md`.
- [x] **P059 — Document activity and history** — Accounted reference: `/arkiv/historik`. Desktop static, 2026-10-03: [read-only activity list](design/evidence/2026-10-03-documents/document-activity.png); ledger `design/2026-10-03-documents.md`.

## 10. Bookkeeping

- [x] **P060 — Posted vouchers register** — Accounted reference: `/bookkeeping`. Desktop static review, 2026-10-03, tight direction: [register with origin and series continuity](design/2026-10-03-vouchers.md). Runtime unverified.
- [x] **P061 — Voucher detail: lines, evidence and correction history** — Accounted reference: `/bookkeeping/[id]`. Desktop static review, 2026-10-03, tight direction: [immutable voucher with lineage links; corrections only by new voucher](design/2026-10-03-vouchers.md). Runtime unverified.
- [x] **P062 — Accruals and accounting schedules** — Accounted reference: `/bookkeeping/periodiseringar`. Desktop static, 2026-10-03: [one register of accrual and depreciation proposals, none booked](design/evidence/2026-10-03-vouchers/accounting-schedules.png); ledger `design/2026-10-03-vouchers.md`.
- [x] **P063 — Chart of accounts and account detail** — Accounted reference: `/chart-of-accounts`. Desktop static review, 2026-10-03, tight direction: [my accounts with usage and a bank-linked account detail](design/2026-10-03-vouchers.md); BAS catalogue tab and own-account form not designed; runtime unverified.
- [x] **P064 — Fixed assets register, asset detail and depreciation schedule** — Accounted reference: `/assets`. Desktop static, 2026-10-03: [register with the 1220 asset and an unbooked depreciation proposal](design/evidence/2026-10-03-vouchers/fixed-assets.png); ledger `design/2026-10-03-vouchers.md`; acquisition and disposal not drawn.
- [x] **P065 — Asset disposal review and result** — Accounted reference: `/assets/[id]/dispose`. Partial, 2026-10-03: disposal review with derived book value and loss, sale price taken from a cited invoice (Q10); posted result missing. Resolved 2026-10-03: Q16 shows the posted result, voucher A150 (D 1229 9 000,00, D 1510 6 500,00, D 7970 2 500,00, K 1220 18 000,00), asset status Avyttrad, restvärde 0,00, approved by Elin Sund. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P066 — Dimensions and values** — Accounted reference: `/dimensions`. Static, 2026-10-03: dimensions and values with row counts; tagging does not change amounts or accounts (Q11). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P067 — Historical tagging: selection, preview and result** — Accounted reference: `/dimensions/tagging`. Partial, 2026-10-03: selection and per-row preview (Q12); result after applying missing. Resolved 2026-10-03: Q17 shows the applied result, 14 rows tagged with kostnadsställe 100, A117 changed from 200 with the earlier value kept, amounts and accounts unchanged, history link. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F018 — Prepare and review a correcting voucher; retain the original**. Desktop static review, 2026-10-03, tight direction: [prepare step with derived amounts, sent for review](design/2026-10-03-vouchers.md); the review itself reuses P128. Runtime unverified.
- [x] **F019 — Schedule detail/editor, occurrence review and history**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: schedule facts, upcoming occurrence, occurrence history with issued invoices and a failed creation with a retry that makes a draft only; the schedule never issues (M21), consistent with the register (M4). Editing the template reuses the editor. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **F020 — Create/acquire an asset and review depreciation**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: acquire an asset with the cost taken from a cited supplier invoice, a proposed straight-line plan (166,67 a month over 36 months, last month adjusted to total 6 000,00) and a send-for-approval step; each month is proposed as its own voucher and nothing is booked automatically (Q15). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 11. Tax

- [x] **P068 — Tax account transactions and assessment matching** — Accounted reference: `/skattekonto`. Desktop static, 2026-10-03: [read-in tax-account events, matching, nothing fetched](design/2026-10-03-tax-vat.md); runtime unverified.
- [x] **P129 — Tax/VAT workspace: population, calculation, control review and handoff** — current scoped route: `/entities/:entityId/books/:bookId/tax`. Desktop static review, 2026-10-03, tight direction: [preliminary calculation, excluded sources named, handoff boundary](design/2026-10-03-tax-vat.md); the per-source population drilldown is F021 (open); runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F021 — VAT return detail, included/excluded sources and discrepancy drilldown**. Desktop static, 2026-10-03: [box 48 with included and excluded sources](design/2026-10-03-tax-vat.md); other boxes follow the same pattern; runtime unverified.
- [x] **F022 — Tax adjustment, reclassification and assessment detail**. Desktop static, 2026-10-03 (interest-event proposal; box adjustments and assessment decisions not designed): [treatment proposal](design/2026-10-03-tax-vat.md); runtime unverified.
- [x] **F023 — Prepared declaration, handoff/submission evidence, acceptance and payment as separate states**. Desktop static, 2026-10-03: [five separate steps, only preparation done](design/2026-10-03-tax-vat.md), shown as an illustrated future state; runtime unverified.

## 12. Payroll and mileage

- [x] **P069 — Payroll workspace and runs register** — Accounted reference: `/salary`. Static, 2026-10-03: runs register with draft, booked and period states (R8); the R2 gated state stays the not-configured view. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P070 — Employees directory** — Accounted reference: `/salary/employees`. Static, 2026-10-03: employees directory with list and selected detail (R9). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P071 — Employee detail and dated employment revisions** — Accounted reference: `/salary/employees/[id]`. Static, 2026-10-03: employment versions with start dates, superseded versions kept (R9). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P072 — Payroll run: inputs, calculation, review and results** — Accounted reference: `/salary/runs/[id]`. Static, 2026-10-03: run review with totals, missing input and separate approval (R10). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P073 — Employee calculation within a payroll run** — Accounted reference: `/salary/runs/[id]/employees/[employeeId]`. Static, 2026-10-03: per-employee calculation with unverified tax basis and missing absence input (R11). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P074 — Published payslip and access-link states** — Accounted reference: `/payslip/[token]`. Static, 2026-10-03: payslip with personal expiring link; expired-link state stated in copy only (R12). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P075 — Mileage register, trip detail and reimbursement review** — Accounted reference: `/mileage`. Static, 2026-10-03: register with statuses (R13) and trip detail with derived reimbursement, unverified rate, approval separate from payout and booking (R14). Creating a claim is drawn in R19 (F025). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F024 — Create a payroll run and resolve missing/changed employee inputs**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: create a November run as a draft that pays and books nothing (R15), resolve missing absence for an employee with a recorded choice and recalculation (R16), and recalculate when an employment version changes after the amounts were calculated (R17). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **F025 — Create/edit an employee revision and create/edit a mileage claim**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: new employment version with a start date that keeps the old one as history and leaves approved or booked runs untouched (R18), and a new mileage claim where the reimbursement is derived from kilometres and cannot be typed (R19). Editing an existing claim reuses the same fields and is not drawn separately. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 13. Reports

- [x] **P076 — Report catalogue and saved reports** — Accounted reference: `/reports`. Desktop static review, 2026-10-03, tight direction: [catalogue with immutable saved snapshots](design/2026-10-03-reports.md). Runtime unverified.
- [x] **P077 — Focused report, scope controls and drilldown pattern** — Accounted reference: `/reports/[slug]`. Desktop static, 2026-10-03: the pattern is realised in F026-F030 (scope, comparison, drilldown, snapshot, export); ledger `design/2026-10-03-reports.md`.
- [x] **P078 — Historical cash-flow statement** — Accounted reference: `/reports/kassaflodesanalys`. Desktop static, 2026-10-03: [September, account 1930 only, stated as partial](design/evidence/2026-10-03-reports/cash-flow-statement.png); ledger `design/2026-10-03-reports.md`.

Additional screens, subviews or flow steps:

- [x] **F026 — Trial balance and account drilldown**. Desktop static, 2026-10-03: [saldobalans per 30 sep with class rows and account drilldown](design/2026-10-03-reports.md); runtime unverified.
- [x] **F027 — General ledger and voucher/evidence drilldown**. Desktop static, 2026-10-03: [account 1930 with the bank-statement comparison](design/2026-10-03-reports.md); runtime unverified.
- [x] **F028 — Profit and loss**. Desktop static, 2026-10-03: [September result with what is not in it](design/2026-10-03-reports.md); runtime unverified.
- [x] **F029 — Balance sheet**. Desktop static, 2026-10-03: [30 Sep balance sheet that flags what could change it](design/2026-10-03-reports.md); runtime unverified.
- [x] **F030 — Customer/supplier registers and aging**. Desktop static, 2026-10-03: [aging that ties to the overview and states it is not reconciled](design/2026-10-03-reports.md); runtime unverified.
- [x] **F031 — Fixed assets report**. Desktop static, 2026-10-03: [register per 30 sep tied to 1220, depreciation shown as a proposal outside the figures](design/evidence/2026-10-03-reports/fixed-assets-report.png); ledger `design/2026-10-03-reports.md`.
- [x] **F032 — Foreign-currency review**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: M22 draws the first slice from ADR 0008 only (customer receivable recognised in EUR, full settlement into SEK, gain/loss from actual consideration, fees separate). Payables, partial settlement and remeasurement are not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **F033 — Review pack and saved snapshot/export result**. Desktop static, 2026-10-03: [saved snapshot of a partial report with export to PDF, nothing sent](design/evidence/2026-10-03-reports/snapshot-and-export.png); ledger `design/2026-10-03-reports.md`; no multi-report review pack drawn.

## 14. Year-end

- [x] **P079 — Year-end workspace and period checklist** — Accounted reference: `/bookkeeping/year-end`. Desktop static review, 2026-10-03, tight direction: [period list and September assessment](design/2026-10-03-period-close.md); the annual closing is not designed; runtime unverified.
- [x] **P080 — Year-end accruals and timing adjustments** — Accounted reference: `/bookkeeping/year-end/periodisering`. Desktop static, 2026-10-03 (September candidates; same flow at year end): [prepaid cost proposal with unconfirmed period](design/2026-10-03-period-close.md); runtime unverified.
- [x] **P081 — Annual report: prepare, review, sign and official-channel handoff** — Accounted reference: `/bookkeeping/year-end/arsredovisning`. Desktop static, 2026-10-03 (readiness and steps; note editor not drawn): [five steps with evidence-based completion](design/2026-10-03-period-close.md); runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F034 — Period assessment detail, blockers, resolution and technical lock review**. Desktop static, 2026-10-03: [blockers, notes and passes with an inactive lock](design/2026-10-03-period-close.md); the lock confirmation dialog is described, not drawn; runtime unverified.
- [x] **F035 — Annual report editor, signature progress and recorded handoff outcome**. Desktop static, 2026-10-03 (illustrated future state; editor not drawn): [signature register and recorded handoff](design/2026-10-03-period-close.md); runtime unverified.

## 15. Cash forecast

- [x] **F036 — Dated read-only cash forecast with completeness and uncertainty visible**. Desktop static, 2026-10-03: [13-week forecast of dated items from the observed bank balance](design/2026-10-03-cash-forecast.md); runtime unverified.
- [x] **F037 — Contribution detail: opening observation, receivable, payable and undated item**. Desktop static, 2026-10-03: [all contributions with source and the excluded undated item](design/2026-10-03-cash-forecast.md); runtime unverified.
- [x] **F038 — Delayed-payment scenario editor and comparison**. Desktop static, 2026-10-03: [one delayed invoice compared with the baseline](design/2026-10-03-cash-forecast.md); runtime unverified.
- [x] **F039 — Saved forecast snapshot and scenario result; distinguish 90 days from 13 weeks**. Desktop static, 2026-10-03: [immutable snapshots, 91-day horizon stated](design/2026-10-03-cash-forecast.md); runtime unverified.

## 16. Settings

- [x] **P082 — Settings home and section navigation** — Accounted reference: `/settings`. Desktop static, 2026-10-03: [settings home with section status](design/2026-10-03-settings-home.md); runtime unverified.
- [x] **P083 — Settings overlay that preserves the underlying record** — Accounted reference: `/settings/[[...section]]`. Static, 2026-10-03: M23 shows invoice settings as a right-hand panel over a dimmed invoice draft; the draft stays underneath and is unchanged, and the panel returns to the invoice. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P084 — Personal profile, security and language** — Accounted reference: `/settings/account`. Desktop static, 2026-10-03: [profile, security and devices](design/2026-10-03-settings-profile.md); runtime unverified.
- [x] **P085 — Company identity and sourced profile facts** — Accounted reference: `/settings/company`. Desktop static, 2026-10-03: [identity facts with source and status](design/2026-10-03-settings-company.md); runtime unverified.
- [x] **P086 — Members, roles and invitations** — Accounted reference: `/settings/team`. Desktop static, 2026-10-03: [members, capabilities and invitations](design/2026-10-03-settings-team.md); runtime unverified.
- [x] **P087 — Accounting periods, policies and chart configuration** — Accounted reference: `/settings/bookkeeping`. Desktop static, 2026-10-03: [periods and rules, lock stays in period control](design/2026-10-03-settings-bookkeeping.md); runtime unverified.
- [x] **P088 — Tax registrations and qualified configuration** — Accounted reference: `/settings/tax`. Desktop static, 2026-10-03: [tax facts with source and status](design/2026-10-03-settings-tax.md); runtime unverified.
- [x] **P089 — Bank consent, connection and feed status** — Accounted reference: `/settings/banking`. Desktop static, 2026-10-03 (manual-import profile; consent flow not designed): [bank accounts, coverage and feed](design/2026-10-03-settings-bank.md); runtime unverified.
- [x] **P090 — Invoice numbering, terms and issuance configuration** — Accounted reference: `/settings/invoicing`. Desktop static, 2026-10-03: [numbering rule, terms and issuance](design/2026-10-03-settings-invoicing.md); runtime unverified.
- [x] **P091 — Company document branding** — Accounted reference: `/settings/brand`. Desktop static, 2026-10-03: [branding tab with live preview](design/2026-10-03-settings-branding.md); runtime unverified.
- [x] **P092 — Document templates and preview** — Accounted reference: `/settings/templates`. Desktop static, 2026-10-03: [templates tab with schematic and issued-invoice preview](design/2026-10-03-settings-templates.md); runtime unverified.
- [x] **P093 — Payment provider setup and connection states** — Accounted reference: `/settings/payments`. Desktop static, 2026-10-03 (payment-file and boundary view; provider onboarding not designed): [payments within Bank](design/2026-10-03-settings-payments.md); runtime unverified.
- [x] **P094 — Payroll configuration** — Accounted reference: `/settings/salary`. Desktop static, 2026-10-03 (prerequisites view): [payroll prerequisites and gating](design/2026-10-03-settings-payroll.md); runtime unverified.
- [x] **P095 — Assistance permissions and review policy** — Accounted reference: `/settings/assistant`. Desktop static, 2026-10-03: [fixed rules and adjustable read/prepare](design/2026-10-03-settings-assistants.md); runtime unverified.
- [x] **P096 — API credentials and scoped access** — Accounted reference: `/settings/api`. Desktop static, 2026-10-03: [key register, once-only secret and scope](design/2026-10-03-settings-api-keys.md); runtime unverified.
- [x] **P097 — Backups, provider configuration and recovery** — Accounted reference: `/settings/backup`. Desktop static, 2026-10-03 (self-hosted profile; targets vs proven results): [backups and restore test](design/2026-10-03-settings-backups.md); runtime unverified.
- [x] **P098 — Message inbox connection and intake settings** — Accounted reference: `/settings/whatsapp`. Desktop static, 2026-10-03 (e-mail and upload channels; messaging apps not available): [inbox and intake](design/2026-10-03-settings-inbox.md); runtime unverified.

## 17. Firm portfolio

- [x] **P099 — Client portfolio: attention, responsibility and period context** — Accounted reference: `/byra`. Static, 2026-10-03: portfolio with attention and period context (V1) ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **P100 — Client directory and relationships** — Accounted reference: `/clients`. Static, 2026-10-03: client portfolio with responsible person and period state (V1), add client (V10) and relationship start dates (V13). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P101 — Client access and responsibility detail** — Accounted reference: `/clients/access`. Static, 2026-10-03: access per client and person with pending invitation that grants nothing (V13). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P102 — Firm-wide preparation policies and per-client exceptions** — Accounted reference: `/byra/automations`. Static, 2026-10-03: firm defaults and per-client exceptions, approval policy fixed to a person (V14); editing a policy is not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P103 — Client comparison with comparable periods and source basis** — Accounted reference: `/byra/kpi`. Static, 2026-10-03: same-period comparison with basis and a non-comparable client (V15). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F040 — Client assignment/handoff and return to retained portfolio filters**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: change of responsible person from a filtered portfolio, with the filters kept visible, access explicitly unchanged, and a note that the client leaves the list when it no longer matches (V18). A multi-client handoff is not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 18. Automation and guidance

- [x] **P104 — Preparation rules register** — Accounted reference: `/rules`. Static, 2026-10-03: rules register (V2) ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **P105 — Rule detail, conditions, preview and history** — Accounted reference: `/rules/[id]`. Static, 2026-10-03: rule detail (V8); preview and history are only partly drawn ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **P106 — Guidance and retained knowledge with source history** — Accounted reference: `/agent-knowledge`. Static, 2026-10-03: retained notes with source and author, derived notes unused until a person confirms (V16). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P107 — Assistance capabilities and their permissions** — Accounted reference: `/skills`. Static, 2026-10-03: assistant roles and policy (T2, T11); approving, posting and paying stay with a person ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.

## 19. Integrations

- [x] **P108 — Integrations directory; exclude marketplace commerce** — Accounted reference: `/extensions`. Static, 2026-10-03: integrations directory, with direct bank and authority connections explicitly absent (V11). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [ ] **P109 — Integration category** — Accounted reference: `/extensions/[sector]`. Open question, 2026-10-03: OpenERP lists three integrations in one directory (V11) and has no categories, so a category page would be empty. Proposed disposition: covered by V11; needs owner confirmation.
- [x] **P110 — Integration detail, permissions and connection flow** — Accounted reference: `/extensions/[sector]/[extension]`. Static, 2026-10-03: integration detail with granted and not-granted permissions and connect step (V12). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P111 — Connected integration workspace** — Accounted reference: `/e/[sector]/[slug]`. Static, 2026-10-03: connected email inbox with intake address and per-mail result, nothing booked by arrival (V17). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 20. Intake and specialist work

- [x] **P112 — Source-led intake, replacing the conversational entry** — Accounted reference: `/chat/intake`. Static, 2026-10-03: P7 replaces the conversational entry with a source list (files, forwarded e-mail, bank event, webshop), a file drop area and the three-step path: source kept unchanged, extracted values shown beside the original, nothing booked until approved; amounts come from the source. Webshop and bank-event sub-flows not drawn separately. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P130 — Historical bookkeeping import: preview, review, receipt and recovery** — current scoped route: `/entities/:entityId/books/:bookId/history`. Static, 2026-10-03: preview with row results (Q8), conflict resolution (Q14), operations list (Q9) and failed-operation receipt with safe continue (Q13). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P131 — Specialist operations and durable recovery directory** — current scoped route: `/entities/:entityId/books/:bookId/tools`. Static, 2026-10-03: operations directory with resumable, failed and completed states and the next safe step (Q9). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

Additional screens, subviews or flow steps:

- [x] **F041 — Operation detail: resumable work, status, receipt and safe recovery**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: failed operation detail with a receipt of what was saved before the failure, what was not handled, what the operation booked (nothing), and a safe continue that does not repeat saved rows (Q13), consistent with the operations list (Q9). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **F042 — Opening balance review and first-period readiness**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: opening balances from a retained SIE file with balanced totals, readiness checks (balanced, accounts exist, bank balance not yet reconciled) and a send-for-approval step; nothing is booked before approval (U31). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **F043 — Import conflict and retained-source detail**. Route/overlay assignment to be recorded during design. Static, 2026-10-03: conflict detail showing the unchanged source rows, what is wrong, three ways to handle the row, and that saving a choice books nothing and never changes the source file (Q14), reached from the import preview (Q8). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## 21. Help, legal and developer pages

- [x] **P113 — Contextual help and help home** — Accounted reference: `/help`. Static, 2026-10-03: help article and first-week guide (W1, W5) ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **P114 — Privacy policy** — Accounted reference: `/privacy`. Static, 2026-10-03: privacy policy page, example text not legally reviewed, retention period marked undecided (W10). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P115 — Data-processing agreement** — Accounted reference: `/dpa`. Static, 2026-10-03: data-processing agreement page, example text, sub-processor list marked undecided, no signing (W11). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P116 — Developer documentation home** — Accounted reference: `/docs/api`. Static, 2026-10-03: developer documentation home with shared documentation navigation (W12). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P117 — API reference index** — Accounted reference: `/docs/api/reference`. Static, 2026-10-03: API reference and authentication (W2, W6) ([ledger](design/2026-10-03-full-ui-completion.md)). Desktop static; runtime unverified.
- [x] **P118 — API resource reference** — Accounted reference: `/docs/api/reference/[slug]`. Partial, 2026-10-03: reference frame (W2) covers one resource; per-resource template not generalized. Resolved 2026-10-03: W14 generalizes the reference template with a write endpoint (summary, request fields, response, errors); totals are never request fields. Endpoint names are illustrative design content, not checked against an implemented API. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P119 — Workflow recipe** — Accounted reference: `/docs/api/cookbook/[slug]`. Static, 2026-10-03: W15 recipe template with numbered steps; the upload is kept as evidence and a person approves. Endpoint names are illustrative design content, not checked against an implemented API. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P120 — Agent/MCP connection guide** — Accounted reference: `/docs/api/connect-claude`. Static, 2026-10-03: assistant connection guide stating what an assistant cannot do (W13). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P121 — Localized connection guide; reuse the same considered template** — Accounted reference: `/docs/api/anslut-claude`. Static, 2026-10-03: W16 is the English counterpart of W13 on the same template, with a language switch. Endpoint names are illustrative design content, not checked against an implemented API. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P122 — Errors and recovery reference** — Accounted reference: `/docs/api/errors`. Static, 2026-10-03: errors and recovery reference including unknown outcome (W7). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P123 — Versioning guide** — Accounted reference: `/docs/api/versioning`. Static, 2026-10-03: W17 states what is breaking, and that the deprecation period is not yet decided. Endpoint names are illustrative design content, not checked against an implemented API. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P124 — Event delivery guide and configuration flow** — Accounted reference: `/docs/api/webhooks`. Static, 2026-10-03: events guide (W8) with the connect flow in V12. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **P125 — API changelog** — Accounted reference: `/docs/api/changelog`. Static, 2026-10-03: changelog with a deprecation entry, example data (W9). [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

## Daily-work implementation plan UI crosswalk

This crosswalk brings the user-facing parts of the 2026-10-03 daily-work implementation plan into the Paper backlog. “Plan P01–P13” refers to that plan's delivery units, not the screen IDs above. Existing reviewed frames cover only the behavior they show; keep the additional obligations below open until their design evidence is recorded. Keep every state synthetic and distinguish intended design from implemented behavior.

| Plan unit | Existing Paper coverage | Additional design coverage |
| --- | --- | --- |
| Plan P01 — preserve list context and focus | F001, P017, P018/P126 and F010 define shell, queue and panel returns. | Carry the same company, book, filters, selection and keyboard focus through every new panel or result destination. |
| Plan P02 — invoice editor and preview | P026/P028, P034/P035, F015 and P090 cover the current editor, saved draft, articles and customer defaults. P092 is a separate document-layout settings surface. | Compare materially different editor compositions using the same invoice before settling P026; article defaults and content-template application remain open. |
| Plan P03 — evidence beside accounting decisions | P055, P128 and F016 place the original beside read facts, proposed treatment and review lineage. | Reuse these relationships in any new document or invoice state; never imply the original itself approves a treatment. |
| Plan P04 — unfinished document work | P017, P018/P126 and P053/P054 cover attention, the queue, archive and document questions. | Show the occurrence-owned path from retained document, through supplier-draft preparation, to acceptance review without a duplicate task or a gap between tasks. |
| Plan P05 — searchable document library | P053/P055 cover archive search, type/year filters and document detail. | Add reviewed supplier, document-date, currency, exact-amount and linked-record filters; identify the matched field and its provenance. Keep retained-at date separate and state that arbitrary OCR-body search is outside the initial scope. |
| Plan P06 — customer and article defaults | P026, P032, P034, P090 and F015 cover the editor, customer/article records and invoice settings. | Show which defaults are copied when a draft or row is created, and make clear that later changes do not rewrite existing drafts or issued invoices. |
| Plan P07 — reusable invoice content templates | P026 covers the editor; P092 covers document-layout templates and preview. They are separate concepts. | Design content-template create/revise/archive/select. It copies supported commercial rows, terms and customer-facing note into a normal draft, requires an explicit replacement choice over nonempty rows, and never sets legal identity, invoice number, issue date or recipient authorization. |
| Plan P08 — recurring invoice drafts | P030 covers schedules that create drafts, never issue or send; F019 is still open. | Design occurrence review/history, pause/resume/end, and missed or retried draft recovery; show that a cycle produces one resumable draft. |
| Plan P09 — reminders and delivery outcomes | F014 covers the message preview and separates dispatch, delivery and recorded outcome. | Add authorization, cancellation, and an unknown dispatch outcome with a safe recovery path that does not create a second attempt. The approved digest covers invoice revision, residual, recipient revision, exact message bytes and attachments. |
| Plan P10 — qualified cash basis | F036–F039 show an observed opening point, contribution detail, scenarios and saved snapshots; P089 covers banking setup. | Design capture of the selected source accounts, as-of date, recorded cutoff, assumptions and qualification gaps before a basis is retained. |
| Plan P11 — prospective cash forecast | F036–F039 cover the dated forecast, contributions, delayed-payment scenario and saved snapshots. | Show baseline and conservative same-day ordering, the assumption behind the ordering, negative headroom, and the contributions that explain the minimum. |
| Plan P12 — actionable overview figures | P020, P017/P126, P019 and F036 provide dated overview facts and destination patterns. | Add full-population attention counts by reason, overdue residual by currency with unknowns explicit, qualified obligations and forecast minimum; link each value to the same scoped source population and show its cutoff/coverage. |
| Plan P13 — scoped workspace search | F001, P025, P053 and P061 provide shell and local register searches. | Design one search scoped to the active company and book across invoices, vouchers and documents, with typed results, match reason, provenance, authority limits, keyboard use and return to search. State that initial search excludes raw OCR body text. A user without document authority sees no document names, snippets or counts. |

Additional Paper work still required:

- [x] **MID-UI-01 — Compare invoice editor compositions.** Use one synthetic invoice to compare inline document editing with a persistent document preview. Inspect Accounted's matching flow, record both Paper compositions and the reason for the chosen P026 direction before invoice-editor UI work begins. Static, 2026-10-03: both compositions drawn on one synthetic invoice (Skogsbruk Nord AB, 20 000,00 plus 5 000,00 moms): A is M25 (edit directly in the document), B is M9 (form with persistent preview). Working direction stays B for P026, reasons in the ledger; Accounted's flow was not re-inspected in this pass and the choice awaits owner confirmation. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-02 — Complete the document-work handoff.** Show one retained occurrence enter Att göra, move through supplier-draft preparation and acceptance review, and return to the correct queue/source context. Make task identity and counts clear at each handoff. Static, 2026-10-03: handoff drawn as L1 (queue, scan row 'Typ saknas'), L8 (supplier-draft preparation by Sara Lind, extracted values beside the image, back link to Att göra), L9 (return to Att göra: same task, now 'Förslag v1, ny', count unchanged at 7 and Granska och godkänn at 3) and L2/L6 (acceptance review by the approver). Task identity is the document, not a new row. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-03 — Extend document-library search.** Design the metadata filters and result states above, including matched-field provenance, no matches, and unavailable fields. Do not present general OCR text search as supported. Static, 2026-10-03: P8 shows metadata filters (Typ, Period, Kopplad till, Belopp), matched-field provenance in a 'Träff i' column, and 'Ej tillgängligt' for an unavailable amount; P9 shows the no-match state. Both state that text inside documents is not searched. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-04 — Show customer/article defaults in invoice creation.** Make the source and revision of copied terms, currency, language, recipient reference and article values legible when they enter a draft; identify unqualified tax inputs and unverified delivery contacts; require an explicit choice before replacing values already in a draft. Later default changes affect new work only. Static, 2026-10-03: M26 shows each copied value with its source and revision (kund revision 3, artikel revision 2), an unverified delivery contact, a missing VAT treatment that blocks issue until chosen, an explicit keep-or-replace choice for a payment term the user changed, and the rule that later register changes affect new drafts only. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-05 — Design invoice content-template editing and application.** Show supported commercial rows, terms, customer-facing note, revision, save/cancel and application to a normal draft. Keep this separate from P092 document-layout settings; preserve earlier drafts and issued documents. Static, 2026-10-03: M27 edits a template (SEK, 30 days, one row 2 h at 1 000,00 plus 25 % moms = 2 500,00, customer note) as a new revision with revision list, archive and save/cancel; document layout stays under Inställningar, Fakturering (P092). M28 applies revision 3 to an existing draft with an explicit replacement acknowledgement, listing what is replaced and kept. Earlier drafts and issued invoices are unchanged. Archive-race and stale-revision refusals are not drawn. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-06 — Design recurring occurrence recovery.** Extend P030/F019 with a due occurrence, created draft, missed/failed creation, retry or recovery, and pause/end history; no state may imply automatic issue or sending. Partial, 2026-10-03: due, created, failed and retry shown in M21; pause and end history not drawn. Resolved 2026-10-03: M29 pause (history entry with actor and reason, no catch-up for passed occurrences, resume shows the next occurrence) and M30 end (read-only history, no resume, new schedule from the template). No state implies automatic issue or sending. Pause reason and irreversible end are design proposals pending owner confirmation. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-07 — Design reminder authorization and uncertain outcome.** Extend F014 with the exact frozen invoice revision, residual, recipient revision, message bytes and attachments; separate authorization and dispatch; show cancel-before-dispatch and an unknown result that is investigated before any retry. Partial, 2026-10-03: reminder overlay (M10) drawn; frozen revision, authorization split and uncertain outcome missing. Resolved 2026-10-03: M31 freezes invoice revision 2, residual 18 750,00, recipient revision 3, message size and checksum and attachment checksum, with approval by Elin Sund separated from dispatch and cancel before dispatch; M32 shows an unknown outcome (no provider answer) that locks resending until an investigation result is registered. Checksum values are synthetic. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-08 — Design cash-basis capture and qualification.** Show selected bank/control accounts, as-of and recorded cutoff, opening evidence, assumptions, excluded populations and why a proposed basis is complete or blocked. Static, 2026-10-03: S14 (blocked: EUR receivable without verified rate, undated rent notice; skattekonto excluded) and S15 (qualified: accounts 1930/1510/2440, as-of 3 okt, bank cutoff 2 okt, opening 182 450,00 from the statement, named assumptions, excluded skattekonto) draw the capture before a basis is saved. 'Cash basis' here is the forecast basis (plan P10), not the VAT cash method. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-09 — Extend forecast comparison.** Show baseline and conservative same-day ordering, negative headroom, exact minimum date and contributing entries, and how a changed source makes a saved result stale. Static, 2026-10-03: S16 compares inbound-first and outflow-first same-day ordering on basis 1 (minimum 182 450,00 vs 169 950,00 on 12 okt, headroom +7 450,00 vs −5 050,00 against a user-entered 175 000,00 limit, contributing entry named); S17 shows a saved result marked inaktuell after a source change, left unchanged, with recalculation as a new version. The limit is a user value, not a system limit. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-10 — Extend the overview for actionable figures.** Use full synthetic populations and show per-value basis/cutoff, explicit unknown residuals, source coverage, and direct drill-down to the exact filtered work, invoice, obligation or forecast. Partial, 2026-10-03: drill-downs S7, S12 exist; overview figures with unknown residuals not extended. Resolved 2026-10-03: K22 lists each overview figure with its basis and cutoff, an explicit unknown residual (3 unbooked documents with 1 lacking an amount; 8 750,00 unmatched bank difference; 1 EUR receivable without a verified rate), a source-coverage panel and a drill-down to the exact work. Drill-down destinations are the existing Att göra, Bank, Försäljning and Inköp frames, not new filtered views. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.
- [x] **MID-UI-11 — Design the unified scoped search.** Include open/close focus, keyboard result selection, type filtering, loading/no-match/error states, book-switch clearing, access-limited document results with no unauthorized names/snippets/counts, and return to the same search after opening a result. Partial, 2026-10-03: open palette with grouped results (L7); loading, no-match, error and book-switch states missing. Resolved 2026-10-03: L10 draws loading, no-match, error and an access-limited state that is identical to no-match (no names, snippets or counts of hidden documents); L11 draws type filters, keyboard selection, open/close focus return, company switch clearing the search and the return link to the same search. L7 remains the open palette with grouped results. Drawn as state boards, not as live-overlay frames. [Ledger](design/2026-10-03-full-ui-completion.md). Desktop static; runtime unverified.

For each item, save the Paper frame link and design decision in the relevant area ledger, then check it only after desktop inspection and its meaningful flow/state coverage. Respect the owner's current narrow-layout deferral; plan-required keyboard, narrow-width and 200% runtime checks remain separate implementation evidence. This crosswalk records design scope; it does not claim implementation or runtime verification.

## Source-route dispositions

These entries remain visible in coverage. They are product decisions, not completed designs. Reopen them if the owner changes scope.

| Accounted route | Disposition | Target treatment |
| --- | --- | --- |
| `/chat` | Omit standalone primary destination | Assistance belongs within a task and its evidence context. |
| `/chat/new` | Omit standalone primary destination | Use contextual assistance rather than a separate conversation-first flow. |
| `/chat/[id]` | Omit standalone primary destination | Preserve relevant explanation/history at the owning record. |
| `/settings/billing` | Deferred product boundary | Subscription administration requires a separate scope decision. Do not silently invent it. |

## OpenERP source URL coverage

This is a mapping inventory, not a visual reference or a fixed target navigation. Every OpenERP URL maps to checklist work. `:entityId` and `:bookId` remain explicit context; target route names may be refined.

| Current source URL | Checklist items |
| --- | --- |
| `/` | P001, P009, P017 |
| `/companies` | P009 |
| `/firms` | P099 |
| `/intake` | P024, P112 |
| `/entities/:entityId/books/:bookId` | P017 |
| `/entities/:entityId/books/:bookId/accounts` | P021, P022, P023 |
| `/entities/:entityId/books/:bookId/banking-setup` | P089 |
| `/entities/:entityId/books/:bookId/books` | P060, P061 |
| `/entities/:entityId/books/:bookId/closing` | P079 |
| `/entities/:entityId/books/:bookId/overview` | P020 |
| `/entities/:entityId/books/:bookId/purchases` | P043, P044, P053 |
| `/entities/:entityId/books/:bookId/reports` | P076, P077 |
| `/entities/:entityId/books/:bookId/sales` | P025, P037 |
| `/entities/:entityId/books/:bookId/settings` | P082 |
| `/entities/:entityId/books/:bookId/setup` | P012, P013 |
| `/entities/:entityId/books/:bookId/work` | P126 |
| `/entities/:entityId/books/:bookId/reviews/:planId` | P127 |
| `/entities/:entityId/books/:bookId/reviews/:planId/:revision` | P128 |
| `/entities/:entityId/books/:bookId/tax` | P129 |
| `/entities/:entityId/books/:bookId/history` | P130 |
| `/entities/:entityId/books/:bookId/tools` | P131 |

## Final product audit

- [ ] Every one of the 150 source routes has a target mapping or explicit disposition; every added intended screen has a route or overlay assignment.
- [ ] Primary journeys connect entry → company → task → detail/review → result → retained register/queue context.
- [ ] Screens were designed for their own jobs; registers, editors, reviews and setup were not forced into one layout.
- [ ] Company, book, period, currency, evidence basis and state remain clear through the journeys.
- [ ] Prepared, approved, posted, paid, submitted and accepted stay distinct.
- [ ] Narrow, long-content and localization designs have been inspected; actual keyboard, screen-reader, reduced-motion and 200% runtime checks are recorded separately.
- [ ] Missing product facts and implementation dependencies are documented outside product UI, with no unsupported real-world outcome claims.
- [ ] Final screenshot review confirms typography, spacing, alignment, contrast, artboard fit and visual consistency.

## Reference limits

The historical route index reported 118 Accounted captures/redirects and 11 unavailable-record/token cases. The full previous image set is not available locally. Inspect actual Accounted states as work reaches each screen; do not assume an inventory row proves visual inspection. Missing source records constrain reference evidence, not target design. Historical OpenERP test captures are engineering evidence and are excluded from this design work.

## Status 2026-10-03: full-UI pass in Paper

Paper pages 01 to 12 now hold the current design for the whole product inventory (Att göra, Försäljning, Inköp, Bank, Dokument, Bokföring, Skatt och löner, Rapporter och bokslut, Inställningar, Start, Byrå, Hjälp och API). Frames, fixtures and open items are listed in `docs/design/2026-10-03-full-ui-completion.md`. This is working design only: no frame is implemented or runtime-verified, and the per-item ticks above were not re-evaluated by this pass.

## Status 2026-10-03: reconciliation under owner permission

The owner approved the current L to W screens and the component board as the provisional desktop baseline and allowed the checklist to be maintained without naming each tick. A tick records static design coverage only, not owner approval of every detail, implementation or runtime verification. Items ticked in this pass link the current frames in the [full-UI ledger](design/2026-10-03-full-ui-completion.md); partial items state what is missing. Items without a current frame, F002 (deferred), the ROT/RUT, payroll working flows, history import, integrations and legal pages remain open. Previously ticked items were not re-audited in this pass.

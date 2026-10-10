# Accounting API layout

Feature implementation notes, handoffs and feasibility reviews live in [docs](../../docs/README.md).

`src/index.ts` composes the shared HTTP API. The Worker and Bun self-host entrypoints use that same application.

[Legal invoices](docs/INVOICE-PDF.md) and [credit-note documents](docs/CREDIT-DOCUMENTS.md) use the owned [pdfcn/Takumi adapter](src/adapters/pdf/pdfcn/UPSTREAM.md) with exact retained amounts, bundled fonts and immutable issued facts. Credit notes have a scoped PDF artifact workflow and an effect-mq consumer. Rendering keeps financial issuance, current artifact state, VAT consequences and customer delivery separate.

```text
src/
  index.ts                 API composition and request boundary
  application/             Shared capability execution and Effect workflows
    company-profiles.ts    Capability-specific company admission operations
    company-profile-basis.ts  Pure family/date profile selection and overlap checks
  transport/
    http/
      routes/              REST handlers grouped by accounting area
      auth.ts              Request authentication and origin checks
      body.ts              Bounded request admission
    mcp.ts                 MCP protocol and shared capability dispatch
  db/
    connection.ts          Scoped PostgreSQL connection and Drizzle adapter
    transaction.ts         Transaction ownership and sanitized failures
    identity.ts            Admission and current authority locks
    commerce/, banking/    Scoped domain persistence
    company-profiles.ts    Company admission reads and DML
    schema.ts              Typed application and maintenance table mappings
    auth-schema.ts         Better Auth table mappings
  adapters/
    auth/                  Better Auth integration
    storage/               Retained-object access and R2 adapter
  runtime/
    environment.ts         Request-scoped bindings
    cloudflare.ts          Request-scoped API Worker entrypoint
    preparation-queue.ts   effect-mq job definition, dispatcher and handler
migrations/                Reviewed three-file baseline plus forward migrations
scripts/                   Stable Bun maintenance, self-host and recovery entrypoints
```

`bun run --cwd apps/api jobs:preparation` starts the persistent preparation runner with
`DATABASE_URL` and a dedicated `OPENERP_PREPARATION_TOKEN`. The runner owns the queue listener
and a pool capped at eight connections. The API admits work in PostgreSQL; the runner rediscovers
ready preparation records and enqueues deterministic jobs. Hosted deployment of this Bun process
is separate from the Alchemy Worker stack.

HTTP and MCP share `application/capabilities/`, which dispatches to named Effect operations. Operator-only HTTP commands remain absent from the ordinary MCP catalog. The SQL statement registry and `db/query.ts` have been removed. VAT and SIE calculations use pure functions from `@open-erp/jurisdiction-se`. Application workflows do not import transport handlers. HTTP handlers construct book scope from entity/book identifiers only; resource identifiers stay separate so they cannot alter sealed scope digests.

`application/authority.ts` is the single owner of authentication-basis gates (ADR 0020). Operations call `authorize(principal, gesture)` or, for gestures a book may reserve to a present person, `authorizePresent(...)` with the exact request; no operation branches on `principal.kind`. Operator membership remains in `db/identity.ts`. [0104-presence-proofs.sql](migrations/0104-presence-proofs.sql) adds the per-book authority policy and WebAuthn presence records; [0105-posting-mandates.sql](migrations/0105-posting-mandates.sql) adds standing supplier-acceptance mandates. The runtime role reads the policy and enrollment tickets but cannot write them; `bun run authority:policy` and `bun run authority:ticket` are the operator console.

`@open-erp/domain` owns shared accounting models and errors. `@open-erp/contracts` owns wire commands, routes and capability metadata and preserves the existing accounting schema exports. Neither folder movement nor a new package changes the supported accounting profiles.

The application owns accounting policy, authorization, calculations, workflow decisions and scoped writes. PostgreSQL owns relational records, the reviewed DDL, constraints, grants, row locks, aggregate integrity and durable receipts. The runtime role receives the required table/column grants; the database does not execute feature workflows through procedural functions. Use one scoped transaction and pass it through nested persistence. A financial group commits its register effects, approval use, counters, receipt and outbox intent together. See [ADR 0010](../../docs/adr/0010-application-owned-accounting-replacement.md).

Fresh databases use [0001-schema.sql](migrations/0001-schema.sql), [0002-integrity.sql](migrations/0002-integrity.sql) and [0003-roles.sql](migrations/0003-roles.sql). The superseded 198-file chain has been removed. The migrator refuses old migration receipts and changed checksums; recreate an explicitly disposable development database instead of upgrading the old schema. The baseline retains 17 functions for canonical hashes, immutable records, balanced vouchers, calendar relationships and version maintenance. Only `canonical` and `digest` are runtime-callable. Private integrity helpers have fixed search paths and no public execution grant. Completion evidence records the final allowlist, grants, runtime journeys and restore checks.

[0018-next-29.sql](migrations/0018-next-29.sql) adds recurring invoice occurrences: the
immutable agreement, its immutable template revision boundaries, its immutable
pause, resume and end events, the immutable occurrence, and the append-only
per-component billing coverage consumption. Occurrence identity is
`UNIQUE (book_id, agreement_id, cycle_ordinal)` and contains no template
revision, and the invoice draft key is derived from that pair alone, so amending
a template cannot re-identify a cycle that is already issued. Coverage is unique
per occurrence and charge component and retains the legal document number and the
ledger receipt. It declares no function; it reuses the baseline `immutable_row`
guard and the `digest` check helper, and carries its own runtime grants. The
existing E2E suite applies the checked-in migration chain to disposable PostgreSQL
and verifies rerun/checksum behavior; this is not proof of every recurring-invoice journey.

A cadence or anchor amendment is a third immutable record family,
`recurring_invoice_agreement_schedules`, with the same boundary discipline as a
template revision. Before it is written, every already-materialised cycle is
recomputed under the proposed schedule and must land on the date and service start
it was frozen with, so a monthly-to-quarterly change refuses instead of re-mapping
cycles that already own an occurrence.

`application/commerce/recurring-invoices.ts` owns the agreement, schedule
amendment, template revision, event, plan, materialization and read operations.
`db/commerce/recurring-invoices.ts` owns the tx-passing reads and DML, and its
write access check asks for `INSERT` on its owned write tables.
`application/commerce/recurring-coverage.ts` is the single issuance-admission
authority: both invoice issue owners ask it whether a draft's occurrence is still
unbilled and still due before anything issues, and it appends the coverage
consumption in the same financial transaction that issues the invoice. A pause or
an end that wins before issue admission blocks the invoice; a pause recorded after
a committed issue cannot undo the invoice. The pure cycle calculation is
`@open-erp/domain/recurrence`. Delivery state is not reported by this owner: the
delivery owner is the only place a send outcome is produced.

The commercial recurring draft scheduler, queue identity, selected catch-up witness, calendar basis and verification status are recorded in the recurring draft implementation note. `runtime/recurring-draft-queue.ts` is registered by the persistent preparation runner; HTTP requests do not run a background listener. Migration `0065-recurring-commercial-drafts.sql` owns its retained schedules, schedule events and cycle jobs.

The automation `recurring-rules.ts` owner is unrelated. It models bank-observation
matching rules on the `synthetic-core-v1` profile, not commercial invoice
recurrence, and the two share no table, identity or policy.

Released databases take forward migrations in filename order. [0004-next-02.sql](migrations/0004-next-02.sql) adds the capability-specific company admission record model: rule releases, reviewed company fact revisions and their reviews, reviewed account role bindings, per-family admission epochs, activations and the activation impacts a retroactive fact correction records. It declares no function: it reuses the baseline `immutable_row` guard and the `digest` check helper, and it carries its own runtime grants rather than editing the reviewed baseline. A sealed activation proposal, its approval and its no-journal receipt reuse the existing `change_sets`, `approvals` and `posting_group_receipts` identity instead of a parallel set of tables. [0005-next-13.sql](migrations/0005-next-13.sql) adds the immutable statement-snapshot header, row and contribution membership. These migrations are included in the local fresh-database E2E run; see the NEXT packet progress note for the distinct, still-unverified feature paths.

[0007-next-11.sql](migrations/0007-next-11.sql) adds the complete-book SIE4E export: the sealed capture header, the retained account/balance/journal-line membership, and the verified object bytes with their manifest. The application owns the raw balance arithmetic, the type-4 record encoding and the independent semantic comparison; the migration declares no function, no policy and no SIE calculation, and grants only `SELECT, INSERT`. `application/sie4e.ts` owns the capture, `db/sie4e.ts` the tx-passing reads and DML, and `jurisdictions/se/src/sie/sie4e.ts` the pure balances, renderer and comparison. A reviewed account classification and supported dimension treatment are required inputs. See [SIE.md](docs/SIE.md) for the released profile's limits; migration application alone does not establish complete export qualification.

[0017-next-16.sql](migrations/0017-next-16.sql) adds evidence-aware period
preparation: the frozen manifest for one requested interval, the mutable child
checkpoint, the sealed approval batch, its members and the batch-to-approval
membership. It declares one private guard function, the
`period_work_batch_member_agrees` trigger, in the same shape as the reviewed
`0002` calendar-relationship helpers: it computes nothing and refuses only a
batch member whose owner, plan, plan digest or owning review disagree with the
child row that actually prepared the plan. Every function it adds is private and
not runtime-callable.

`application/period-work.ts` owns the routing, the advance and the batch; the
pure decision layer is `@open-erp/domain/period-work`; `db/period-work.ts` holds
the tx-passing reads and DML. The advance calls the **owning** operation's public
prepare and execute, and it holds no transaction while it does: each child is
claimed in one short transaction, the owner's prepare runs, and the plan
reference is checkpointed in a second. Nesting an owner operation inside a held
transaction would open a second financial transaction, which ADR 0010 forbids.
The child `revision` and `cancel_version` are compared in the `UPDATE`'s `WHERE`
clause, so a redelivered handler updates zero rows rather than publishing twice,
and a cancellation that lands mid-prepare keeps the prepared plan as retained
evidence. `period_work_children` carries a column-limited `UPDATE` grant and the
other four tables are append-only to the runtime role.

The dispatch set is exactly the four operations that exist:
`purchases.recognition`, `purchases.credits`, `owner.operations` and
`commerce.invoice`. A bounded synthetic accrual settlement owner
now composes native payment, bank matching and allocation with full latest
cancellation in the original or a selected later open period; the original period
must also remain open. It is not a qualified real-company or period-work
dispatch owner, so `purchases.settlement` and `banking.settlement` are absent from the
router's vocabulary, the database refuses them as a routed owner, and a child that
needs one becomes a review case naming
`company_bank_settlement_owner_not_released`. Nothing here posts; a batch approval
is an operator-only human gesture over exact sealed members, it never covers a
later arrival, and calls each owner's in-transaction approval port so that the
whole gesture succeeds or rolls back together. Execution consumes those actual
owner approvals. The HTTP surface includes cancellation and cursor-bounded batch
execution; cancellation is checked inside the owning posting transaction, while
an already committed receipt remains recoverable. Queue keys include the child
checkpoint sum so bounded preparation can continue across deliveries. `reconciled` is always
`false`: a run whose children were all visited is still not a reconciled period.

[0006-next-03.sql](migrations/0006-next-03.sql) adds the owned source-line purchase
recognition: the immutable recognition with its unique economic key, the immutable
signed purchase tax components, and the mutable original-line capacities a later
supplier credit consumes. It declares no function; it reuses the baseline
`immutable_row` guard and the `digest` check helper, and carries its own runtime
grants. Its migration is exercised by the existing suite; its full purchase journey
has separate qualification and runtime-evidence requirements.

[0012-next-17.sql](migrations/0012-next-17.sql) extends the existing commerce FX
owner with a supplier direction and an explicit-fee settlement profile. It adds a
`direction` discriminator to `commerce_fx_items`, the `direction`,
`gross_book_minor`, `fee_total_minor` and `cash_source_minor` columns to
`commerce_fx_settlements`, and one table, `commerce_fx_settlement_sources`,
holding the fee and cash legs a settlement actually posted. It declares no
function and no second register: the original-unit and book-carrying release stays
the released paired-release owner's, and remaining amounts are derived from the
retained settlement rows of every profile. The signed cash carries the
settlement's sign — a receipt is `K − F`, a payment is `−(K + F)` — and the
retained `commerce_fx_settlements_profile_check` and
`commerce_fx_settlements_body_check` are replaced with direction-aware equivalents
that keep both released receivable profiles exact. A settlement source is
immutable history; a correction releases the right by its own existence, so
`db/commerce/fx.ts` derives an active consumption from the absence of a
correction rather than from a mutable flag. The shared `readLineOwners`
projection in `db/posting-admission.ts` reads the sources table, because a
settlement posts up to twenty cash legs while its `cash_line_id` names only the
first. `application/commerce/fx.ts` owns the compiler and the transaction;
`db/commerce/fx.ts` the tx-passing reads and DML.

Integration writes the settlement header before its source rows, preserving the
immediate source-to-settlement foreign key within one transaction. Fresh migration
and the existing core E2E suite pass on the combined source; the new FX fee
prepare/approve/execute journey remains unobserved under the existing-checks-only scope.

[0009-next-26.sql](migrations/0009-next-26.sql) adds the bounded supplier extraction
lifecycle: the append-only admitted request basis, its one mutable lifecycle row, and
the immutable human field decisions. It declares no function, reuses the baseline
`immutable_row` guard and `digest` check helper, and carries its own runtime grants. It
is applied by the fresh-database E2E setup. Extraction produces suggestions and source
locators only; the reviewed draft stays with the supplier draft owner and an accepted
economic document is never revised there. The built-in engine reads text media only,
so a PDF or image original is refused with a retained `media_type_not_supported`
diagnostic.

Extraction requests are service intent. The original requester remains admission
provenance; expiry of that requester's browser session does not cancel the request.
The Bun handler admits the configured API credential against current identity,
entity and book membership at capture and again at publication. Terminal delivery
settlement uses the same scoped authority. Dispatch selects only the runner's books.
Cancellation and supersession are separate publication fences. Immutable request
reads use SELECT; the mutable lifecycle row takes FOR UPDATE behind the admitted
book lock, so request history needs no UPDATE grant.

Supplier draft creation has no lifetime retained-row quota. The list endpoint and
MCP capability return live keyset pages of at most 200 heads, with optional `q`
search and a scope/search-bound `after` cursor. `count` is the returned page count;
`complete` is true only for an unpaginated matching collection, and `next` names
the continuation. Immutable revision history remains independently readable.
Duplicate pages decode retained draft revisions and batch registered candidates
through the commerce owner's live invoice projection. Both cursor kinds retain
their source-context and anchor checks.

`swedishBusinessDate` converts instants in Europe/Stockholm for book-status admission
and the web overview. The web calendar subscription refreshes at minute boundaries
and on focus/visibility changes, including a long-open page crossing local midnight.
Entered accounting dates remain plain calendar values.

The replacement is implemented, including historical financial import, impairment/disposal, schedule amendments and the commerce/purchase operations missed by the original placeholder inventory. Shared posting admission enforces domain ownership, source capacity and historical-import fences inside the financial transaction. TypeScript computes plans and canonical seals; the two pure SQL helpers remain for integrity constraints and read projections. Feature handoffs under `docs/` label the former SQL implementation as history; their migration and statement-map instructions do not describe the current runtime.

`application/purchases/recognition.ts` owns source-line purchase recognition and the
exact purchase tax components it publishes. The pure calculation is
`@open-erp/domain/purchasing`: `compileDomesticPurchase` returns the exact signed journal
group, payable, per-line deductible decision and one tax component per source line, and
`compilePurchaseCreditLines` / `compileUnpaidPurchaseCredit` release the deduction a
recognition actually recorded. Rate, deduction fraction, rounding mode, acceptance
policy, tolerance and deduction basis are reviewed inputs; there is no default rate.
The profile witness is the `vat` family resolved on the tax point date this operation
uses, and an unadmitted family is retained as its exact gaps. Purchase tax components
are deliberately not written into `vat_fact_components` / `vat_fact_revisions`, which
belong to the VAT return owner's manual, evidence-backed admission, and the VAT
`recordFact` owner refuses an independent admission of components an owned recognition
already published.

`application/company-profiles.ts` owns capability-specific company admission. It records immutable reviewed company facts, their independent reviews and reviewed account role bindings, resolves each admitted family on the date that family's own operation uses, and commits an activation, the affected family admission epoch and a no-journal receipt in one book-scoped transaction. The legal AR family keeps `commerce.legalProfile.activate` as its named owner; admission reporting reads that owner's record rather than keeping a second activation authority. `book_get_status` reports the per-family result and its blockers and never sets `productionReady`. No reviewed `rule_releases` row ships with this release, so every family currently reports a `missing_rule_release` gap until a reviewed release owner lands; that refusal is the designed behaviour, not a default.

[ADR 0009](../../docs/adr/0009-effect-mq-background-jobs.md) selects effect-mq on a separate persistent Bun worker for durable delivery. Its session-preserving listener is not part of API or financial transaction scope.

## VAT monetary qualification

The actual VAT return workflow accepts an internal `ActualVatCalculator` dependency
between capture and sealing. `vatCalculatorFor` runs the jurisdiction's
public monetary port and maps calculator failures to `Unavailable`, with no
fallback. TypeScript remains the default and still owns qualification and
readiness. An injected kernel's identity is sealed in the return's optional
`monetaryRelease` field. [Bend qualification](../../verification/bend/authority/docs/QUALIFICATION.md)
records the direct owner comparison and disposable PostgreSQL/Bun/workerd host
observations; deployment trust is reviewed separately.

## Query failures

`db/transaction.ts` sanitizes query and commit failures into `AccountingError`. It also translates allowlisted `P0001` refusals from the private integrity layer. Business refusals originate in application Effects. Availability errors map to `Unavailable`; unexpected query failures remain `InternalError`.

The installed Drizzle Effect adapter can retain bound parameters, including credentials,
in its raw query error. Keep that error inside the query boundary: do not log, serialize or
export its message, stack, parameters or cause. Public failures use a newly constructed
`AccountingError`; the default query logger is disabled. Adding query logging, tracing error
exporters or raw cause reporting requires a fresh credential-exposure review. Do not include raw database errors in response or operational logs.

The adapter does not retry queries. An unavailable response does not establish that a write rolled back. Recover an uncertain command with its original input and idempotency key, not a new command.

## Payment reminder delivery

Migration `0066-payment-reminders.sql` adds immutable exact messages, browser approvals, admitted attempts and provider observations plus the scoped mutable outbox. `application/commerce/reminders.ts` composes retained legal issuance, canonical invoice residuals, current collection holds and reviewed recipient revisions. It freezes one external identity at admission and performs provider calls outside the transaction. Reconciliation records the admitted outcome without reauthorizing contact or rewriting the original message. Historical collection actions retain `sendAuthorized: false`.

The persistent preparation runner registers `runtime/reminder-queue.ts`. Reminder transport is disabled by default. Its only selected adapter is `OPENERP_REMINDER_DELIVERY=local-fixture`, with a bare `http://127.0.0.1:<port>` origin and an authenticated fixture secret. No live provider configuration is available. See [the reminder contract and failure vectors](../../docs/operations/payment-reminders.md). Initial missing-route red proof exists; full runtime, recovery inventory and timing proof remain open.

Historical planning links and captures omitted from this source distribution remain in the private working archive.

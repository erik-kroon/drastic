# Architecture and ownership

Status: existing ownership is established by [AGENTS.md](../AGENTS.md); accounting implementation is partial and the application-owned replacement is a working design. [ADR 0001](adr/0001-checkout-runtime-and-accounting-boundary.md) records the runtime baseline; [ADR 0004](adr/0004-complete-accounting-delivery-contract.md) records the financial delivery boundary; [ADR 0010](adr/0010-application-owned-accounting-replacement.md) records the selected ownership, clean baseline, caller cutover and no-compatibility decision.

## Repository ownership

This map defines ownership. The [planning baseline](plans/evidence/planning-baseline.json) is a dated source inventory; the [roadmap](roadmap.md) records evidence and remaining gates.

| Owner                | Observed responsibility                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | TanStack Start/Router, request-scoped TanStack Query, Paraglide and product composition.                            |
| `apps/api`           | Effect 4 Worker/Bun runtime, shared accounting operations, transaction-passing persistence, PostgreSQL integrity and runtime/maintenance adapters. |
| `packages/domain`    | Accounting values, exact-money schemas, ledger/book models and domain errors, without transport or runtime imports. |
| `packages/contracts` | Effect Schema API contracts composed from domain models; generated OpenAPI at `/api/openapi.json`.                  |
| `jurisdictions/se`   | Pure VAT draft calculation and SIE 4I rendering, using retained contract inputs.                                    |
| `packages/ui`        | Owned interface components, StyleX tokens and global styles.                                                        |
| `packages/config`    | Shared strict TypeScript configuration.                                                                             |
| `infra/alchemy`      | Web/API Worker deployment definition and service binding.                                                           |

The browser calls same-origin `/api/*`. Vite proxies it locally; the deployed web Worker forwards it through the API service binding. The web server has no accounting database connection. The API sets `Cache-Control: no-store`; database caching is configured separately.

## Target flow

The diagram is the selected complete architecture. Initial operations and persistence exist; object/archive, durable delivery, domain depth and provider coverage require the packet-specific implementation and proof in the [complete plan](plans/README.md).

```mermaid
flowchart TD
    Human[Human review] --> Web[React / TanStack web]
    Web --> API[Effect API Worker]
    Agent[External agent] --> Transports[REST / MCP adapters]
    Transports --> API
    API --> Operations[Shared typed application operations]
    Operations --> Domain[Deterministic accounting calculations]
    Operations --> PG[(PostgreSQL authority)]
    Operations --> Objects[Evidence and artifact storage]
    PG --> Outbox[Transactional outbox and run checkpoints]
    Outbox --> Jobs[Planned effect-mq Bun runner]
    Jobs --> Operations
    Jobs --> Providers[Providers and isolated validators]
```

PostgreSQL owns financial records, approvals, dependency revisions, receipts and durable business-run state. Object storage holds original bytes and generated artifacts referenced by immutable manifests. Read caches and analytics are rebuildable projections. No browser cache, queue, workflow engine or model maintains an alternative accounting balance.

Keep an Effect modular monolith. The [API layout](../apps/api/README.md) separates HTTP/MCP transports, application operations, database access, runtime configuration and adapters. Shared accounting models live in `packages/domain`; existing pure Swedish VAT and SIE calculations live in `jurisdictions/se`. The jurisdiction package imports captured input/output contracts as types and the shared domain error at runtime; it does not load HTTP handlers, SQL or provider clients. Layers compose dependencies at owning Worker or Bun runtime boundaries. [ADR 0007](adr/0007-domain-and-jurisdiction-layout.md) records this extraction; additional packages still need concrete responsibilities and callers.

[ADR 0005](adr/0005-open-accounting-and-managed-services.md) keeps the accounting, jurisdiction and agent layers open under AGPL-3.0-only, with optional managed operations outside the core. The [self-host package](../infra/self-host/README.md) composes the current API and prerendered UI using Bun and PostgreSQL. Rust/Wasm extraction remains deferred until a stable pure contract and a measured consumer justify it.

Effect owns scoped orchestration, domain preparation, authorization and application policy. Application operations own direct scoped writes and pass one transaction through all nested persistence. PostgreSQL owns relational records, DDL, constraints, grants, row locks, the narrow integrity layer and durable receipts; it does not own feature workflows through procedural functions. Drizzle's native Effect PostgreSQL adapter owns application queries, using request-local connections through the native `@effect/sql-pg` client. Better Auth uses its official Promise adapter with a separately scoped `pg` connection. Typed Drizzle mappings serve direct application and maintenance queries; the three-file baseline owns the complete DDL and integrity definitions. The [shared contracts](plans/00-shared-contracts.md) define the lock order, identity, exact values and clean-baseline rules. A generic effect interpreter is not a prerequisite.

## Customer commercial draft calculation

P02 extends the existing customer draft lifecycle with an explicit commercial purpose. The API accepts quantity, price, discount, charge and a retained reviewed tax-policy reference; it derives line and document amounts inside the scoped owning transaction. The shared pure calculator is consumed by draft preparation and legal admission. Commercial revisions retain their input digest, policy references and derived facts. Source-transcription revisions keep their asserted base, tax and source totals; older immutable JSON bodies are not rewritten.

The browser consumes `/commerce/invoice-drafts/calculate` through TanStack Query, validates the returned scope, input digest and expected revision, and discards replies for superseded inputs. Calculated base and tax fields are read-only. Preview is not an issuance approval. The existing domestic Swedish 25% accrual owner still checks identities, effective policy, account profile, period, current dependencies and approval before consuming a legal number or posting. Unresolved treatment retains unknown VAT and gross. Customer cash-method issuance remains absent.

Current draft reads separately report the canonical editable, synthetic-issued or legal-issued lifecycle. A historical draft revision remains readable with its original digest while the current seal prevents editing. The existing legal invoice and pdfcn owners keep number, posting and frozen-document authority. The failure contract and repeatable local evidence are described in [P02 commercial drafts](plans/p02-commercial-draft-failures.md).

## Planned module boundaries

| Module                    | Owns                                                                                          | May not do                                               |
| ------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Evidence                  | Objects, import occurrences, asserted facts, source links and coverage.                       | Treat importing or matching as permission to post.       |
| Books                     | Entity/book profile, fiscal boundaries, accounts, posted journal, series and commit counters. | Allow alternative writers to bypass invariants.          |
| Accounting work           | Cases, treatment decisions, sealed changes, validation, approvals and runs.                   | Replace effects under an old approval.                   |
| Settlements and schedules | Open items, allocations, installments and their conserved amounts.                            | Post outside the shared transaction.                     |
| Rules and reporting       | Dated rules, TaxFacts, mappings, report snapshots and calculation lineage.                    | Calculate competing totals in the UI.                    |
| Obligations               | Filing versions, signing/submission state and receipts.                                       | Infer external success from local generation.            |
| Runtime adapters          | PostgreSQL, objects, delivery and external providers.                                         | Own independent business policy or financial identities. |

These are ownership boundaries, not independent deployments or tables to generate in advance.

## Book Zero and read-only Cash

[Book Zero](plans/15-book-zero-workflow-cash.md) extends these owners. The existing [company-work composition](../apps/web/src/lib/company-work.ts) and [workspace application](../apps/api/src/application/workspace.ts) are starting points for the daily-work projection; the projection cannot acquire its own invoice states or financial balances. Company profile, bank, commerce, tax, payroll, reporting and recovery operations keep their present authority.

Cash consumes versioned observations and remaining obligations from those owners. Application operations own scoped basis capture, permission checks, snapshot persistence and orchestration; pure exact calculations belong in `packages/domain` when concrete consumers are added. `packages/contracts` owns shared wire schemas and errors, `apps/web` owns views, and `jurisdictions/se` retains qualified Swedish calculations consumed by Cash. A forecast owner may own assumptions, inclusion decisions and saved results; it cannot become another bank, subledger or tax engine. The [Cash contract](plans/15-book-zero-workflow-cash.md#cash-basis-and-payment-identity) describes semantics, not a set of existing endpoints or tables.

Capture a consistent ledger/knowledge boundary and versioned inputs, calculate outside long financial locks, then recheck material dependencies before sealing a current snapshot. Keep historical snapshots readable as historical; recompute or mark stale if the basis changes. Projection watermarks prevent an older job from replacing a newer current result. Reuse the application outbox and effect-mq Bun process for bounded work. UI, REST and exposed MCP reads share semantics, with current access checked again on snapshot opening and export.

This addition does not select a new runtime, financial calculation authority, styling system or deployment. In particular, source references to Bend do not change its existing ownership or prove company correctness. NEXT-45 retains historical cash-flow reporting; Cash owns prospective scenarios only.

## Runtime and resource constraints

Use Effect `4.0.0` stable and its v4 API family; keep the Effect runtime and integration packages on synchronized versions. Retain Bun, Vite+, TanStack, StyleX, Paraglide and Alchemy. A framework upgrade is separate work. Bun is not the deployed Worker runtime; exercise the chosen database driver in local workerd before relying on it ([D-02](open-decisions.md)).

Each operation receives trusted actor/entity/book context. Connections and transactions have explicit scoped lifetimes and cleanup; mutable scope cannot live in a global singleton. A transaction uses one connection and transaction-local context. Immutable schemas and rules may be cached by version.

The authoritative Hyperdrive configuration disables query caching. API financial operations use explicit transactions with row locks and no session-level tenant context, advisory locks or `LISTEN/NOTIFY` dependency. The selected effect-mq Bun runner has a separate session-preserving PostgreSQL listener for queue delivery, with polling recovery; see [ADR 0009](adr/0009-effect-mq-background-jobs.md). The listener is not loaded in the API Worker and does not supply financial identity or state. Verify adapter support and cancellation against the selected runtime before relying on it. The [Cloudflare driver](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/) and [local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/) documentation are integration references, not proof that this checkout connects successfully.

Persist run checkpoints and outbox records in PostgreSQL. The current hosted preparation adapter uses Cloudflare Workflows and a Cron Trigger; the self-host task process is not connected yet. [ADR 0009](adr/0009-effect-mq-background-jobs.md) selects effect-mq on a persistent Bun worker to replace that background path in both installations. It consumes committed application-outbox work and calls shared application operations. effect-mq owns queue retries and leases; domain progress, current authority, cancellation versions and financial receipts remain application responsibilities. At-least-once delivery must converge through effect identities and receipts. See [Cloudflare delivery](operations/cloudflare.md) for the current implementation and the [replacement plan](plans/application-owned-accounting.md#selected-background-jobs-effect-mq) for the selected design and proof gates.

Native document validators belong behind a bounded process/container interface when needed. Deployment location, archive retention and restore are explicit decisions ([D-07](open-decisions.md)); an R2 setting alone is not a complete archival design.

## Delivery, projections and portability

Use relational records with immutable revisions and a transactional outbox. A general event-sourcing framework is not required. A delivery consumer records its `(consumer, event)` identity alongside local effects. Older events cannot overwrite a newer projection; projections expose their watermark and return not-ready or read the authority when they lag the requested snapshot. No correctness rule depends on global queue order.

Persist the selected input and result of each durable step. Cancellation stops unstarted work; undo of committed accounting effects is a separate correction. Keep database transactions free of model calls, provider requests, object downloads and rendering. Batch SQL work and bound concurrency by I/O family; measure per-book lock contention before introducing more complex locking or replicas. Final posting and readiness checks use authoritative state.

The self-host target composes the same operations with Bun, PostgreSQL, an archive store and a task process, with a validator process only where needed. Hosted operation retains explicit entity/book scope even when a single-company UI hides selectors. Tenant quotas and fair background scheduling prevent one company's import or model workload from exhausting shared capacity. These compositions require their own release evidence.

Native validators receive immutable artifacts, pinned schema/taxonomy bundles and bounded resource limits. Return input hashes, validator versions, structured diagnostics and a validation receipt. Keep process-global validator state isolated between jobs; a process boundary does not establish semantic correctness or replace the asset's usage terms.

## Customer invoice defaults and reviewed recipients

CRM owns separate immutable invoice-default and recipient revision streams for each book-scoped customer. Defaults retain calendar-day terms, the book currency, en/sv language and an optional exact reviewed recipient revision/digest. A recipient revision retains an operator-reviewed email destination, supported invoice-delivery/payment-reminder purposes, evidence, reason and actor/time. Review does not establish mailbox ownership, delivery or permission to send a message. Contact annotations confer no recipient authority.

The existing commercial calculator resolves selected defaults inside the caller's transaction and retains their copied snapshot on the draft revision. New selections must be current and scoped. An exact already-copied selection remains historical evidence during unrelated edits. Due dates use calendar days; an explicit override is recorded independently. Changing master defaults never rewrites saved drafts. The composer exposes explicit Apply/Replace actions and retains selection/override provenance in its existing recovery state.

Catalog revisions retain active/archived state and an optional qualified legal-sales-policy reference separately from free-text tax descriptions. New commercial selections bind book scope and digest and reject stale or archived revisions. Already-saved selections remain readable and issueable after archive. Source-transcription agreement checks remain unchanged. The language preference controls copied payment terms. Full document localization remains unimplemented; the legal PDF renderer produces its existing Swedish output profile.

Migration0062 adds scoped pointer/revision tables with immutable bodies and narrow runtime grants. Existing draft and article bodies remain unchanged. [P06 failure contract](plans/p06-invoice-defaults-failures.md) distinguishes proposed behavior, implementation and runtime proof.

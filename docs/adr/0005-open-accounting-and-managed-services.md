# ADR 0005: open accounting and optional managed services

Status: accepted product direction from the user's setup request. The user explicitly selected **AGPL-3.0-only throughout**. This record defines ownership and distribution intent; it does not mark unfinished accounting modules or deployment gates complete.

## Decision

Keep the accounting system open and self-hostable: ledger, exact arithmetic, approvals/corrections, source import, reconciliation, reports, jurisdiction rules and calculation, API/MCP, agent skills/workflows, capability schemas, adapters and public synthetic evaluations. Core accounting must work without a hosted OpenERP account, paid entitlement check or managed-provider credential. Access control and accounting-profile readiness still apply equally to local and hosted users.

Self-hosting means operating the application with an operator-owned database, identity/session configuration and retained evidence. It does not promise free hardware, bank access, certificates, legal review or a complete production accounting release today. Supported local capabilities must match the same capability/profile contracts used by hosted operation.

Optional commercial services may operate bank synchronization, credential custody, provider contracts, government delivery, BankID, hosted inference, managed rule-release distribution, backups/availability and support. Their commercial value is operation and service access, not withholding accounting semantics. Adapter code and provider interfaces stay open; operators can supply their own authorized arrangements when the provider supports them. A managed regulatory feed distributes identifiable open rule releases with source, applicability, review and rollback metadata; it is not the only way to install a rule pack.

Customer-derived private evaluations, credentials and operational/customer data stay outside this source repository. Public synthetic cases and evaluation tooling belong with the open implementation. Private data use requires its own consent and access policy.

## Repository and runtime ownership

Retain the existing monorepo paths. Do not rename or pre-create the many packages from the proposal. Extract a domain, provider SDK or jurisdiction package when a real consumer and coherent boundary exist. Swedish rules stay in explicit dated modules; the kernel must not accumulate scattered country branches. Additional countries are deferred until demanded and independently qualified.

[ADR 0007](0007-domain-and-jurisdiction-layout.md) implements the user's subsequent layout request: shared accounting schemas now live in `packages/domain`, existing Swedish calculations in `jurisdictions/se`, and API internals are grouped by boundary. Existing contract exports and application entrypoints remain supported. Other proposed packages remain deferred.

`infra/self-host` owns the local distribution recipe; `apps/api/scripts/self-host.ts` supplies a Bun HTTP boundary around the same API used by the Worker. It serves the existing prerendered web build. `infra/alchemy` retains hosted Cloudflare composition. Backend workflows run only at an owning runtime boundary, whether Worker or Bun; shared domain code does not start runtimes itself.

The future managed control plane belongs in a separate repository once there is actual service implementation. No private repository, remote service or credential vault is created by this decision. Keep a narrow versioned API between it and the accounting product, with scoped authority, idempotency and recoverable outcomes. This separation does not itself determine license obligations; [the licensing policy](../../LICENSING.md) applies.

## Rust and Wasm

Start with the existing Effect/TypeScript and PostgreSQL implementation. No Rust crate or Wasm runtime is introduced now. Consider extraction only after a stable pure input/output contract and independently specified scenarios demonstrate portability, performance or reuse value. SIE parsing/writing is a possible bounded candidate; it is not selected implementation work yet.

Any future kernel takes immutable values and returns values, with no HTTP, SQL, provider, model, queue or object-store access. PostgreSQL still owns locking, approval checks, voucher numbering, related effects, receipts and the commit. Cross-runtime results and failure semantics must agree. Exact TypeScript arithmetic remains valid; Rust is not a correctness prerequisite. A future project-owned Rust package follows AGPL-3.0-only unless a later explicit licensing decision changes that.

## Alternatives and consequences

A closed accounting core would prevent independent inspection and make self-hosting depend on a paid service; reject it. Moving the backend to Rust now would add a second toolchain before the domain is stable; defer it. Building an empty multi-package ecosystem would add maintenance without callers; retain current ownership. One license avoids contradictory grants across the initial workspaces, with explicit provenance handling for upstream material.

The first portability increment must start locally, serve the built UI and existing API, and reach an isolated PostgreSQL database using a restricted runtime login. Clean installation, migration refusal, restart, shutdown, origin checks and retained data have separate proof obligations. Full release still needs the existing archive, restore, identity, domain and provider acceptance gates. See [self-host instructions](../../infra/self-host/README.md) and [the architecture follow-up](../architecture-followup.md).

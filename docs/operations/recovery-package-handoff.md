# Recovery package handoff — OPS-01 / OPS-02 / OPS-04

## Release state

Implementation-ready for root review and serialized static validation. This package has **not** been formatted, type-checked, linted or run by the worker because the assignment prohibits worker process creation. Prior v1 static results do not cover these changes. No backup/restore, database read/write, server, migration, test/fixture, credential change or external action was performed. No Git commands were used.

## Exact owned files

- `packages/contracts/src/operations.ts`: v2 backup/restore contracts; recovery plan, source-release, role/schema/configuration inventory, control and diagnostic schemas.
- `apps/api/scripts/operations/cli.ts`: existing commands plus `capture-release`; backup now requires an explicit recovery-plan path instead of `none`/an undeclared supplementary directory.
- `apps/api/scripts/operations/safety.ts`: private/hardlink-safe artifact checks, persisted private JSON writes, controlled PostgreSQL exit-status errors; existing explicit target/port/identity guards retained.
- `apps/api/scripts/operations/snapshot.ts`: whole-table fingerprinting plus required current kernel/report/Better Auth tables.
- `apps/api/scripts/operations/artifacts.ts` (new): exact source-release capture/inspection, declared supplementary file/custody closure, exclusive copies and before/after hashes.
- `apps/api/scripts/operations/inventory.ts` (new): source/destination role flags/expiry/membership/grantors; locale/extension/migration/schema+ACL fingerprints; fail-closed unsupported schema/ownership/settings checks.
- `apps/api/scripts/operations/controls.ts` (new): inline evidence bytes, relational/JSON evidence closure, unsupported object-pointer refusal, voucher/receipt links, historical trial-balance reconstruction. Synthetic-profile and external-auth-token guard.
- `apps/api/scripts/operations/workflows.ts`: v2 snapshot capture/inspection/fresh restore; immutable private stage diagnostics, final quarantine verification and elapsed restore receipt.
- `docs/operations/{local-recovery,application-recovery,recovery-acceptance,recovery-package-handoff}.md`: operator commands, scope/unsupported cases, pre-implementation acceptance risks, exact blocked application admission boundary and handoff.

The existing owned `apps/api/scripts/operations/tsconfig.json` is unchanged and covers all local TypeScript files.

## Shared integration map

No new API operation, capability, Worker/Bun service composition, browser route, UI panel, table mapping, dependency or migration is required. Existing contract export `./operations` and parent `apps/api/scripts/tsconfig.json` include already cover the package. All existing SQL through0900 remains untouched. No reserved0910–0999 migration was needed.

The normal application continues to use the root-owned Drizzle Effect connection. Recovery's native `pg` maintenance session is specifically for exported snapshot/catalog inspection and new-database lifecycle; it does not claim application authorization parity or introduce a competing application adapter.

CLI entrypoint remains `bun apps/api/scripts/operations/cli.ts`. Exact commands and input-field tables are in `local-recovery.md`. Old v1 bundles lack closure information and are intentionally refused; retain them and make a reviewed v2 capture, not an in-place rewrite.

## Implemented versus blocked

**Implemented:** explicit private recovery-plan/config-custody references, complete declared file closure, current inline DB evidence closure, snapshot table/schema/ACL/migration/role inventory, exact release source capture, retained redacted diagnostics, source/destination identity/profile guards, fresh creation with connection limit zero in the initial statement, repeated reconstruction controls, final quarantine check and private receipt.

**Still blocked:** immutable remote-object/version adapter (pointers are refused), encrypted archive/key-recovery exercise, actual storage/retention profile, runtime-role application recovery, true company/source completeness, production release/cutover and writer/provider activation. Source release hashes are not built artifacts or passing validation. A data/schema hash is not financial/compliance/application proof.

**Unverified:** every native PostgreSQL/catalog/dump/restore/control query and filesystem runtime path in this package. The operator acceptance cases exist as documentation, not tests. Current supported catalog shape intentionally refuses sequences, partitions/inheritance, foreign/materialized/unlogged relations, non-plpgsql extensions, RLS/custom rewrite/security labels, role/database settings, unsupported types/function kinds or ownership, invalid indexes and disabled/unvalidated constraints rather than overclaim completeness.

## Exact application-recovery blocker

Existing `openerp.authenticate`/authorization admit credentials/sessions/memberships with `FOR SHARE` (0210/0900). That fails under PostgreSQL read-only transactions. Better Auth also owns mutable session/account/rate-limit state. Root must review a distinct inspection identity and allowlisted immutable read boundary using its Drizzle/Worker/auth composition, without removing live admission locks, granting runtime superuser, activating restored sessions or weakening normal writer/provider quarantine. See `application-recovery.md` for requirements and the concrete deferred evidence/report/receipt procedure. No global auth change is requested as a shortcut.

## Next root action

1. Review the owned diff/source and format the owned TypeScript paths with the installed formatter.
2. Run `bun x tsc --project apps/api/scripts/operations/tsconfig.json --noEmit` and bounded owned-file lint through the repository environment. Send concrete errors to the retained owner; do not weaken checks.
3. Review source/destination isolation and all catalog SQL before any separately authorized rehearsal. The v2 source release must exactly match the source's applied migration filenames/checksums, including0900; outstanding domain migrations therefore require a coherent reviewed release, not silent omission.
4. Only after separate authority, execute the documented synthetic release→backup→inspect→fresh restore procedure. Retain failure/quarantine diagnostics and do not enable an application/provider to obtain a green result. A successful CLI receipt still has application recovery blocked.


## Durable work follow-up (current source)

See [durable work recovery](durable-work-recovery.md) for the pre-edit failure contract,
implemented producer/consumer path and compatibility limits. This follow-up adds
`apps/api/scripts/operations/durable-work.ts`, extends owned `artifacts.ts`, `workflows.ts`
and `cli.ts`, and adds optional versioned fields to the existing operations contracts.
New captures/inspection/restores retain and compare complete bounded outbox/job/run/saved
request state, then bind a truthful quarantine/suspension report into the restore receipt.
No remote Workflow/provider observation, resumption, schema migration or restricted-read
promotion is introduced. Root owns shared static checks; runtime remains unverified.

## Saved posting intent closure follow-up

Implemented source-only in `apps/api/scripts/operations/controls.ts`. The failure contract was
recorded first in `recovery-acceptance.md`. The existing backup and restore workflows already
call this control; no CLI, workflow, contract, migration or quarantine change is needed.

The generic JSON evidence scan now distinguishes only the exact
`openerp.posting_saved_requests.command` input column. Missing/foreign input evidence can remain
as pending or refused intent when there is neither a committed outcome nor a command receipt at
the same book's reserved `command_key`.0310 can commit an exact older kernel request through
that key before recording a saved-request outcome, so receipt presence also requires strict
closure. Any outcome other than refused and any scoped reserved-key receipt select strict
validation; malformed receipt identity never makes input exempt.

Every other JSON column and all relational/committed evidence owners keep their prior checks.
The full JSON object set is unchanged: every evidence-reference object is counted and every
object is still scanned for unsupported external pointers. Raw request/outcome rows, dumps,
table fingerprints, durable-work inventory and recovery control counts are unchanged. This
preserves comparisons for previously valid v2 bundles without adding an artifact version or
pretending an absent outcome proves nonexecution. No request is run, rewritten or resumed.

Source review traced0310's shape-only save, caught refusal, reserved command identity trigger
and exact legacy kernel receipt path. SQL/TypeScript compilation, backup/restore and runtime
behavior remain unverified. No CLI, tests/helpers/fixtures, SQL/runtime/database/provider or
VCS actions were performed for this follow-up. Root owns static validation and independent
review; any later native recovery observation needs separate authority.

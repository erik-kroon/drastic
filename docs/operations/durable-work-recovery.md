# Durable work inventory and quarantined recovery — OPS-01/02

## Scope and failure contract recorded before implementation

Extend the local recovery bundle, not the application or provider runtime. This document first records the current pre-cutover durable-work inventory: outbox delivery counters, durable preparation jobs/run checkpoints and saved posting outcomes. Restore compares the same inventory and records database quarantine separately from unknown external worker/provider state. No command claims, resumes, stops or rewrites a job. The current source needs no migration for this inventory; the application-owned replacement later adds its queue tables to the new baseline.

```text
one exported snapshot -> private durable-work inventory -> manifest file hash
  -> offline bundle inspection -> fresh fenced restore -> repeated inventory comparison
  -> quarantine observation + suspension report (resumeAllowed: false)
```

Source-review acceptance cases (not tests):

- Use the same repeatable-read snapshot as table fingerprints and pg_dump. Refuse missing
  owned relations, unsupported retained states, broken scoped links, over-limit inventories
  and partial output. Every included family is complete, not a truncated pending page.
- Retain attempt counters and checkpoints without calling them provider attempt receipts.
  The current pre-cutover schema has no effect-mq queue history; report that limitation
  even when all local preparation jobs are empty or marked delivered. After cutover,
  capture the selected queue store's own claims/retries/attempt history separately.
- Do not expose credential hashes, sessions, raw command/outbox payloads, blocker text or
  provider tokens in the inventory or diagnostics. Preserve identifiers/digests and states.
- Extend v1 RecoveryPlan and v2 BackupManifest/RestoreReceipt additively. New backups
  always write the versioned inventory. Old v2 bundles remain readable/restorable but
  report that source work inventory was not captured; never infer an empty queue.
- An optional recovery procedure must resolve to a declared retained configuration or
  key-recovery artifact. Missing/changed references fail closed; the declaration is not
  proof that workers stopped or external outcomes were reconciled.
- Inspect exact inventory file identity, size/hash, schema, summary and snapshot bindings.
  Restored inventory must match before success. Missing original objects, privilege/schema
  comparison and all existing source/destination guards stay mandatory and unchanged.
- Record a private suspension report after ordinary restore completion/failure, including
  failed or unavailable work comparison. Claim database suspension only after its existing
  finalizer verifies connections disabled and limit zero. Unconfirmed quarantine still
  prevents a success receipt. External processes are not inspected; resume stays forbidden.
- No production promotion, new runtime admission, external calls, provider reconciliation,
  changed financial authority, test/helper/fixture or runtime exercise is authorized.

## Post-replacement queue boundary

[ADR 0009](../adr/0009-effect-mq-background-jobs.md) makes effect-mq the durable-delivery owner. At the application-owned cutover, include the pinned PostgreSQL queue schema and its claims, leases, retries and attempt history in the same clean baseline and recovery closure as the application outbox and business progress. effect-mq may redeliver or reclaim work; it cannot replace application receipts, current authority, cancellation versions or financial correction semantics. The queue's session-preserving listener is operational state, not financial transaction context.

Keep the pre-cutover preparation-job and saved-posting inventory rows where they remain meaningful, and label old bundles as historical. New bundles must distinguish queue bookkeeping, application outbox intent, domain progress and provider outcomes. No queue row is inferred to be a provider receipt, and no remote worker is assumed stopped merely because the database is quarantined.

## Implemented producer and consumer path

`packages/contracts/src/operations.ts` adds version1 work inventory/summary and suspension
report schemas. `RecoveryPlan` version1 accepts optional `workRecoveryProcedurePath`.
It must name a declared `configuration` or `key-recovery` artifact; `artifacts.ts` checks
this before capture. It is an operator recovery procedure, not an attestation of suspended
workers or reconciled provider outcomes. Omission remains explicit as `null`.

`apps/api/scripts/operations/durable-work.ts` reads the existing PostgreSQL owners:

| Family | Retained recovery facts | Deliberately not inferred |
| --- | --- | --- |
| `outbox` | Complete scoped IDs, receipt/kind, timestamps, attempts counter, payload hash | Delivered timestamp is not an external provider receipt; nonzero attempts do not establish their outcomes |
| `preparation_runs` | Complete scoped IDs, state, cursor, selected-row count, latest audit ordinal | Current actor authority or valid future resumption |
| `preparation_jobs` | Complete scoped IDs, run, requester/executor, state, checkpoint, expected audit and timestamps | Current pre-cutover source has no effect-mq queue history; valid restored credentials remain a separate check |
| `posting_saved_requests` | Complete scoped keys/actors, operation/digest, command key, saved outcome and command-receipt presence | No outcome is not rollback; a receipt without saved outcome does not justify another execution |

Only identifiers, counters, state and digests enter the artifact. Raw command/outbox
payloads, job reason text, credential hashes and session references are not copied into
this extra inventory. The private full database dump still contains sensitive accounting
and authentication state and must keep its existing handling rules.

Every family has a 10000-row limit; the JSON artifact is limited to8MiB. Both bounds fail
closed, without a truncated page. Snapshot table counts, scoped identity uniqueness,
book/run links, cursors and computed summary counts are checked. The run-audit and receipt
owners remain in the whole-table fingerprint/dump closure. The inventory does not replace
that closure. Counter sums use exact integer arithmetic, not floating-point values.

### Backup and inspection

The existing `backup` command produces `durable-work-v1.json` while it owns the same
repeatable-read snapshot exported to `pg_dump`. Its exact hash/size, summary and optional
procedure path enter `BackupManifest.durableWork` and the existing exact `files` inventory.
No manifest is complete after a failed work capture. Snapshot ID, book cutoffs and pending
outbox count are bound to the preflight from that same transaction.

Existing `inspect` consumes and validates this file's schema, bound identity/hash/size,
full family counts, summary and manifest snapshot/book/preflight bindings. It checks the
optional procedure against declared supplementary closure. An undeclared work file,
missing descriptor file, changed count/hash or invalid procedure fails. The CLI states
that provider/worker state is still unverified and no resumption is authorized.

### Restore and suspension reporting

Existing `restore` repeats the inventory from the reconstructed database in its read-only
maintenance snapshot. Comparison uses semantic object equality and ordered rows; it does
not depend on JSON property order. The source snapshot string labels the reconstruction's
source boundary; no claim is made that a restored database has the original live exported
snapshot. Table/schema/role/evidence/report/object checks remain mandatory and unchanged.
The exact source work file is copied into the private restore output and checked again.

After the ordinary finalizer, `suspension-report.json` records:

- The source manifest digest, destination and maintenance operator.
- Work inventory comparison: `matched`, `failed`, `not-run` or `not-captured-in-source`.
- Reconstruction checks completed/incomplete, separately from database quarantine.
- Database connections `disabled` only after the existing catalog query confirms both
  `datallowconn=false` and connection limit zero. A lost CREATE response or failed finalizer
  remains `not-confirmed`; no existing destination is modified to resolve uncertainty.
- Job rows were not transitioned by recovery; external workers are `not-inspected`,
  provider outcomes are `not-reconciled`, and `resumeAllowed` is alwaysfalse.

This report is attempted after ordinary completion or failure once the destination
maintenance connection exists. A filesystem failure, process crash, early admission
failure or connection failure can prevent it. Its absence proves nothing. Existing
redacted stage diagnostics and partial output remain for inspection. No work matching
status alone is a successful restore: only `restore-receipt.json` signals that all existing
success gates passed. That receipt binds the suspension report's exact file hash/size and
keeps application recovery blocked, connections disabled and writer promotion unperformed.

The command does not call `pending_preparation_jobs`, `execute_preparation_job`, any
posting dispatcher, effect-mq store, queue listener or provider. It does not stop/resume existing source
processes or change the restored ready state. Database quarantine blocks ordinary restored
runtime access; separately privileged superusers and already-running external/source work
still require operator containment and reconciliation. Local zero pending counts cannot
prove remote absence or authorize delivery.

### Historical compatibility

The current decoder still accepts old v2 manifests/receipts and v1 recovery plans. New
backups always include the versioned work extension; old v2 bundles without it can still
be inspected and restored under the previous safety gates. Their suspension/restore result
says `not-captured-in-source` with a null source work descriptor, not an empty inventory or
a matched comparison. No old bundle/receipt bytes are rewritten. Old consumers that reject
unknown fields need this additive contract update to inspect new bundles; v1 backup bundles
remain unsupported as before.

### Integration and proof limits

No migration, dependency, route, capability, runtime service or shared dispatcher change
is needed. Existing `./operations` export and scripts tsconfig include the new module.
Static checks remain root-owned. Worker source review followed capture/inspect/restore,
private artifact bounds, same-snapshot ownership, exact schema columns, retry/attempt limits,
ordinary failure/finalizer paths and old-manifest compatibility. No backup, restore,
database query, runtime, provider call, tests, fixtures or migration was executed.

Worker static checks: targeted `oxfmt --write` completed on the five owned TypeScript
files. Targeted `oxlint` reported0 warnings/errors. Targeted `git diff --check` passed.
Shared contracts/scripts type checks remain root-owned. These observations do not prove
SQL query validity, filesystem behavior, restore consistency, crash handling or quarantine
at runtime. No runtime exercise is claimed.

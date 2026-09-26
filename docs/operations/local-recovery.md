# Local recovery: snapshot closure and fenced restore

Status: recovery package v2 has a [bounded synthetic database/object rehearsal](ops02-isolated-rehearsal.md). Its read-only application recovery, real posting receipts, historical reports, custody and hosted/production recovery remain unverified. This does not grant writer or provider activation. The package currently describes the pre-cutover source and migration chain; the application-owned replacement adds the clean three-file baseline and effect-mq queue tables to the new closure contract, with no old-schema upgrade or compatibility path.

This is not an encrypted archive, statutory retention service, company-readiness decision or production cutover tool. Private permissions are not encryption. A checksum is not authenticity or proof of successful recovery. D-07 remains open.

## Scope and version boundary

```text
private target + explicit recovery plan + captured source release
  → one exported PostgreSQL snapshot
  → table/schema/role/migration inventory + closure inventories
  → private dump + declared supplementary bytes + source release + manifest v2
  → exact file/checksum inspection and machine-readable result
  → NEW database (runtime admission fenced throughout)
  → repeated table/schema/evidence/receipt/report controls
  → connections disabled + retained stage diagnostics + restore receipt v2
  → application recovery BLOCKED; no writer/provider activation
```

The CLI refuses remote hosts, ports 15439/55472, unexpected PostgreSQL cluster identity, PostgreSQL versions other than 17, non-superuser maintenance access and source names outside `openerp_ops_source_…`. The source must contain synthetic data only. The configuration declaration and name do not independently prove this. Better Auth accounts containing external access/refresh/ID tokens are refused. Even a synthetic dump can contain session tokens and password hashes: keep it private and handle it as sensitive material.

Restore only creates a fresh `openerp_restore_…` database. It never overwrites, drops, promotes a writer, switches epochs or enables provider work. Version1 bundles lack the new closure inventory and are refused; retain them, and create a new v2 capture from a reviewed synthetic source. This tool has no conversion, cleanup or production command.

## Application-owned replacement boundary

[ADR 0010](../adr/0010-application-owned-accounting-replacement.md) replaces the current source inventory at cutover. A new release capture must contain the three reviewed baseline files and the effect-mq PostgreSQL queue schema in the same migration ledger. Application outbox rows, preparation runs/jobs, command receipts and domain progress remain durable business records; effect-mq claims, retries, leases and attempt history remain queue records. Both must be included in a complete post-replacement closure, but queue state is never treated as a financial receipt or provider acknowledgment.

The old chain is not upgraded in place. A destination that carries the pre-replacement migration identity is refused for the clean replacement and is not silently dropped or rewritten. Recovery of a new-baseline bundle still requires fresh quarantine, closure comparison and application/provider inspection before any writer or provider is enabled.

## Operator inputs

Use an independently provisioned isolated PostgreSQL 17 cluster, installed matching `pg_dump`/`pg_restore`, and a user-owned 0700 working directory. All operational output/input files must be 0600 (or more restrictive), regular, user-owned, and free of symlinks/hardlinks. Source-release code files may have normal source permissions; the capture is private. No live secrets belong in the release or supplementary procedures.

**Target JSON** remains version1 with these required fields: `dataClass: "synthetic-local-only"`, `host: "127.0.0.1"`, explicit `port`, `database`, maintenance `user`, secret `password`, decimal-string `expectedSystemIdentifier`, and absolute real `pgBinDirectory`. Use the synthetic source database for backup/preflight, and `postgres` for restore administration. Prepare this 0600 file using private tools. Never put its contents or a credential URL into arguments/logs.

**Recovery plan JSON** is a private version1 document with:

| Field                    | Meaning                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operatorId`             | Explicit operator declaration; not an authenticated approval                                                                                                                           |
| `releaseDirectory`       | Absolute private directory from `capture-release`                                                                                                                                      |
| `supplementaryDirectory` | Absolute private directory of explicitly retained artifacts/procedures                                                                                                                 |
| `artifacts[]`            | Each file exactly once: relative `path`, decimal-string `bytes`, bare lowercase `sha256`, unique `referenceId`, `kind` (`evidence`, `rule`, `filing`, `configuration`, `key-recovery`) |
| `configuration[]`        | Exactly `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; each has a non-secret `custodyReference` and `procedurePath` resolving to a configuration/key-recovery artifact       |

The plan stores key/custody identifiers and recovery instructions, **not secret values**. Procedure files must not contain passwords, tokens or private keys. Actual custody access, decryption and configuration recovery remain unexercised. Supplementary references are operator declarations; they do not establish unknown company-source completeness or prove which rules legally apply.

Source release capture includes API source/scripts/migrations, web source, contracts/UI/config source, workspace manifests and `bun.lock`. Files and inventories are checked again after copying. This is an exact **source** receipt, not a build artifact, vendored dependency archive or passing validation result. Its `runtimeVerification` is `not-run`. Non-code assets/host configuration needed for a deployment must be declared separately. Unsupported hidden/special files are refused instead of silently skipped. New captures also record the database/object/evidence/receipt/durable-work closure in the manifest; older v2 bundles without that extension remain explicitly `legacy`, not complete for the new closure contract.

## Commands — operator/root only

Run from the repository root after source changes settle. Substitute explicit absolute paths; these commands do not create credentials or provision roles.

```text
bun apps/api/scripts/operations/cli.ts capture-release /absolute/reviewed/source /absolute/private/new-release
bun apps/api/scripts/operations/cli.ts preflight /absolute/private/source.json /absolute/private/new-preflight.json
bun apps/api/scripts/operations/cli.ts backup /absolute/private/source.json /absolute/private/new-bundle /absolute/private/recovery-plan.json --confirm-local-backup
bun apps/api/scripts/operations/cli.ts inspect /absolute/private/new-bundle <independently-recorded-manifest-sha256>
bun apps/api/scripts/operations/cli.ts restore /absolute/private/admin.json /absolute/private/new-bundle <independently-recorded-manifest-sha256> openerp_restore_review_01 /absolute/private/new-restore-output --confirm-fresh-local-restore
```

Record `manifest.sha256` independently when capture finishes. A digest next to a file is not an independent authenticity registry. A PostgreSQL dump contains executable SQL; do not restore an untrusted bundle. `inspect` writes one machine-readable JSON result to standard output. `status: "complete"` means the closure extension is present and file-bound; database, evidence and receipt reconstruction remain restore checks. `status: "legacy"` means the older bundle passed its old checks but did not capture the new closure.

`preflight` remains read-only and reports authority/epochs, sessions, pending outbox and approvals. Quiet sessions are not a durable source freeze. All production gates stay blocked.

## Completeness checks

- Every ordinary user table is fingerprinted from the same exported repeatable-read snapshot as `pg_dump`. This includes `openerp_auth` sessions/accounts/rate limits, closing certificates/invalidation history and newly applied domain tables. No table allowlist limits capture; a minimum kernel/auth/report inventory prevents a partial database from appearing complete.
- Table hashes preserve duplicate multiplicity: row JSON → SHA-256 per row → sorted hashes → SHA-256. UTC/ISO dates, PostgreSQL 17 and deterministic floats bound encoding. More than 100000 rows per table is refused.
- Schema SHA-256 covers schemas, table/view/column definitions and ACLs, function definitions/ACLs, types, constraints, indexes, triggers and default ACLs. It binds observed schema bytes; it is not independent proof that no unauthorized source DDL occurred.
- Applied migration filenames/hashes must exactly match the captured release's migration set. A partial upgrade or changed/missing applied file refuses completion. No migrations are applied by recovery commands.
- New captures bind one closure record to the same snapshot: the complete table fingerprint list, the `openerp.intake_contents.object_key` owner, every retained object reference, evidence bytes and relational/JSON reference counts, every receipt table fingerprint, and the bounded durable-work inventory. The restore path repeats these comparisons. A missing inventory, object byte, evidence target or receipt table stops completion.
- Only inline evidence and the existing retained-original object shape are supported. Other pointer columns, pointer fields in JSON, object keys outside the owned `v1/<bookId>/<sha256>` format, duplicate object keys, invalid size/hash metadata, and unsupported object types are refused. Local directories and bucket-scoped R2 credentials remain the only object read owners; the manifest does not claim archive compliance or perform promotion.
- Role names, privilege flags, expiry, connection limits and explicit membership/grantor options are retained and compared before restore. Passwords are not captured in role metadata. Restore uses the same owner role name and reproduces encoding/libc locale; source-owned objects must have uniform reviewed ownership. Source/destination role passwords may differ; credentials are separately held.
- Inline evidence content hashes, relational `evidence_id` links and committed nested JSON `evidenceId` links must resolve within the row's book. Supplied evidence digests must match. Only `openerp.posting_saved_requests.command` input with no outcome or a refused outcome and no scoped reserved-key command receipt is treated as uncommitted intent. Its unresolved input references remain retained; a missing outcome alone never proves nonexecution. All JSON objects still count toward `jsonEvidenceReferences` and undergo external-pointer checks. All other columns/owners remain strict. Raw document text is not interpreted as application reference metadata.
- Voucher watermarks/balance, execution-receipt/voucher/approval links and historical trial-balance amounts are reconstructed without posting or rewriting reports. These are data controls, not application/authorization proof or independent accounting review.
- Every declared supplementary/release file must exist with exact size/hash, with no undeclared file. Configuration/key-recovery procedures must resolve. Missing content prevents a complete manifest or restore receipt.
- The owned `intake_contents.object_key` format has a versioned closure adapter: backup reads the same snapshot's references, verifies each original's hash/size and captures it under `objects/v1/...`. Restore compares the reconstructed references and recovers those files before issuing a receipt. Configure an explicit private object directory or bucket-scoped R2 read credentials as described in [Cloudflare recovery](cloudflare.md). Other object-store pointers (`objectKey`, `storageKey`, `blobKey`, version variants and snake-case forms) are still refused. Hosted R2 re-upload/application admission remains a separate unverified gate.

Sequences, foreign/unlogged/materialized relations, inheritance/partitions, non-plpgsql extensions, publications/subscriptions, RLS policies/security labels, foreign servers, custom role/database settings, invalid indexes, disabled/unvalidated constraints/triggers and unsupported ownership/function kinds require a reviewed extension and are refused. Configured source database/role settings are not exported blindly because they can carry secrets or change recovery behavior. Destination's intentional read-only quarantine default is the sole allowed setting exception.

## Quarantine, diagnostics and receipts

Database creation atomically sets `ALLOW_CONNECTIONS false` and `CONNECTION LIMIT 0`. Before restore, PUBLIC privileges are revoked and default transactions become read-only. Connections are opened only with limit zero, which denies normal roles. `pg_restore` uses the superuser's own session to override read-only; no runtime grant is introduced. Its ACL restore is preserved (`--no-owner`, **not** `--no-acl`); the owner role name must already match.

On success or ordinary failure, the finalizer disables connections and checks `datallowconn=false` plus `datconnlimit=0`. Only after that check and connection cleanup is a success receipt written. An interrupt/crash can prevent finalization, but connection limit zero was set in the original creation statement. A superuser can bypass that limit; keep all applications/providers stopped. A connection loss records quarantine `not-confirmed`, never a successful receipt.

`diagnostics/` retains immutable private stage/outcome messages, timestamps and PostgreSQL tool exit status without forwarding raw stdout/stderr, SQL, credentials or documents. Diagnostics are not part of the authoritative backup file inventory and cannot turn a partial bundle into a complete one. A failure leaves its partial bundle/database for inspection; no automatic delete conceals evidence.

`restore-receipt.json` binds the manifest digest, destination identity, maintenance-role identity, elapsed milliseconds, repeated controls, compared roles, recovered files, confirmed quarantine and explicit checks not run. `applicationRecovery` stays `blocked-restricted-read-admission`; key/config recovery and archive compliance stay unestablished. A receipt never grants release authority. The CLI inspection result likewise records writer and provider promotion as `not-performed`; it is not an application admission grant.

## Application-level procedure and blocker

Follow [application recovery](application-recovery.md) for the exact root decision and rehearsal steps. Current accounting admission takes credential/session/member `FOR SHARE` locks. PostgreSQL rejects those in a read-only transaction. Better Auth also owns mutable session/account/rate-limit tables. A superuser SQL comparison or a health endpoint is not restricted-role recovery proof. Do not change those guards, reuse restored browser sessions, enable database connections for ordinary roles, or run the normal application just to obtain a green probe.

Production remains blocked on verified storage/retention/key custody, actual company/profile facts, fenced single-writer/provider recovery, independent application exercise, reconciled acknowledged effects and separate authority. A backup older than an acknowledged posting/submission cannot be promoted as if that effect never existed.

## Durable work inventory extension (implemented source; runtime unverified)

[Durable work recovery](durable-work-recovery.md) extends the existing commands with a
snapshot-bound `durable-work-v1.json`. New backups retain complete bounded outbox counters,
preparation runs/jobs and saved posting outcome identities. `inspect` validates its full
file/summary/snapshot closure; `restore` repeats the inventory before success and copies
the original file into the restored artifact directory. Per-family limits are10000 rows;
the inventory is at most8MiB. No record is silently truncated.

Recovery plan version1 optionally accepts `workRecoveryProcedurePath`, referencing a
retained configuration/key-recovery artifact. This procedure declaration does not prove
worker suspension. Backup/restore version2 gain optional versioned `durableWork` fields;
old v2 bundles remain supported with explicit `not-captured-in-source`, never zero pending
work inferred from absence. Older strict decoders need the updated contracts for new bundles.

`suspension-report.json` records the work comparison and observed database quarantine
separately from uninspected external workers and unreconciled provider outcomes. It is
attempted on ordinary success/failure after maintenance connection admission. A successful
restore receipt binds its exact hash/size. Failure or absence of either artifact cannot
be treated as permission to resume. Ready jobs remain ready in the retained data, but no
runtime/provider is started and `resumeAllowed` is alwaysfalse. Current outbox counters
are not per-attempt provider receipts. The current pre-cutover inventory has no effect-mq queue-table history; the post-cutover closure must capture the selected queue store's claims, leases, retries and attempt history, while keeping them separate from financial receipts and provider outcomes.
The restricted-read application boundary and every existing promotion gate remain blocked.

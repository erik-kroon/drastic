# Local backup, fresh restore and cutover preflight

Status: implemented, not yet exercised. This is a local synthetic workflow, not a production backup service, compliant archive, successful application recovery, or cutover approval. D-07 in [open decisions](../open-decisions.md) remains open. No production operation is implemented.

## Boundary

```text
explicit private target
  → read-only PostgreSQL snapshot
  → private database.dump + supplementary files + manifest
  → checksum inspection (not restore proof)
  → NEW quarantined database + recovered supplementary files
  → matching table fingerprints + private restore receipt
  → connections disabled; no writer promotion
```

The CLI rejects remote hosts, the existing ports 15439/55472, PostgreSQL versions other than 17, an unexpected server system identifier, and non-superuser maintenance connections. Source names must start with `openerp_ops_source_`. The operator must explicitly attest that the source contains only synthetic data. Naming and a configuration value cannot independently establish that fact.

Restore requires a new `openerp_restore_` name. It cannot overwrite a database. It never drops a database, switches a book's authority or epoch, promotes a writer, grants application admission, submits work, or removes acknowledged history. Production commands and automatic retention deletion do not exist.

## Required operator preparation

Use an independently provisioned, isolated PostgreSQL 17 cluster. Do not use the retained development or external clusters. Use installed `pg_dump` and `pg_restore` from a real absolute binary directory. Do not point this tooling at real accounting data.

Prepare a user-owned 0700 working directory. Create a 0600 JSON target file in it using a private editor. Do not put its contents, password, a connection URL, or shell command substitution containing credentials into a command line or log.

Target fields:

| Field | Required value |
| --- | --- |
| `version` | `1` |
| `dataClass` | `"synthetic-local-only"` |
| `host` | `"127.0.0.1"` |
| `port` | Explicit isolated port; 15439/55472 are refused |
| `database` | Existing `openerp_ops_source_…` synthetic source; `postgres` for restore administration |
| `user` | Explicit local superuser role |
| `password` | Secret supplied only inside this private file |
| `expectedSystemIdentifier` | PostgreSQL cluster system identifier as a decimal string, independently read by the operator |
| `pgBinDirectory` | Absolute real path containing installed PostgreSQL 17 tools |

The database must include applied migration records and the accounting kernel. Provision source roles separately in the restore cluster. The manifest records non-system role names, but not role passwords or definitions. The restored objects belong to the restoring maintenance user. `pg_restore` preserves the dumped grants and revokes; it does not use `--no-acl`.

All file paths are absolute, user-owned and private. Existing output directories/files are refused. Symlinks and special files are refused. The operator owns the target, binary directory and bundle trust boundary; do not restore an untrusted dump. Checksums are not signatures and PostgreSQL dumps can contain executable SQL.

## Commands

Run from the repository root with Bun. These examples contain paths only; replace them explicitly. They do not prepare credentials or provision databases.

```text
bun apps/api/scripts/operations/cli.ts --help

bun apps/api/scripts/operations/cli.ts preflight /absolute/private/source.json /absolute/private/preflight.json

bun apps/api/scripts/operations/cli.ts backup /absolute/private/source.json /absolute/private/new-backup none --confirm-local-backup

bun apps/api/scripts/operations/cli.ts inspect /absolute/private/new-backup <separately-recorded-manifest-sha256>

bun apps/api/scripts/operations/cli.ts restore /absolute/private/admin.json /absolute/private/new-backup <separately-recorded-manifest-sha256> openerp_restore_review_01 /absolute/private/new-restore-receipt --confirm-fresh-local-restore
```

For non-database files, replace `none` with an explicit private directory containing the required evidence objects, filing artifacts, source/receipt exports, and pinned rule/taxonomy bundles. Every file is copied and hashed. Source/copy/source hashes must agree. Directory content and paths are operator-declared; the tool cannot discover a missing external repository or prove that it was complete at the database snapshot boundary. Stop or version external file producers separately before creating the bundle.

`none` is an explicit assertion that no supplementary files are needed for this local exercise. The current kernel retains original evidence content and command/execution receipts in PostgreSQL. Closing/certificate/history tables are included automatically when their migration is applied. No certificate is interpreted as archive compliance or statutory readiness.

Record `manifest.sha256` independently when the backup finishes. Supply that value to inspect and restore. A checksum stored next to the file detects accidental damage only; an attacker who can replace both can forge it. Keep all outputs private and out of Git. Private permissions are not encryption at rest.

## What the artifacts mean

- `database.dump`: complete PostgreSQL custom-format database dump from one exported repeatable-read snapshot. No per-table allowlist omits a newly applied domain.
- `supplementary/`: optional copies of the explicit external artifact directory. These are not asserted to share the PostgreSQL snapshot.
- `manifest.json`: source cluster identity, database and version, each book's authority/epoch/watermark, pending work observations, snapshot ID, role names, every ordinary user-table row count/logical SHA-256, and file byte sizes/SHA-256.
- `manifest.sha256`: digest of the exact manifest bytes. Not proof of restore or authenticity.
- `restore-receipt.json`: written only after `pg_restore` exits successfully, all restored table fingerprints match, supplied external file copies match, and destination admission is disabled. This is local data reconstruction evidence, not an application recovery, financial correctness, privilege equivalence, or compliant-retention certificate.

Table hashes use `row_to_json`, SHA-256 per row, sorted row hashes, then SHA-256 of their concatenation. Counts preserve duplicate multiplicity. PostgreSQL 17, UTC, ISO dates and deterministic float formatting bound the representation. `ONLY` avoids double-counting inherited/partitioned table rows. Tables with more than 100000 rows are refused. Sequences, foreign tables, materialized views, unlogged tables and large objects require a reviewed extension and are refused rather than silently omitted from logical verification. Database ACLs, role configuration, extensions and application/provider configuration need separate operator review; the row comparison does not prove them equivalent.

The preflight reads native authority and positive writer epochs for every book. It reports other sessions, undelivered outbox work and active unconsumed approvals. These are observations, not an enforceable write freeze. Even a quiet database remains blocked for production: the tool does not revoke credentials, drain jobs, verify source/target delta equality or establish company readiness.

## Failure and recovery rules

| Failure | Result / operator action |
| --- | --- |
| Wrong host, reserved port, server identity, version or source name | Refused before reading accounting content |
| Missing or non-private target/artifact | Refused; fix permissions without exposing contents |
| Existing bundle/receipt directory or restore database | Refused; choose a fresh destination, never erase prior output |
| Missing table, unsupported relation or inventory limit | Backup refused; do not claim a complete recoverable bundle |
| Dump, copy, manifest or checksum failure | Partial private output retained; no successful restore claim |
| Missing destination roles | Refused before database creation; provision reviewed roles separately |
| Restore SQL or table/artifact mismatch | No success receipt; created destination remains quarantined |
| Connection loss or process termination | Output may be partial; inspect manually. Do not retry into the same database |
| Incorrect source declaration or missing external files | Not discoverable from a checksum; operator review remains required |

A destination starts with connections disabled. Before restore, PUBLIC database privileges are revoked, default transactions are read-only and connection limit is zero. Only superusers can enter during restore. `pg_restore` overrides read-only for its own session only. A finalizer disables connections on both success and ordinary failure. If the connection/process disappears before finalization, limit zero plus read-only defaults remain; a superuser can bypass these and must not attach an application. Never treat a partial destination as live. No automatic drop or cleanup masks evidence of a failed operation.

Timeouts bound connection/query/subprocess work. Child PostgreSQL stdout/stderr are not forwarded because they may contain sensitive SQL or source data. Terminal output gives a controlled failure and leaves private partial artifacts for operator inspection; it never prints target configuration.

## Production cutover remains blocked

A production extension needs independently verified storage jurisdiction, archive provider/account/access/retention/immutability settings, recovery objectives, a full application restore exercise, source/target accounting and external receipt reconciliation, actual company/profile readiness, and separately authorized operational execution. A local backup is not that archive.

The cutover owner must also establish a durable source write freeze, drain/suspend provider work, capture the final watermark and delta, invalidate stale proposals, verify the target writer-epoch boundary, and record signed authority for an atomic switch. This tool deliberately has no switch command. After acknowledged native postings or external submissions, reverting a backup is not rollback: it would erase recognized actions. A reviewed reconciled delta or corrective plan is required.

## Validation handoff

No migration, database operation, backup, restore, server, deployment, or export was executed by the implementation owner. No tests or fixtures were added. Root may authorize an isolated synthetic exercise separately. Static checks establish only source/type validity.

Root integration is in place: `./operations` is exported from `packages/contracts/package.json`, and `apps/api/scripts/tsconfig.json` includes `operations/*.ts`. Root observed the dedicated operations TypeScript check pass. Owned-file lint and formatting also passed. Backup/restore behavior remains unexercised. No Worker route, cloud binding, dependency, migration, UI or shared database dispatcher change is needed for this operator-only local slice.

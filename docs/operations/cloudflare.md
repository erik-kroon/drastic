# Cloudflare delivery and verification

This page describes the current source implementation. [ADR 0009](../adr/0009-effect-mq-background-jobs.md) selects effect-mq on a persistent Bun worker for preparation, and [ADR 0010](../adr/0010-application-owned-accounting-replacement.md) selects the application-owned accounting boundary and clean baseline. The queue adapter exists in source; hosted Bun placement and the broader accounting replacement remain open.

The hosted composition is web Worker → API service binding → uncached Hyperdrive → PostgreSQL, with a separate persistent Bun process for queued preparation. The API also owns a private R2 bucket. Alchemy derives Worker and bucket names from the stack/stage/resource identity but does not provision the Bun process. A stage must still use its own PostgreSQL database, runtime login, browser origin, authentication secret and preparation credential. Resource naming cannot isolate a shared database.

This implementation has not been deployed or exercised against Cloudflare. Test changes and runs were skipped at the user's request. The configured default Alchemy Cloudflare profile reported `needs-reauth`; no account, stage, isolated PostgreSQL destination or archive jurisdiction was supplied. D-07 remains open. Static checks do not establish hosted, financial or retention behavior.

## Retained originals

The authenticated REST and MCP retention paths accept originals up to 5 MiB. CSV originals up to 64 KiB keep their existing inline PostgreSQL representation. Larger CSV and other supported documents use R2. The bound limits request memory; it is not a bulk-import or SIE-size commitment. CSV interpretation remains limited to 64 KiB/200 rows and the existing reviewed profile. Other originals can be retained and downloaded without inventing an interpretation.

PostgreSQL admits an upload intent before the external write. The Worker writes a book-scoped content key (`v1/<bookId>/<bare-sha256>`) conditionally, reads it back and checks size and SHA-256 before committing the occurrence/reference/receipt. Retrying an interrupted upload converges on the same content. Reads authorize before fetching bytes, verify their hash, then recheck authorization before returning them. Object keys and public URLs are not exposed by the public occurrence view. A document cannot be replaced by reusing an occurrence identity with different bytes, filename or media type.

An exact-key retry of a completed upload validates its supplied bytes and digest, then recovers the saved occurrence/receipt through current database authorization without touching object storage. A pending upload still needs a successful write and verified readback before completion. A recovered receipt records the historical completion; downloads still verify current object availability and bytes. This replay repair is implemented in source but has not been applied or exercised.

The bucket has no public access. Alchemy retains it when its resource is removed. Neither that policy nor a SHA-256 hash establishes statutory retention or protection from account administrators. No automatic deletion, lifecycle expiry, jurisdiction default or retention lock has been selected. Supply `OPENERP_ARCHIVE_JURISDICTION=eu` or `default` only after the environment's decision is made. Do not destroy the old bucket during a stage migration.

An uploaded object whose database completion fails can remain unreferenced. `openerp.source_uploads` retains its intent and deterministic content identity for reconciliation. No garbage collector deletes these objects. Review pending intents against `intake_contents` and occurrences before any cleanup; a recent pending intent may still be in flight.

Self-hosting uses the same adapter contract through `OPENERP_OBJECT_DIRECTORY`, an absolute private directory without symlinks. Writes publish complete, synced files atomically and never replace an existing original. Compose persists the directory in the `evidence-data` volume. This is one storage copy, not a backup.

## Background preparation

The API records a durable preparation admission. A separate Bun dispatcher rediscovers ready records and enqueues deterministic effect-mq jobs; its worker invokes the preparation step and rechecks current authority at each checkpoint. The former Cloudflare Workflow and Cron dispatcher are removed. The effect-mq listener uses a session-preserving PostgreSQL connection with polling recovery. The handler calls the shared Effect preparation operation. The committed preparation job is its durable dispatch intent; polling rediscovers it after an enqueue/ack interruption. See [ADR 0009](../adr/0009-effect-mq-background-jobs.md) and [ADR 0010](../adr/0010-application-owned-accounting-replacement.md).

`POST /api/v1/entities/:entityId/books/:bookId/preparation-runs/:id/background` accepts `{}` with `Idempotency-Key`. It records a job for an existing ready run. The corresponding GET returns the latest job or null. MCP exposes `runs_start_background` and `runs_get_background`. The preparation view offers the same command and reads progress from PostgreSQL.

Configure `OPENERP_PREPARATION_TOKEN` as a dedicated API credential whose actor has the `agent` role in each allowed book. Provision and rotate it through the existing authentication setup; never use an operator, database owner or user session token. The submission records the requesting actor and credential/session reference, plus the executor identity. It does not put tokens or source documents into a Workflow payload. Prepared proposals and run audit entries identify the executor; the job identifies the requester.

The Bun handler processes at most 50 checkpoints per queue attempt. Each current PostgreSQL step checks the executor and submitter authority, activation and dependencies, and records progress in one transaction. A repeated checkpoint cannot prepare the same chunk again. Any intervening manual run command stops the old job through its audit boundary, including cancel followed by resume. Blocked/stopped jobs require explicit operator attention and a new admission; infrastructure cannot resume them or post accounting entries.

The Bun dispatcher checks for ready jobs every 30 seconds, at most 100 per query, with enqueue concurrency five. Queue identity includes the durable job ID and its current checkpoint, so a partial batch can progress after rediscovery. Monitor pending age, failed queue attempts, stopped/blocked reasons and dispatcher warnings; a missing or revoked executor credential prevents progress.

Cloudflare Queues and Durable Objects are not part of this path. Self-host Compose exposes an opt-in preparation process after the dedicated agent credential is provisioned. Hosted placement and end-to-end recovery proof remain open.

## Coordinated recovery

The existing synthetic local recovery CLI now recognizes exactly the owned `intake_contents.object_key` format. It refuses other external-pointer schemas. Backup reads references in the same exported PostgreSQL snapshot as the dump, copies every referenced original, checks size/hash and includes `objects/v1/...` files in the manifest. Missing bytes prevent a complete manifest. Restore compares the restored database's references with that exact file inventory and recovers original bytes into the private restore output before issuing a receipt. The database stays quarantined and all application/job processes stay stopped.

For archive reads, set either `OPENERP_OBJECT_DIRECTORY`, or all of `OPENERP_R2_ENDPOINT`, `OPENERP_R2_BUCKET`, `OPENERP_R2_ACCESS_KEY_ID` and `OPENERP_R2_SECRET_ACCESS_KEY`. Use a bucket-scoped read credential and the endpoint appropriate to the bucket's jurisdiction. Credentials stay in the operator environment, outside bundles/logs. The recovery CLI still restricts PostgreSQL operation to explicitly named synthetic loopback databases; it is not a production PostgreSQL backup service.

Recovered objects can be mounted as the self-host object directory after separate application admission. Repopulating a new R2 bucket and verifying reads through a recovered hosted application are still operational gates; this CLI does not upload to R2 or promote a restored database. Custody of R2 credentials and the executor token must be documented alongside the existing configuration recovery procedures. See [local recovery](local-recovery.md) for quarantine and manifest requirements.

## Hosted verification still required

Once an account/stage/database is selected and Alchemy authentication is refreshed, use the [deployment instructions](../../infra/alchemy/README.md). Apply the reviewed migrations through the maintenance connection before deploying runtime code. Inspect the plan for distinct stage resource names and replacement of the former fixed API Worker. Never share production's PostgreSQL origin, archive or secrets with a verification stage.

The repeatable hosted journey must use the public web origin and a synthetic book:

1. Sign in through Better Auth and confirm authorized API reads traverse the web service binding. Check the expected book and uncached Hyperdrive configuration.
2. Prepare and approve one posting, deliberately lose the execution response, then recover its receipt after reload. Confirm one voucher, one sequence advance and immediate fresh ledger reads through the public web origin.
3. Retain a small CSV and a larger original, retry an interrupted upload, reload and download the exact bytes. Compare SHA-256 with the local originals; check denied cross-book and revoked-session access.
4. Admit a ready preparation job and leave the page. Confirm persisted progress after reload; interrupt/restart delivery and check no duplicate preparations. Cancel/resume manually and verify the old job stops. Exercise revoked submitter/executor authority and inactive rules.
5. Restore the snapshot and all referenced originals into a fenced destination. Confirm missing/corrupt objects prevent completion before any application or job is admitted.

Keep a private receipt recording revision, account/stage, public origin, resource names, synthetic book, command/receipt IDs, before/after sequence, document hashes and restore manifest digest. Exclude credentials and raw documents. None of these observations has been produced by this change.

References: [Cloudflare Workflow API](https://developers.cloudflare.com/workflows/build/workers-api/), [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/), [Bun S3](https://bun.sh/docs/runtime/s3). The comparison repository was [every-app/open-seo](https://github.com/every-app/open-seo/tree/0ffff93101043aad7600a3b6a499a0cd2887ef49); its stage naming and durable work patterns are useful references, while its SEO storage/workload decisions do not determine accounting authority here.

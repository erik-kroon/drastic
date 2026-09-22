# Restricted application recovery: root decision and operator procedure

Status: blocked at a shared admission boundary. The local CLI does not grant an inspection role, start a Worker, change Better Auth, enable ordinary database connections, or activate writers/providers.

## Observed source boundary

- `apps/api/src/db/connection.ts` owns scoped PostgreSQL acquisition and the Drizzle Effect adapter for application work.
- `apps/api/src/better-auth.ts` uses the official Better Auth Drizzle Promise adapter over that scoped connection. Auth needs `DATABASE_URL`/Hyperdrive, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`; cookies and origin are part of the configuration contract.
- `apps/api/src/auth.ts` calls `getSession` with refresh disabled, then passes the session token to the accounting boundary. This does not make every auth or accounting operation read-only.
- Applied0210 and0900 retain `FOR SHARE` admission locks for credentials, browser sessions and membership. Ordinary accounting getters reach this authority check. PostgreSQL read-only transactions reject the lock clause. Running the normal application as superuser or changing these global functions would evade the intended proof.
- The restored database has connection limit zero throughout and all connections disabled at completion. Reusing copied Better Auth sessions or API tokens as live admission is prohibited.

The CLI uses native PostgreSQL maintenance queries and `pg_dump`/`pg_restore` for an exported snapshot and fresh database lifecycle. These are not application APIs and do not bypass Drizzle for a claimed app probe. No application success is inferred from them.

## Exact root decision required before an app rehearsal

Root owns the DB connection, dispatcher, authentication and Worker composition. A reviewed inspection path must establish all of these together:

1. A distinct inspection identity scoped to the selected restored book and environment, not a restored live token or ordinary writer credential.
2. Database and application allowlists for evidence retrieval, durable receipt retrieval and historical report/line/contribution reads only. No command preparation, approvals, posting, auth mutation, outbox claim, filing/payment, migration or background job access.
3. A connection/admission mechanism compatible with read-only execution **without removing credential/member locks from existing live routes** and without granting the ordinary runtime role superuser/bypass privileges. Whether a separate immutable-snapshot read boundary is appropriate is a root security decision, not silently implemented here.
4. Provider/network egress fencing and explicit local origin/cookie handling. Normal Better Auth sign-in/session/rate-limit writes must remain blocked or demonstrably outside the restored authority; no production authentication secret or restored session is activated.
5. A way to run the actual Drizzle Effect/application handlers through the restricted boundary while retaining ordinary writer/provider quarantine. Do not simply lift `datallowconn`/connection-limit safeguards for a normal Worker.
6. A private evidence artifact that states the exact source release, migration/schema hash, restore receipt, identity/role, allowed reads, denied operations and configuration/key checks actually run.

Until that design is reviewed and integrated, stop after the CLI restore receipt. `blocked-restricted-read-admission` is the truthful result, not a failed database restore.

## Concrete rehearsal after separate root authority

1. Select an isolated synthetic source and fresh destination. Preserve the existing development/external clusters. Record operator authority, scope, source cutoff and the independently retained manifest digest. No real first-year expense/funding data is implied by synthetic inputs.
2. Run source release capture, inspect the private recovery plan, then backup and checksum inspection. Ensure release migrations match source receipts and that no external-provider token is retained. Record failed/missing closure checks rather than hiding them.
3. Provision reviewed matching role attributes/memberships on the isolated destination using separately held credentials. Run the fresh restore. Inspect all diagnostics, source/destination schema/table/control comparisons and the confirmed quarantine receipt. Stop on a missing success receipt or `not-confirmed` quarantine.
4. Recover declared configuration/key material under its custody procedure. Record custody identifiers and success/failure only, not the values. Encrypted-artifact readability, if required, must be separately observed; file permissions and key identifiers do not prove it.
5. Only after the root inspection boundary above exists, use its actual restricted caller to enumerate allowed books and retrieve each retained evidence item's complete original bytes. Hash returned bytes independently against the backup inventory; verify cross-book evidence is denied. No source document text is an instruction to the operator.
6. Retrieve every durable posting/correction receipt and pinned historical report. Page all report lines/contributions through the real handler until its explicit continuation ends. Compare exact IDs, digest/watermark and independent ledger control totals from the same source cutoff; do not create a replacement report and call it historical recovery.
7. Observe the inspection role refuse writes, approval/execute endpoints, auth/provider mutation and other books. Observe normal runtime/provider admission remain fenced. Do not perform a real write to demonstrate a denial unless the root separately authorizes that isolated negative exercise.
8. Record elapsed recovery duration, checks run/not run, missing configuration/keys, denied operations and exact response/digest evidence in a private application-recovery receipt. Keep any pending provider results unknown until separately reconciled with their actual authority. Do not derive zero liabilities, zero VAT or company completeness from balanced totals.
9. Leave the reconstructed destination quarantined. A later production promotion requires its own independent fence/epoch/acknowledgment procedure and explicit authorization; neither CLI nor application read success grants it.

No new test or fixture files are needed for this operator procedure. No step has been run by this worker. Static validity and source inspection do not verify recovery behavior.

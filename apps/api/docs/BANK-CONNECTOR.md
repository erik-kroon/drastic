# BANK-2 provider-neutral source delivery

A bank operator can attest a scoped provider consent and one explicit source-account → active ledger-account mapping. This does **not** verify a provider grant. The consent reports `providerConfigured: false`. The [opt-in Plaid job](PLAID-CONNECTOR.md) can pull records using privately provisioned credentials. Browser credential exchange and verified provider consent are not implemented. D-10 remains an external-provider acceptance gate. There is no silent synthetic provider.

An authorized operator can deliver a bounded page from an external connector through `POST /bank-connector-consents/:id/batches`. This is an actual ingest path for externally acquired raw records, not an authenticated provider callback. It accepts an opaque source revision and cursor pair, provider outcome `delivered | uncertain | failed`, and up to 20 records with stable external IDs and exact UTF-8 raw bytes (at most 64 KiB each; request at most 256 KiB). The operator must not claim this path proves provider origin. Provider credentials stay in the protected operator job configuration described by the selected adapter; this endpoint neither accepts them nor verifies provider access.

Delivered pages retain the exact bytes in the existing `intake_contents`/`intake_occurrences` split. Raw records use `application/octet-stream`, `connector:<providerId>`, account mapping, external ID and revision. The batch receipt lists `new`, `revision` or `overlap` for each input; same ID/revision with changed bytes conflicts. Distinct revisions remain distinct originals. A supplied source revision is an opaque identity, not proof of an ordered replacement. Existing file intake is unchanged. No CSV parsing, observation admission, journal posting, matching or reconciliation occurs. A later provider-specific interpretation must use the ordinary reviewed source-intake authority; neither ingestion nor cursor advance invents bank statement intervals or totals.

The book lock serializes commands; the consent cursor must match the submitted previous cursor. Only a delivered page advances it, atomically with retained occurrences, immutable batch and command receipt. Empty uncertain/failed pages retain separate outcomes without moving the cursor. This is a report from the operator's delivery boundary, not detection of network success. Retrying the same key and payload returns the frozen receipt; `GET /bank-connector-batch-requests/:key` recovers a committed result for that actor without resubmitting raw data. Absence is not evidence an in-flight attempt failed. A revoked consent blocks new batches and preserves old content and receipts. Mapping conflicts block intake. Cursor order and remote pagination completeness are provider-specific and remain unsupported.

## Integration handoff

Root owns and must wire:

1. Export `./bank-connector` from `packages/contracts/package.json`; add `BankConnectorApi` to `packages/contracts/src/api.ts`. Do **not** expose these operator mutations to ordinary MCP.
2. Spread `bankConnectorStatements` from `apps/api/src/db/statements/bank-connector.ts` into the operation map in `apps/api/src/db/query.ts`.
3. Add `BankConnectorHandlers` from `apps/api/src/transport/http/routes/bank-connector.ts` to `apps/api/src/index.ts` HTTP layer.
4. Apply forward migration `7300-bank-connector-intake.sql` after the existing source-intake/authorization migrations; do not edit applied migrations. No direct runtime table writes are granted.

All routes use `/api/v1/entities/:entityId/books/:bookId` (the contract path omits `/api`). `POST /bank-connector-consents`, `POST /bank-connector-consents/:id/revoke` and `POST /bank-connector-consents/:id/batches` require an operator and `Idempotency-Key`. Reads are `GET /bank-connector-consents/:id`, `GET /bank-connector-batches/:id`, and `GET /bank-connector-batch-requests/:key`. REST auth derives scope and actor server-side; never supply a client-specified actor. Drizzle binds token, scope, then key/ID/input as the typed statement files show.

## Verification boundary

Contract typecheck, targeted lint/format and standalone SQL application passed on an isolated PostgreSQL 18 cluster after the existing migrations through3950. Full migration replay stopped in an unrelated `6100-subledger-lifetime-amendments.sql` failure, so this is not a clean full-chain migration or SQL behavior proof. No running authenticated API call was exercised. Required later observation: isolated PostgreSQL migration/application, authenticated operator vs non-operator access, duplicate/revision/overlap and changed-byte conflict, concurrent stale cursor, uncertain-result recovery and revocation. D-09 prevents adding tests without explicit approval. D-10 prevents real-provider acceptance.

## Browser setup and recovery

The company setup banking choice links to `/banking-setup`. The page records existing
operator-attested consent and an explicit source-account/ledger-account mapping using
TanStack Form. It requires review confirmation, recovers saved mappings, displays
initial-delivery absence and delivered/uncertain/failed outcomes, and can stop new local
deliveries with a reason. Stopping local delivery does not revoke a provider-side grant.
Statement import and continuation without banking remain available throughout.

Migration 8390 adds scoped, bounded `GET /bank-connector-consents` and
`GET /bank-connector-consents/:id/batches` inventories. Both return `nextCursor` for
continuation. Migration 8720 orders deliveries newest first with a stable timestamp/ID
cursor and rejects cursors outside the selected consent. Private connector configuration
is not visible to these reads; `providerConfigured:false` is not evidence that an operator
job has no credentials. The UI does not present a recorded consent as a live connection.

Local browser/HTTP observations on 2026-09-24: missing review confirmation blocked saving;
a synthetic mapping saved and recovered; uncertain and failed deliveries left the cursor
unchanged; a delivered record advanced it, and a same-key retry returned the original
receipt. A stale cursor was rejected. Reload recovered all three outcome types. Browser
revocation stopped new deliveries while preserving their inventory. Foreign-book reads
returned Forbidden and unknown consent/cursor reads returned NotFound. Token-free
structured evidence is `/tmp/openerp-sie-inventory.VF9ZG4/banking-proof.json`. This is
local synthetic behavior proof, not real-provider or hosted-storage acceptance. No new
repository tests or fixtures were added.

# Phase 2. Supporting document per voucher

[Overview](overview.md)

## Goal

Every voucher in a period either cites a supporting document or carries an explicit reason why none exists. This is the most common missing fact in small-company books, and today nothing checks it. `evidenceRefs` may be empty and posting only verifies hashes (`domain/ledger.ts:110`, `posting.ts:531-534`).

## Changes

- A deterministic check over the period's vouchers. A voucher passes with at least one retained document reference, or with a typed no-document reason recorded by a person.
- The check plugs into the Phase 1 predicate as `vouchers_supported`.
- A command to record the no-document reason, human session only, with replay and saved command like other owners.

## Data structures

- `SupportGap`. `{ voucherId, postingDate, amountMinor, counterpartyId | null, reason: no_reference | reference_unreadable }`.
- `NoDocumentReason`. A closed set, for example `bank_fee`, `tax_account`, `internal_transfer`, `owner_explained`, with the actor and time.

## Failure cases

- A voucher whose only reference points at a missing or replaced document passes. It must fail.
- An agent credential records a no-document reason. It must be refused.
- A corrected voucher inherits the original's support without saying so.
- The check counts vouchers outside the period or after the cutoff.

## Verification

- Static. Changed checks and owners.
- Runtime. E2E with supported, unsupported, explained and replaced-reference vouchers. Artifacts under `test-results/agent-p2`.

Size S. Depends on Phase 1.

# Suggestion identity evidence

The unfixed HTTP workflows independently returned two IDs for sequential reads and three IDs for concurrent reads with identical book, actor, null session, subject digest and option digest. The first run's legacy workflow had a fixture `ReferenceError` and is not defect evidence. The corrected legacy-only run reproduced a new ID despite valid same-session historical candidates. A subsequent canonical-corruption probe returned HTTP 200 for a malformed referenced capture before the winner validation guard; that failure is separately retained.

The application now validates every proposed source variant before identity lookup. New migration `0112-suggestion-identities.sql` adds an append-only identity registry with nullable-session uniqueness, a deferred capture foreign key, and runtime SELECT/INSERT grants. A conflict-safe claim precedes capture insertion; only the winning claimant inserts a capture, and losing claimants read the winner in a fresh statement. Returned canonical captures are decoded and checked against actual record, owner, session, subject and computed digests. Database failures propagate.

Legacy adoption checks at most 64 candidates in an indexed exact-identity lookup, ordered by creation time and ID. Malformed or metadata-inconsistent candidates are ineligible. If no eligible candidate is found within that bound, a new validated canonical capture is retained. All original IDs and bodies remain unchanged; this does not qualify or backfill old history. Existing exposure classification is unchanged.

The main after run passed 7 selected workflows (9 unselected): sequential and concurrent null-session dedupe, distinct real browser-session identities, a real public draft revision, legacy preservation, malformed canonical refusal, rollback/immutability, existing source-variant bounds/export resilience and the ordinary extraction journey. The refined rollback-only run passed 1 workflow (15 unselected) at a later test/fixture inventory. It proves different actual native-derived options retain distinct IDs for the same subject, stable subset replay, and a fresh third empty-option reservation: inside the deliberate failure transaction counts increased from 2/2 to 3/3; after rollback they remained 2/2. Empty options do not imply human exposure. Registry updates and capture deletion remain forbidden.

HTTP exercises actual Worker/PostgreSQL paths. The native subset and rollback cases use the existing admitted application host fixture and real database transaction; no invented financial values or model release is introduced. Browser interaction and explicit cross-book/cross-actor metamorphic identity tests were not performed. Session cleanup is fixture housekeeping, not browser qualification.

Repeat from the repository root:

```sh
OPENERP_E2E_ARTIFACTS=test-results/suggestion-identity-before bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'suggestion identity'
OPENERP_E2E_ARTIFACTS=test-results/suggestion-identity-legacy-before bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'suggestion identity retains valid legacy'
OPENERP_E2E_ARTIFACTS=test-results/suggestion-identity-canonical-before bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'suggestion identity refuses a corrupted'
OPENERP_E2E_ARTIFACTS=test-results/suggestion-identity-after bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'suggestion identity|suggestion variants reject invalid captures|runtime-role extraction admits'
OPENERP_E2E_ARTIFACTS=test-results/suggestion-identity-rollback-final bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'suggestion identity reservations rollback'
```

The before commands reproduce failures only at their named pre-fix inventories. Retained directories preserve distinct source hashes, outcomes and synthetic observations. Documentation was added after the runs. Full harness reports and disposable-runtime logs remain under the corresponding `test-results/` paths.

Main integration moved the unpublished registry migration from0109 to0112 after owner OAuth/intake migrations0109–0111. The retained earlier runs used0109; their inventories remain unchanged. Clean integrated qualification is recorded separately.

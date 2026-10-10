# Phase 1. Point-in-time corpus

[Overview](overview.md)

## Goal

Drastic keeps its own versioned copy of public Swedish sources, so it can answer "what applied on this date". Today it stores no sources, has no fetcher, and has no search.

## Changes

- Tables for sources, snapshots and sections. Each snapshot keeps the publisher URL, retrieval time, content hash and effective interval, in the same shape as `RulePrimarySource`.
  - Legal validity time and observation time are stored separately. A source found in October may describe a rule that took effect in April. A published statute may not take effect until 2028.
  - The raw source is kept beside the normalised text, with the extraction version.
  - A rights ledger records each source's reuse basis. Riksdagen open data requires attribution. Upphovsrättslagen § 9 covers statutes and authority decisions, not every public page.
  - Amendments and transitional provisions are stored as relationships, not just as whole-document changes.
- A fetcher. Tests use fixtures only. Live fetching waits for the owner. It covers:
  - Riksdagen open data, for consolidated statute text with its amended-up-to marker;
  - Skatteverket's legal guidance by yearly edition, and its official positions;
  - BFN guidance;
  - Supreme Administrative Court rulings;
  - the EU VAT directive.
- Statute history from the first snapshot onwards. Riksdagen publishes only the current consolidation.
  - Rebuilding earlier versions from amendment SFS texts is a prototype with its own gold checks.
  - Until it passes them, earlier dates return `unknown`.
- A deterministic citation parser and reference graph ("8 kap. 3 § ML", SFS numbers). No LLM extraction.
- Search in PostgreSQL.
  - Exact citation lookup comes first, then the built-in `swedish` text search configuration.
  - Trigram or vector search is added only if the Phase 2 gold set shows a need.
- An authority rank per source kind, in this order:
  1. statute and directive;
  2. court rulings;
  3. Skatteverket regulations;
  4. general advice;
  5. official positions;
  6. guidance text;
  7. BFN.

## Data structures

- `Source`. `{ id, publisher, kind, authority }`.
- `Snapshot`. `{ sourceId, retrievedAt, sha256, effectiveFrom, effectiveTo, amendedThrough }`.
- `Section`. `{ snapshotId, citation, text, references: Citation[] }`.

## Failure cases

- A snapshot is overwritten instead of appended.
- A section is returned for a date outside its effective interval.
- A date before the first snapshot returns text instead of `unknown`.
- A citation that does not parse is dropped silently. It must be counted.
- A fetch failure leaves the corpus marked current.

## Verification

- Static. Changed checks, owners.
- Runtime.
  - E2E over fixture sources with a synthetic amendment on a boundary date.
  - Latency measured on a generated corpus matching the measured real size, with the report retained.
  - Artifacts under `test-results/rules-p1`.

Size L. Independent of plan 05.

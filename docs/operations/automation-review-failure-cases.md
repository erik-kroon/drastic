# Automation owner review failure cases

These cases precede the PR 19 follow-up implementation. Use isolated synthetic books and fixture models. Retain failing and passing E2E artifacts separately. Existing immutable history is not backfilled; no screen composition, baseline, live provider or statutory qualification is changed.

## Extraction capture bounds and export resilience

- A native extraction with 50 lines and all supported fields produces more than 400 merged choices. Preparation, citation, commit and export must succeed within the extraction contract's envelope: 64 header fields plus 50 lines with 16 fields each.
- The shared bound derives from the extraction contract constants; preparation, review and suggestion capture cannot use inconsistent limits.
- A record exceeding its source variant's bounds or otherwise failing its schema is refused before insertion, for extraction, bank and supplier sources.
- A retained undecodable capture is counted as `undecodable_capture`. Other valid decisions in that book still seal and export; one malformed row never aborts the seal.

## Bank citation freshness

- Discover rows A and B, match A, then cite B's original suggestion. Same actor, session, book and subject identity with an older revision returns `StaleDependency`.
- A foreign actor, session, book or subject identity remains `Forbidden`.
- Prepare and approve derive bank subjects through one helper; identical legs and revision produce identical subjects and digests.
- After `StaleDependency`, the existing refresh flow fetches candidates. Equal option-set digest permits resubmission with the new citation; a changed option set requires a fresh decision. Repeated staleness cannot cause an unbounded retry loop.

## Exposure equivalence

- An earlier same-actor, same-subject record with the same option-set digest as a cited record counts as cited, even at an older revision.
- A previously seen different option set still produces `unknown_exposure`.
- Option-set equality cannot make a foreign identity, actor or book citation valid.

## Extraction reads and suggestion identity

- A state GET succeeds while another transaction holds the inbox row lock; it must not request that row lock.
- A stale or unavailable review basis returns retained state and diagnostics with `suggestionRecordId: null`, rather than failing the whole read.
- Repeated and concurrent recording of the same book, actor, session, subject digest and option-set digest returns one existing suggestion ID.
- Changing any identity component creates a distinct record. Add a new migration; do not edit migrations 0106 or 0107.

## New approval consequence capture

- A new approval atomically retains period ID and bounds, sealed dimension requirements and source-line assignments, available AUT-04 VAT resolution, and mapping release checksum and statement line.
- Later period, dimension, profile or mapping changes cannot change an export's captured facts.
- Missing or ambiguous VAT category stays unknown; a numeric rate alone cannot establish it.
- Existing approvals remain unchanged and missing historical captures remain unknown. Corrections do not borrow the original VAT reasoning.
- Multiple source lines using the same account retain their own correspondence; an account-only join cannot assign another line's dimensions or VAT.

## Synthetic SE mapping release

- The versioned SE owner maps authored BAS income/expense ranges to declared K2 income-statement lines and retains its content checksum.
- Same-line accounts may compare equivalent when all other captured consequences agree; different lines do not.
- Gaps, overlapping ranges, unsupported accounts and changed release content cannot silently produce a known class.
- Declare the real approval/application consumer. The release proves a synthetic boundary and does not qualify a statutory K2 report.

## Partial supplier hints and reporting

- Any source line whose account or exact VAT rate differs from the cited item is `corrected`.
- Unchanged account and VAT rate remain `unknown_exposure` because the hint covers only those fields.
- Corrected and independent labels have separate counts. Corrected cases are not treated as a representative independent population.
- Without captured mapping and consequence inputs, consequence accuracy is unavailable with its explicit denominator, never a fabricated zero.

## Model state limits

- Pinned hosted Clef uses 64,000 input tokens and hosted Clef-flash uses 24,000; self-hosted limits are explicit configuration.
- UTF-8 bytes of state plus questions exceeding the pinned limit return local `state_limit` with zero provider calls. Multibyte Swedish text exercises byte accounting.
- A response reporting `usage.input_tokens` at or above the limit is refused, even if its distribution otherwise validates.
- Missing or invalid required self-hosted limits cannot enable a provider. A limit is part of retained release/configuration evidence.

## Firm memory v2 recall

- Sealed v1 records retain their original exact-description algorithm and remain readable unchanged.
- V2 removes digits, date tokens and Swedish/English month names, then compares the remaining token sets exactly. September and October variants can match; different remaining words cannot.
- Rank by the existing amount band and then recency. Empty normalized token sets cannot accidentally match unrelated descriptions.
- Report v1 and v2 coverage side by side on the same authored corpus and eligibility population, without claiming model or production quality.

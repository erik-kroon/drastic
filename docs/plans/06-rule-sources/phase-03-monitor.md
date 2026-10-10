# Phase 3. Change monitor and dossiers

[Overview](overview.md)

## Goal

When a source changes, Drastic proposes a release dossier with citations and names the books it affects. An operator reviews and installs it. Today `rule_change_notices` are entered by hand with free-text evidence (`migrations/0010-next-49.sql:18-75`).

## Changes

- A daily diff of snapshots per source. A material change creates a change record linked to the sections that changed.
- Proposed dossiers go in their own append-only table, never in `rule_releases`.
  - `rule_releases` rows are immutable.
  - `qualificationStatus` allows only `reviewed` or `withdrawn` (`contracts/company-profiles.ts:642`).
  - A dossier carries a draft `RuleRelease` body, its primary sources and effective dates, and empty example and counterexample slots for the reviewer.
- Installation stays an operator action, as DRA-73 requires.
  - The operator script recomputes the checksum from a canonical body. Today it is never recomputed (`application/company-profiles.ts:138-146`).
  - It refuses an install whose reviewer is the dossier's author.
- Change records link to `rule_change_notices` and `rule_impact_snapshots`, so affected books get one Att göra item each.

## Data structures

- `SourceChange`. `{ sourceId, fromSnapshot, toSnapshot, sections, materiality }`.
- `ReleaseDossier`. `{ id, change, draftBody, author, state: proposed | installed | dismissed }`.

## Failure cases

- A dossier is selectable for any treatment before installation.
- The author installs their own dossier.
- A checksum that differs from the canonical body is accepted.
- A change reaches books that never used the affected rule.

## Verification

- Static. Changed checks, owners.
- Runtime. E2E with a fixture source that changes a rate on a boundary date.
  - The monitor proposes one dossier.
  - The operator installs it.
  - Only books with matching treatments get an item.
  - Artifacts under `test-results/rules-p3`.

Size M. Depends on Phase 1.

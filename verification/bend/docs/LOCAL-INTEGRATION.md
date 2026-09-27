# Local integration

The user approved vendoring the kit and repairing its bundled tests and fixtures
on 2026-09-27. This is an offline verification surface, outside the application
workspaces. Existing accounting owners remain authoritative.

## Failure cases specified before the adapter changes

- Negative integral floor must return `-1` for `-100 / 100`, through the real
  purchasing owner used by VAT.
- With currency scale 2, filing scale 0 divides by 100; filing scale 2 preserves
  minor units. Missing, negative, fractional, excessive or finer-than-book
  scales must refuse rather than silently choose a unit.
- Reported box 49 must use reported primitive boxes, including signed credits,
  excluded contributions, zero totals and all supported rounding policies.
- Historical source-excerpt checks must stay labelled historical; they must not
  stand in for a comparison with the current owner.
- Current-owner verification must execute the actual shared rounding dependency
  and fail when an unreviewed runtime import appears. It must not edit the owner
  or substitute a copied rounding implementation.
- Checker controls must work when the checkout or temporary directory contains
  spaces, dots or numeric path segments. A positive control must load before
  the negative controls can establish rejection.
- Failed runs must not leave a previous passing report presented as fresh
  evidence. Reports must identify their actual input hashes and environment.
- Missing pinned upstream source or official Bend compiler must leave release
  verification failed, never silently use the development checker.

## Scope

The solver remains a deterministic, suggestion-only reference. Production
candidate mapping, smallest-set/date ranking, runtime placement and official
compiler verification are separate gates.

## Observed local behavior

The repaired suite passed 11,244 assertions, including the positive checker
control in a path containing spaces and a dot, followed by all negative and
mutation controls. The development checker accepted 20 law/proof pairs.
The current-owner lane passed 1,302 monetary comparisons across filing/currency
scales, rounding modes, signed and excluded contributions and reported net rows.

Run `npm --prefix verification/bend run verify:local` from the repository root.
Its `evidence/local-verification.json` manifest records the actual input hashes,
owner hashes, runtime and per-command results. These observations do not verify
the full VAT qualification pipeline or product reconciliation flows.

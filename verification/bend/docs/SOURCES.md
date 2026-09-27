# Source provenance

Inspected on 2026-09-27. Source pins prevent a moving default branch from silently changing the comparison.

## OpenERP

Repository: https://github.com/erik-kroon/openERP
Commit: `0eaad6402241ff3853fdc1af015e13f343873641`

Relevant sources:

- `AGENTS.md`: current application ownership, exact values and verification boundaries.
- `docs/domain.md`: ledger and allocation invariants.
- `docs/architecture.md`: Effect orchestration, PostgreSQL integrity and pure jurisdiction functions.
- `docs/specs/parity-plan-review/11-parity-backlog.REVISED.md`: PRY-33 bounded covering-set suggestions.
- `jurisdictions/se/src/vat/actual.ts`: exact rounding and monetary box projection. Full file Git blob `2006b670d926c2d11713375ab2de5bcdc6da9181`.
- `packages/contracts/src/vat-filing-release.ts`: supported rounding names and filing-unit scale bounds.

The retained VAT snapshot is an excerpt containing `round`, `taxed`, `reportedIn` and `boxRows` with necessary constants. Local type declarations and test-only exports surround the source functions. It is not the complete owner and must not be mistaken for a statutory calculation profile.

Full source:
https://github.com/erik-kroon/openERP/blob/0eaad6402241ff3853fdc1af015e13f343873641/jurisdictions/se/src/vat/actual.ts

The historical patch corrects a negative exact-floor bug at the inspected pin. The current owner already reuses the corrected shared rounding implementation. Local source hashes, rather than this historical pin, identify the owner exercised by `verify:owner`.

## Bend

Repository: https://github.com/bendlang/bend
Commit: `af569d4826913b2ce3557e9829ccad31fcf86f94`

Relevant sources:

- `guide/GUIDE.md`: Bend 2 syntax, laws, proof checking and backend limitations.
- `bend2/bend.ts`: parser, affine type checker, evaluator and hole tracking.
- `bend2/main.ts`: JavaScript interoperability notes.

Pinned source-checker Git blob: `c38e9e203530568b500dfc34785372d427706a6c`.

The normal download paths could not be resolved in the authoring container. To make development checks possible, the published checker was reconstructed with comments/formatting condensed and equivalent branches reformatted. Its code is included and its different status is surfaced in every report. No assertion is made that it is byte-identical, independently audited or equivalent in every detail.

`BEND_SOURCE_ROOT` requires the original file's exact Git blob hash. The strict model-verification gate refuses the development checker and additionally requires the official command and `--safe` execution.

## Licenses

First-party kit source and the OpenERP-derived excerpt are supplied under AGPL-3.0-only. The development checker retains Apache-2.0 attribution; see `NOTICE` and `tooling/LICENSE-APACHE-2.0`.

## Local source packaging

`upstream/ORIGINAL-MANIFEST.json` is the original ZIP manifest. It describes the
supplied files before local formatting or adapter repairs. The development
checker and historical VAT excerpt are stored as deterministic gzip source
archives, decompressed and SHA-256 checked before use. Their decompressed bytes
match the original manifest. Inspect them with `gzip -dc tooling/dev-checker.ts.gz`
and `gzip -dc upstream/vat-monetary-slice.ts.gz` from the kit directory.

Local changes repair temporary import portability, follow the real shared VAT
rounding dependency, require both monetary scales, and retain repeatable local
evidence. They do not modify the Bend kernels or the checker implementation.
`evidence/local-verification.json` records current source hashes separately from
the supplied archive's historical evidence. The original gate smoke result is
retained under `upstream/original-gate-smoke.json` and is not a local result.

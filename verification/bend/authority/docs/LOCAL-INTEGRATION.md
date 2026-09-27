# Local integration contract

This child began as an offline authority candidate. The user's follow-up request
authorizes the narrow VAT seam and real-host qualification described in
[QUALIFICATION.md](QUALIFICATION.md). Deployment trust remains separately reviewed.

## Failure cases retained before integration changes

The supplied suites exercise malformed/excessive input, noncanonical money,
mutated proofs, bad output postconditions, stale calculation bindings, revoked
releases, runtime mismatches, unapproved artifacts, source drift, incomplete
cover searches, path portability and process deadlines. Preserve those cases.

The integration must also preserve these boundaries:

- The child checks its own extended Bend book through the parent's hash-verified
  loader. The loader, checker archive and historical-excerpt dependencies must
  appear in the child's source identity.
- Parent verification must not absorb the child's source or evidence tree.
- Historical VAT helpers remain historical; they cannot satisfy current-owner
  or real-host qualification.
- Public declaration checking is required in this installed checkout. A missing
  compiler must fail rather than produce a green local verification report.
- Missing official source, safe-kernel tools, current-owner adapter or real-host
  integration must keep their respective release gates failed.

## Current-owner prerequisite

`jurisdictions/se/src/vat/actual.ts` exports the public `actualVatMonetary` port.
The current-owner adapter imports it directly, while the real preparation
workflow selects a calculator between capture and seal. The host receipt records
observed application/database behavior; deployment trust remains separate.

## Observations

- The supplied files passed the no-overwrite installer's manifest validation.
- Shared Bend model implementations match the parent. Existing `Kernel.bend`
  and `PROOF.bend` differ only by imports of new modules/refinement proofs.
- The development suite passed 13,466 assertions and 35 law/proof pairs.
- All six upstream file pins matched. The official checker accepted the source,
  two builds produced identical JS bytes, and all 13,466 assertions passed using
  that generated artifact. Compiler/runtime identities are retained in
  `evidence/current/release-verification.json`.
- Earlier missing-tool/adapter failures are historical. The pinned Lean archive
  has been hash-checked, the independent safe kernel passes, and the direct
  current-owner and real-host lanes are bound.

Reproduce compiler stages with `BEND_SOURCE_ROOT=/path/to/pinned/bend npm --prefix
verification/bend/authority run verify:compiler`. The command retains completed
stages on failure; it is not a replacement for owner/host qualification.

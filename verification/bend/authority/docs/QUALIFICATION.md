# Reproduce VAT monetary qualification

The user's 2026-09-27 request authorized the public VAT monetary seam,
current-owner adapter and real host qualification. Deployment approval remains
an explicit review of an exact candidate, operation set and runtime.

## Toolchain

Use the pinned Bend source from `scripts/bootstrap-upstream.mjs`. The independent
checker is built afresh from that checkout's pinned `bendtt.lean` using Lean
4.34.0. The observed macOS arm64 toolchain came from the official
`leanprover/lean4` GitHub release `v4.34.0`:

- Asset: `lean-4.34.0-darwin_aarch64.tar.zst`
- SHA-256: `69f263fa6e21bbc2466bbfb1affcd92479ee2714c883a07de548e099a5922932`

The downloaded archive was hash-checked before extraction. Other platforms need
their corresponding official asset and published checksum. Point `LEAN_BIN` and
`LEANC_BIN` to the extracted `bin/lean` and `bin/leanc`; no global installation
or repository dependency change is required.

From the repository root, after its normal frozen dependency install:

```sh
export BEND_SOURCE_ROOT=/absolute/path/to/pinned-bend
export LEAN_BIN=/absolute/path/to/lean-4.34.0/bin/lean
export LEANC_BIN=/absolute/path/to/lean-4.34.0/bin/leanc
export OPENERP_REPO="$PWD"
export OPENERP_OWNER_ADAPTER="$PWD/verification/bend/current-owner-authority.mjs"
npm --prefix verification/bend/authority run verify:release
npm --prefix verification/bend/authority run stage:release -- \
  vat-monetary-2026-09-27 money.round.v1 vat.project.v1
```

The host stage uses the existing disposable PostgreSQL 17/workerd fixture. Set
`PG_BINDIR` if PostgreSQL binaries are not on PATH. The Bun host process uses the
restricted runtime role and the production Effect workflow; maintenance access
only seeds synthetic inputs and injects the specified concurrent source change.

## Application seam and observations

`jurisdictions/se/src/vat/actual.ts` exports `actualVatMonetary` and accepts a
`VatMonetary` dependency. TypeScript continues to own fact qualification,
coverage, reconciliation and readiness. `prepareActualReturn` selects an internal
calculator outside the capture/sealing transactions. A failing candidate returns
`Unavailable`; it cannot choose the TypeScript result as a fallback.

The current-owner adapter imports that public owner directly. Its 587 comparisons
exercise shared rounding and monetary projection without extracting function
bodies. The host test checks:

- candidate rounding/projection reached through the actual VAT workflow;
- exact saved rows and retained kernel release/artifact identity;
- database immutability and command replay without recalculation;
- a changed family epoch refusing sealing with no return or command receipt;
- a thrown candidate error refusing rather than falling back;
- the existing HTTP approval/execution owner preserving a synthetic journal's
  approved amount derived from a saved report.

The host report distinguishes the Node compiler/probe runtime from the Bun
application runtime and workerd HTTP posting runtime. It hashes the host recipe,
product source inventory and migration manifest. These are observations on real
application code with synthetic inputs, not a tax filing or a claim that the
actual-company VAT control-reclassification product is implemented.

## Evidence and deployment

`evidence/current/release-verification.json` indexes the retained receipts for
source checking, independent safe checking, reproducible builds, compiled
differentials, runtime probes, current-owner parity and real-host integration.
`release-candidate.json` records the staged two-operation candidate. The generated
module remains in ignored `dist/` and can be reproduced from the recorded pins.

The existing application default remains TypeScript. Deployment trust is not a
test result and is not populated by qualification or staging. Review the staged
manifest digest and intended runtime before approving it through deployment
configuration.

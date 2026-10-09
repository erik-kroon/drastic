# Drastic Bend authority upgrade

An **additive, isolated successor** to the kit already integrated under `verification/bend/`.
Integrated as **`verification/bend/authority/`**, alongside the parent's offline verification lane.

This package implements versioned calculation interfaces, stronger arithmetic specifications, independent result checks, current-owner comparison hooks and a fail-closed promotion path. **No build in this archive is approved for authoritative accounting use.**

## Keep your integrated work

The parent integration owns its separate tests, evidence, corrected VAT scaling and current-owner monetary comparison. This child reuses its hash-verified checker loader and archived historical excerpt. Those dependencies are included in the child's source identity. The parent source manifest excludes the child, so each lane remains independently reproducible.

The installer creates only the new `authority/` child. It never edits the parent README, scripts, compiler/excerpt archives, rounding code, package lock or `evidence/local-verification.json`. It refuses an existing destination. It does not commit, reset, deploy or write accounting data.

The child contains a candidate snapshot of the Bend models plus new proofs and interfaces. `npm run compare:parent -- ..` reports differences. The shared model implementations match the parent byte-for-byte; the differing existing files only add imports for FX, schedules and refinement proofs. That comparison deliberately returns a nonzero exit status for differences requiring review.

## Run

Node 22.16 or later. No npm dependency installation is needed.

```sh
# From the Drastic root after installing the child:
npm --prefix verification/bend/authority run verify:local

# Your original command remains unchanged:
npm --prefix verification/bend run verify:local
```

The child writes fresh results under `verification/bend/authority/evidence/current/`.
The installed suite passed **13,466 assertions with both the development evaluator and the official generated JS artifact**. The pinned upstream source checker accepted the **35 law/proof pairs**. The count includes reused arithmetic cases; it is not an additional independent set beyond the parent suite.

See `evidence/current/local-verification.json` for run output, backend identity, source hashes and mandatory declaration checks. `evidence/current/release-verification.json` indexes the full qualification receipts. Repository fast and full changed-file gates passed. See [qualification and reproduction](docs/QUALIFICATION.md).

## Implemented operations

| Operation | Result owner after explicit future promotion | Scope |
| --- | --- | --- |
| `money.round.v1` | Signed exact rational rounding | Six explicit policies, up to 160-digit intermediate inputs, bounded 38-digit output and a retained residual |
| `vat.project.v1` | Monetary projection | Qualified contributions, primitive box totals, explicit reporting-unit divisor, residuals and net from reported primitive boxes |
| `schedule.equal.v1` | Equal allocation | Supplied remaining basis and ordered period IDs; magnitude remainder goes to the final period |
| `settlement.allocate.v1` | Capacity arithmetic | Same-currency positive amount and two nonnegative remaining capacities |
| `fx.convert.v1` | FX conversion | Explicit major-unit rate direction and both currency scales; no implicit rate selection or gain/loss classification |
| `ledger.reverse.v1` | Reversal transformation | Original line references, accounts and dimensions retained while debit and credit sides swap |

PRY-33 stays on the separate research/suggestion path. It cannot be placed in an authority release and never produces permission to execute.

### Explicit VAT units

The new VAT contract uses **`reportingUnitMinor`**, not an overloaded `filingUnitScale`.
For a book using hundredths and a report in whole currency units, the divisor is `"100"`.
If the current owner defines both scales as decimal-place counts, `reportingUnitFromScales(2, 0)` returns `"100"`. No interpretation of the current owner's fields is inferred from their names.

The historical `lib/vat.mjs` compatibility helper remains solely for the old regression suite. Authoritative operations use `calculateVatWithUnit` with the explicitly supplied divisor. Do not copy the old helper over your corrected parent adapter.

## What changes at promotion

`src/node-authority.mjs` loads the exact artifact bytes whose hash appears in a reviewed manifest. It checks receipts and a separate deployment trust file before making a synchronous calculator available. The runtime cannot relabel itself as another tested runtime.

`prepare()` freezes exact inputs and outputs into a versioned calculation record. It binds the record to a kernel release, artifact digest, rule digest, profile and captured dependencies. `assertExecutionBinding()` checks the retained record against the approved calculation digest and the current context. It does not recalculate with a newer kernel.

**These functions do not authorize anything.** Effect still owns evidence qualification, application policy and the shared transaction. PostgreSQL still owns the committed record, constraints, locks and receipts. All calculation records retain `mayExecute: false`.

There is no fallback to TypeScript after a promoted Bend calculation fails. Shadow mode is separate and leaves the existing TypeScript result authoritative.

## Verification layers

1. **Local development:** the included adapted checker evaluates actual Bend source. It is not byte-identical to upstream.
2. **Pinned upstream source:** the official checker and JS generator must match six recorded upstream blob hashes. The build runs in a fresh process twice and must emit identical bytes.
3. **Official safe kernel:** the pinned translator must emit nonempty coverage with no excluded definitions. Its output is checked using a freshly built Lean 4.34.0 kernel or an independently hash-pinned kernel binary.
4. **Executable artifact:** the arithmetic and boundary suites run against the generated JS, not the evaluator.
5. **Current owner and actual host:** a reviewed adapter compares the actual worktree's monetary owners and exercises the real application integration.
6. **Explicit promotion:** a reviewer places the exact candidate manifest digest and operation set in deployment trust. This package never does that automatically.

Qualification verifies the upstream file pins, official source checking, two byte-identical JS builds, compiled execution, the independent Lean 4.34.0 safe kernel, current-owner parity and real-host behavior. The public VAT seam and reviewed adapter are installed. Deployment trust remains a separate explicit approval of the staged candidate; qualification does not select a production backend.

## Official build and release checks

Fetch the pinned source on a machine with network access. This command creates a new checkout and never resets an existing one:

```sh
node verification/bend/authority/scripts/bootstrap-upstream.mjs /absolute/path/to/bend-pinned
```

The compiler-only lane is available before that application seam exists:

```sh
BEND_SOURCE_ROOT=/absolute/path/to/bend-pinned \
npm --prefix verification/bend/authority run verify:compiler
```

It runs two builds, the generated-artifact suites and independent safe checking.
It records completed stages even on failure and cannot promote a release.
For the complete release gate, configure the current-owner and host adapter:

```sh
export BEND_SOURCE_ROOT=/absolute/path/to/bend-pinned
export OPENERP_REPO=/absolute/path/to/openERP
export OPENERP_OWNER_ADAPTER=/absolute/path/to/openERP/verification/bend/current-owner-authority.mjs
# Provide Lean 4.34.0 and leanc on PATH, or LEAN_BIN and LEANC_BIN.
# Alternatively provide BENDTT and an independently obtained BENDTT_SHA256.
npm --prefix verification/bend/authority run verify:release
```

The release gate records failure even when a prerequisite is missing. It removes stale candidate output inside this child before a fresh run. It does not alter the parent's failed/successful gate records.

A successful gate still does not promote a release:

```sh
npm --prefix verification/bend/authority run stage:release -- \
  vat-monetary-candidate-1 money.round.v1 vat.project.v1
```

That produces `dist/release-candidate.json`. Review the exact specifications, generated artifact, receipts and application mapping before changing out-of-band deployment trust. The supplied trust file contains **zero approved releases**.

## Start with these files

- `docs/INTEGRATION.md`: actual cutover boundary and transaction ownership.
- `docs/CURRENT-OWNER.md`: bind the already-fixed current rounding and VAT owners.
- `docs/PROOF-COVERAGE.md`: what the 35 proofs do and do not establish.
- `docs/AGENT-HANDOFF.md`: integration instructions that preserve your uncommitted work.
- `src/index.d.mts`: public operation contracts.
- `evidence/current/`: actual local results and the blocked release gate.

The compiler/probe target is Node. The host lane exercises the actual Bun VAT workflow and PostgreSQL plus workerd approval/execution; it does not qualify a workerd Bend loader, native C or GPU execution. No deployed release is approved. See `docs/LIMITATIONS.md`. Original distribution and earlier failed qualification records remain under `archives/` and `evidence/historical/`.

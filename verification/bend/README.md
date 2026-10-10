# Drastic Bend verification kit

Offline models for exact arithmetic, ledger/allocation invariants, Swedish VAT
monetary projection and bounded covering-set search. This directory is outside
the product workspaces and has no production caller.

## In CI

The `Exact money model (official Bend)` job in `.github/workflows/ci.yml` runs
on every pull request and push to `main`. It installs Lean 4.34.0 (checksum
pinned), fetches the pinned Bend source and runs the authority release lane
(`verify:release`):

1. Builds the model twice with the official Bend compiler and requires
   byte-identical artifacts.
2. Checks the model with the independent Lean safe kernel.
3. Runs the laws and arithmetic with both the development evaluator and the
   compiled artifact.
4. Compares the current owners with the compiled artifact through
   [`current-owner-authority.mjs`](current-owner-authority.mjs). The model must
   agree exactly with the code the application runs:

   | Operation | Current owner |
   | --- | --- |
   | `money.round.v1`, `vat.project.v1` | `jurisdictions/se/src/vat/actual.ts` and the shared `roundRational` in `packages/domain/src/purchasing.ts`. Every rounding owner must also agree: `roundHalfUp` (`packages/domain/src/money.ts`, used by FX, mileage and Peppol tax checks), corporate tax `roundRational` and payroll `roundExact`. |
   | `fx.convert.v1` (nonnegative half up) | `convertMinor` in `packages/domain/src/exchange-rates.ts`, used by rate reviews and commerce FX recognition |
   | `schedule.equal.v1` (remainder last) | `allocateByWeights` in `packages/domain/src/prepayments.ts`, used by equal-month prepayments |

5. Exercises the real VAT workflow on PostgreSQL with the compiled artifact.

The job then runs this kit's historical VAT regressions (`test`).

The job uploads fresh evidence as the `bend-evidence` artifact. Committed
evidence files are dated snapshots; the CI artifact is the current result.
Inputs outside an owner's defined scope (negative FX amounts, other rounding
modes, nonpositive schedules) are not generated, and the adapter refuses them
rather than reporting agreement.

## Run

Use Node 22.16 or later. The standalone model checks need no npm installation:

```sh
npm --prefix verification/bend test
npm --prefix verification/bend run check:proofs
npm --prefix verification/bend run demo
npm --prefix verification/bend run solve -- fixtures/cover-ambiguous.json
```

From an Drastic checkout with its normal dependencies installed, run the complete
local lane (including the current owner):

```sh
npm --prefix verification/bend run verify:local
```

`verify:local` selects the containing checkout, or `OPENERP_REPO` when set. It runs
the commands sequentially, records exit statuses and console output, hashes the
kit inputs and actual VAT/domain sources, and writes
[`evidence/local-verification.json`](evidence/local-verification.json).
Read that manifest together with its linked reports. Each run replaces the local
evidence; a failed run cannot report a previous success as current.

For only the current-owner monetary comparison:

```sh
OPENERP_REPO="$PWD" npm --prefix verification/bend run verify:owner
```

## Verification boundary

The default evaluator is the archive's **development adaptation** of the Bend
source checker. It loads and evaluates the actual `.bend` files. Its accepted
proof terms are not an official compiler or independent safe-kernel result.

`tooling/dev-checker.ts.gz` preserves that adaptation byte-for-byte. The loader
verifies the decompressed SHA-256, materializes it with `base.bend` in a temporary
directory, and removes that directory after loading/checking the Bend book.
The historical VAT excerpt is likewise a pinned compressed source asset. See
[source provenance](docs/SOURCES.md) and [NOTICE](NOTICE).

Official verification lives in the [authority](authority/README.md) release
lane, which CI runs (see [In CI](#in-ci)): the official Bend compiler from the
pinned source, the independent Lean safe kernel, compiled-artifact comparisons
and the real VAT host. Native/GPU execution and statutory applicability remain
separate claims.

## Models

| Area | Implementation and limit |
| --- | --- |
| Ledger and allocation | Certified voucher balance/line shape and source/target conservation/restoration; no posting authority or concurrency model. |
| VAT | Qualified contributions to boxes 05, 10, 11, 12 and 48; exact/reported/residual values; box 49 derived from reported primitive boxes. No eligibility or control-reconciliation replacement. |
| Arithmetic | Binary naturals, signed integers, checked subtraction, multiplication, divmod, GCD, rationals, rounding and decimals. Canonical host monetary inputs allow up to 38 digits. |
| Covering sets | Whole remaining capacities, global node budget, cardinality limits, ambiguity witnesses and incomplete/unavailable outcomes. No production ranking or candidate discovery. |

`calculateVat` requires both `currencyScale` and `filingUnitScale`; the divisor is
`10^(currencyScale - filingUnitScale)`. Finer-than-book filing precision refuses.
The current-owner gate follows `actual.ts` into the real shared
`purchasing.roundRational` implementation, using temporary Node resolution hooks
and test-only exports in memory. Application source is not edited.

The original floor patch under `patches/` is historical: Drastic commit
`b0e2fcbe473c1620a1da8848a0d9ceb2763e086a` already repaired that bug. Historical
excerpt checks retain the old failure; they are labelled separately from current
owner comparisons.

Every covering-set result has `mayExecute: false` and `requiresRevalidation: true`.
Its fingerprint is a diagnostic identity, not an approval digest. Future callers
must use the existing eligibility, preparation, approval and allocation owners.

See [integration](docs/INTEGRATION.md), [proof coverage](docs/PROOF-COVERAGE.md),
[arithmetic](docs/ARITHMETIC.md) and [local integration](docs/LOCAL-INTEGRATION.md).
The original archive manifest is retained as
[`upstream/ORIGINAL-MANIFEST.json`](upstream/ORIGINAL-MANIFEST.json); its checksums
describe the supplied archive, not the locally adapted files.

## Authority candidate

The additive [authority candidate](authority/README.md) has its own model snapshot,
versioned interfaces, stronger arithmetic proofs and staged compiler/release
checks. It reuses this kit's checked source loader. Run its independent lane with
`npm --prefix verification/bend/authority run verify:local`.

Its pinned-source JS build, safe kernel, compiled suites, direct current-owner
adapter and real-host qualification are exercised in the authority release lane. This parent's evidence
manifest excludes the child. Neither lane grants posting or deployment authority.

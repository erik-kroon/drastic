# Drastic Bend money model

An exact model of Drastic's money arithmetic, written in Bend, built with the
official Bend compiler and checked by an independent Lean safe kernel. CI
compares it with the code the application actually runs. Nothing in the
application calls it: it is a reference that the real owners must agree with.

## In CI

The `Exact money model (official Bend)` job in `.github/workflows/ci.yml` runs
on every pull request and push to `main`. It installs Lean 4.34.0 (checksum
pinned), fetches the pinned Bend source and runs `verify:release`:

1. Builds the model twice with the official Bend compiler and requires
   byte-identical artifacts.
2. Checks the model with the independent Lean safe kernel (35 law/proof pairs).
3. Runs the laws and arithmetic with both the development evaluator and the
   compiled artifact, which must agree.
4. Compares the current owners with the compiled artifact through
   [`current-owner-authority.mjs`](current-owner-authority.mjs) (1437
   comparisons). Any difference fails the job.
5. Exercises the real VAT workflow on PostgreSQL with the compiled artifact.

It uploads `evidence/current/` as the `bend-evidence` artifact. Committed
evidence files are dated snapshots; the CI artifact is the current result.

## What the real code is compared with

| Comparison | Current owner |
| --- | --- |
| `money.round.v1` | `roundRational` in `packages/domain/src/purchasing.ts`. Every other rounding owner must give the same result: `roundHalfUp` in `packages/domain/src/money.ts` (FX, mileage, Peppol, invoice and credit-note line tax, disposals, VAT credit checks), corporate tax `roundRational` and payroll `roundExact` |
| `vat.project.v1` | `actualVatMonetary` in `jurisdictions/se/src/vat/actual.ts` |
| `fx.convert.v1` (nonnegative half up) | `convertMinor` in `packages/domain/src/exchange-rates.ts`, used by rate reviews and commerce FX recognition |
| `schedule.equal.v1` (remainder last) | `allocateByWeights` in `packages/domain/src/prepayments.ts`, used by equal-month prepayments |
| `ledger.reverse.v1` | `reversedLines` in `packages/domain/src/posting.ts`, used by every voucher reversal |
| Voucher admission | `validatePostingLines` in `packages/domain/src/posting.ts` must accept exactly the vouchers the model's `Ledger.validate` accepts |
| Bank covers | `findExactCovers` in `packages/domain/src/bank-cover-search.ts` against the model's `Cover.solve` on small complete pools: neither may miss or invent a cover, and a unique model cover must be the owner's cover |

Inputs outside an owner's defined scope (negative FX amounts, other rounding
modes, nonpositive schedules, more than 500 voucher lines) are not generated,
and the adapter refuses them rather than reporting agreement. The day-gap
ranking of bank covers is application policy and is not modelled.
`settlement.allocate.v1` has no compared owner: settlement capacity is checked
inside the allocation transactions.

## Run locally

Node 22.16 or later. The development lane needs no toolchain:

```sh
npm --prefix verification/bend run verify:local
OPENERP_REPO="$PWD" OPENERP_OWNER_ADAPTER=verification/bend/current-owner-authority.mjs \
  npm --prefix verification/bend run verify:owner
```

The official lane needs the pinned Bend source, Lean 4.34.0 and PostgreSQL 17,
exactly as CI installs them. See [qualification](docs/QUALIFICATION.md):

```sh
node --experimental-strip-types verification/bend/scripts/bootstrap-upstream.mjs ~/.cache/drastic-bend/bend
export BEND_SOURCE_ROOT=~/.cache/drastic-bend/bend
export LEAN_BIN=/path/to/lean-4.34.0/bin/lean LEANC_BIN=/path/to/lean-4.34.0/bin/leanc
export OPENERP_REPO="$PWD" OPENERP_OWNER_ADAPTER="$PWD/verification/bend/current-owner-authority.mjs"
npm --prefix verification/bend run verify:release
```

## Operations

| Operation | Scope |
| --- | --- |
| `money.round.v1` | Signed exact rational rounding: six explicit policies, up to 160-digit intermediates, bounded 38-digit output and a retained residual |
| `vat.project.v1` | Qualified contributions, primitive box totals, an explicit reporting-unit divisor (`reportingUnitMinor`), residuals and net from reported primitive boxes |
| `schedule.equal.v1` | Supplied remaining basis and ordered period IDs; the remainder goes to the final period |
| `settlement.allocate.v1` | Same-currency positive amount and two nonnegative remaining capacities |
| `fx.convert.v1` | Explicit major-unit rate and both currency scales; no implicit rate selection or gain/loss classification |
| `ledger.reverse.v1` | Original line references, accounts and dimensions retained while debit and credit swap |

Bank cover search (PRY-33) stays on the research path: it never produces
permission to execute, and every result has `mayExecute: false` and
`requiresRevalidation: true`.

## Boundary

The development evaluator (`lib/checker.mjs` with `tooling/dev-checker.ts.gz`)
is a reconstructed Bend checker for fast offline runs, not an official result.
The official build path never accepts it.

The application default remains TypeScript. `src/node-authority.mjs` could load
a promoted artifact, but only for a candidate placed in deployment trust by an
explicit review, and the supplied trust file holds zero approved releases.
Effect still owns policy and transactions, and PostgreSQL still owns committed
records, constraints, locks and receipts. Native or GPU execution and
statutory applicability are separate claims. See
[limitations](docs/LIMITATIONS.md), [proof coverage](docs/PROOF-COVERAGE.md),
[arithmetic](docs/ARITHMETIC.md), [current owner](docs/CURRENT-OWNER.md) and
[sources](docs/SOURCES.md).

The historical VAT excerpt in `upstream/` keeps a fixed floor bug on purpose
for the old regression suite; current-owner comparisons never use it.

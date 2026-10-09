# Integration and promotion

## 1. Add a child, not a replacement

Install at `verification/bend/authority/`. Keep the integrated parent implementation and its verification command intact. Run both suites. The supplied installer never edits a tracked parent file and never touches a lockfile.

The child model snapshot deliberately isolates this upgrade from unavailable uncommitted edits. Run `npm --prefix verification/bend/authority run compare:parent -- /path/to/openERP/verification/bend`. Identical models need no merge. For a changed model, carry over the actual integrated fix, review its semantics and rerun all proofs and comparisons. Do not overwrite a parent fix with an archived version.

No migration or existing-file patch is automatically applied. The old negative-floor patch is historical and is not an instruction to edit the current shared rounding owner.

## 2. Compare through the real current owner

The original `actual.ts` source excerpt is retained only as a historical regression oracle. It cannot satisfy the new owner-parity gate. The new adapter must import the actual shared rounding owner and the current VAT projection path. Hash their current worktree bytes, including uncommitted changes, not just the Git HEAD version.

The explicit `reportingUnitMinor` eliminates assumptions about whether a scale field means decimal places, an exponent or a minor-unit divisor. The adapter owns that reviewed translation and must exercise it against real current-owner results.

## 3. Select one authority operation

Start with `money.round.v1` plus `vat.project.v1` if the current VAT owner consumes both. The arithmetic supports other calculation families, but the existence of source does not authorize their deployment.

A release names the exact source digest, artifact digest, compiler pin, supported operations and semantics IDs. Every promoted operation must have matching executable and host evidence. The actual runtime ID must match the recorded runtime probe. A Node probe cannot qualify Bun or workerd.

`src/semantics.mjs` is deliberately small and explicit. Remainder-last equal distribution is not a largest-remainder allocation method. FX conversion is not FX accounting treatment. Reversal transformation is not a correction policy. Review each choice before selecting it.

## 4. Inject only the monetary dependency

After qualifying a release, construct `createVatMonetaryPort(await loadAuthority(...))` at an owning application runtime boundary. Do not load the checker during a request. Do not import `src/research.mjs` into the financial path.

The port exposes synchronous `round(numerator, denominator, mode)` and `project(input)` functions. The first returns bigint or null for a nonpositive denominator, matching the inspected compatibility contract. Reconcile this contract with the actual current owner before wiring it. `project` consumes already-qualified contributions and an explicit divisor.

Leave qualification, coverage, controls, source exclusions and filing readiness in their current owners. Do not replace all of `calculateActualVat` with the monetary projection, because those functions do not have the same responsibility.

The public `.d.mts` declarations give TypeScript the exact operation inputs and outputs. Example after release qualification:

```ts
import { loadAuthority, createVatMonetaryPort } from './verification/bend/authority/src/index.mjs';

const kernel = await loadAuthority({
  manifestPath: '/deployment/bend/release-candidate.json',
  artifactPath: '/deployment/bend/kernel.mjs',
  trustPath: '/deployment-config/bend-trust.json'
});
const monetary = createVatMonetaryPort(kernel);

const rows = monetary.project({
  currency: 'SEK',
  scale: 2,
  reportingUnitMinor: '100',
  rounding: 'toward_zero',
  declareNet: true,
  contributions: [
    { id: 'captured-sale-component', box: '10', signedMinor: '199', included: true },
    { id: 'captured-input-component', box: '48', signedMinor: '101', included: true }
  ]
});
```

Deployment paths and fixture rows above are illustrative. The real application supplies captured, qualified data. Never select a rounding mode from this example instead of the reviewed rule release.

## 5. Bind calculation, approval and execution

When retaining an authoritative calculation, use `kernel.prepare({ operation, context, input })`. The resulting immutable envelope carries exact input/output data, rule/profile/dependency references and build identity. Its internal digest is not Drastic's canonicalization format and is not an approval token.

Attach the envelope to the application's normal immutable proposal/report record. Include its exact bytes or digest in the EXISTING canonical sealing and approval mechanism. Do not change an existing canonicalization version, idempotency namespace or stored-record meaning merely to accommodate the child.

Inside the existing short transaction, after acquiring the normal locks, call `assertExecutionBinding()` with the stored envelope, the actual approved calculation digest, current context and releases still allowed for new execution. Then retain/use the approved output. Do not rerun calculation with the current newest kernel.

The surrounding application must still check the actor, entity/book, period, semantic effect identity, approval authority and current capacities. The helper makes none of those checks true by itself. A caller-supplied context is not proof of current database state.

## 6. No ambiguous rollback

A failed promoted calculator does not trigger a hidden TypeScript calculation. Return a typed failure and retain the existing uncertain-outcome discipline. For rollback, explicitly select a previously qualified release for new preparations. Old approvals keep their exact retained output and release identity. Revoking a release prevents new execution without rewriting historical records.

Delete duplicated TypeScript production arithmetic only after the chosen Bend operation is qualified and wired through its actual callers. Keep independent mathematical postcondition checks, historical fixtures and narrow PostgreSQL integrity checks. These are defenses at different boundaries, not competing production calculators.

## Limits

This archive does not modify the application's database schema or choose the storage field for calculation lineage. Those changes must use the current repository's actual contracts and transaction-passing persistence. The real-host verification hook is mandatory precisely because source-only integration cannot prove those behaviors.

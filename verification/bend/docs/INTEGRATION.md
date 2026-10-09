# Drastic integration

## Keep the first change isolated

This kit lives in `verification/bend/` outside the root workspace list. Run its Node commands independently. The local verification lane compares the current monetary owner using the checkout's installed dependencies. It adds no production dependency or capability claim.

The included rounding patch is historical: the current owner already delegates to the corrected shared `roundRational`. Do not apply it to the current checkout. Source-excerpt tests retain the historical regression; `verify:owner` separately exercises current source and its actual shared dependency.

## VAT boundary

Use the existing TypeScript owner to select qualified contributions from an immutable captured basis. The input to the Bend monetary model is only:

```ts
{
  contributions: [{ box: '10', signedMinor: '25000', included: true }],
  currencyScale: 2,
  filingUnitScale: 0,
  rounding: 'half_even',
  declareNet: true
}
```

The selected release supplies rounding and filing scale; the book supplies currency scale. The divisor is `10^(currencyScale - filingUnitScale)`; finer-than-book filing precision refuses. The adapter supplies no legal defaults. `half_up` maps to the owner's existing tie-away-from-zero behavior. Standalone rational arithmetic additionally supports exact, ceiling and the explicit `half_away` name.

Preserve the original contribution identity, rule release, inclusion decision and captured basis alongside the model's output. The monetary projection intentionally does not carry enough information to become a second eligibility owner.

Compare the Bend rows with `boxRows` while the existing owner stays authoritative. Any mismatch is a diagnostic requiring review. Do not choose whichever result looks more convenient and do not silently adopt a result produced under a different rule version.

## PRY-33 contract

The host accepts at most 64 candidates and a maximum 100,000-node search budget. Exceeding the pool limit is an input refusal, not truncation. These are research-adapter safety bounds, not Drastic's product limits.

Every candidate carries its resource ID, immutable revision, entity, book, snapshot, currency, scale, direction and remaining minor-unit amount. All must agree with the request's scope. Amounts are strictly positive magnitudes; direction is a separate field. The adapter rejects duplicates and zero capacities.

The algorithm selects whole remaining capacities. It does not split the final candidate to force a match. A cardinality limit defines the search domain: “unique within size 3” does not mean “unique among every possible set size.” The result exposes this boundary.

| Status | Meaning |
| --- | --- |
| `unique-within-scope` | Exactly one witness was found after exhausting the requested finite search and the caller declared the candidate pool complete. |
| `ambiguous` | At least two distinct valid witnesses are available. Exhausting the remaining search is unnecessary to establish ambiguity. |
| `no-match-within-scope` | The requested finite search was exhausted with no witness and the caller declared the pool complete. |
| `incomplete` | The pool was declared incomplete or the global node budget ended before a unique/no-match result could be established. A discovered witness may still be returned. |
| `unavailable` | The evaluator failed or its returned witness could not be independently validated. This is never converted to no-match. |

The adapter sorts resource IDs to make runs deterministic. This is not a confidence ranking. Two different resources with the same amount remain different candidate sets.

`poolComplete` is a caller declaration, not a bank-attested completeness proof. Name it accordingly in the UI. Results expose `poolCompleteDeclared` to avoid hiding that distinction.

## Accepting a suggestion

Before calling the existing bank-allocation preparation operation, reload current source and target capacities under the application's normal scope. Recheck revisions, eligibility, currency, direction and capacity. Resolve ambiguity explicitly. Prepare and approve the exact existing operation, not this research result.

At execution, reuse the current application transaction and its authority/dependency checks. A valid mathematical witness does not reserve capacity. Two correct suggestions can conflict after one is accepted.

The verification fingerprint binds a normalized diagnostic request. It is not `openerp-c14n-v1`, an approval digest, an idempotency key or an execution receipt. Do not substitute it for any of those identities.

## Runtime placement

The shipped host evaluator is a Node research process. It is not intended for a Cloudflare Worker request path. It performs no I/O inside the Bend kernels, has no database connection and does not call external services.

Start with CI/offline model checks. The next measured experiment can run captured suggestion inputs on a persistent job worker. Benchmark a production backend and real workload before changing placement or introducing GPU infrastructure.

C, JavaScript code generation, Metal and CUDA were not validated for these kernels in the authoring environment. No GPU speedup or native portability result is asserted.

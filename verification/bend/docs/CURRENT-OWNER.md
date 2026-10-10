# Current-owner adapter contract

The adapter compares against the real shared owners listed in the README. Do not restore the archived `actual.ts` extraction.

The installed adapter is `verification/bend/current-owner-authority.mjs`, selected explicitly through `OPENERP_OWNER_ADAPTER`. It imports the public `actualVatMonetary` owner directly, inventories the current product source and invokes the real host qualification recipe. It does not strip runtime imports or rewrite source text. See [qualification](QUALIFICATION.md).

## Required module exports

```ts
export const kind = 'openerp-current-owner/v1';
export const sourceFiles: readonly string[];
export function calculate(operation: string, input: unknown): unknown | Promise<unknown>;
export function verifyHost(options: {
  candidate: AuthorityService;
  artifactDigest: string;
  sourceTreeDigest: string;
}): Promise<HostResult>;
```

This is an interface description, not an implementation stub. Supply it in a normal application-owned module that imports the real current functions. `sourceFiles` lists their actual worktree paths, including all relevant monetary dependencies and reviewed adapter helpers. The loader adds the adapter itself to the digest. It rejects archived or test-oracle source files as owner evidence and detects source changes during a run.

### `calculate`

Implement these two operation mappings:

**`money.round.v1`:** take canonical numerator and denominator strings plus the selected rounding mode. Call the real shared rounding owner. Return `{ roundedMinor, residualNumerator, denominator }`, all canonical strings. Do not call Bend, `roundReference` or an archived excerpt on this side of the comparison.

**`vat.project.v1`:** take the typed `VatInput`, including `reportingUnitMinor`. Map that exact divisor to the current owner's reviewed unit/scale convention. Call the actual monetary projection. Return `{ rows }` with the current order, presence behavior, kind, exact amount, reported amount and residual. Keep inclusion decisions explicit and keep net calculation from reported primitive boxes.

The owner now exports the narrow `actualVatMonetary` dependency seam. `calculateActualVat` accepts that port and the Effect preparation workflow accepts a selected calculator. Kernel identity is retained in the existing immutable return body. The underlying default TypeScript calculation is reused, not copied into the adapter.

The supplied comparison suite includes 336 signed rounding vectors and 251 VAT projection cases. It includes exact negative floor division, ties, absent boxes, excluded contributions, scaling differences and the reported-net counterexample. Current-owner support for each scope must be reviewed. A mismatch is evidence to inspect, not permission to force equality.

Run locally with the development candidate:

```sh
OPENERP_REPO=/path/to/openERP \
OPENERP_OWNER_ADAPTER=/path/to/openERP/verification/bend/current-owner-authority.mjs \
npm --prefix verification/bend run verify:owner
```

This records current-owner comparisons but does not qualify compiled execution. The release gate repeats them against the actual generated artifact.

## `verifyHost`

This hook invokes the repository's actual application test harness with the candidate monetary dependency. It must return:

```ts
interface HostResult {
  assertions: number;  // positive
  operations: readonly string[];
  checks: ReadonlyArray<{ name: string; status: 'passed' | 'failed' }>;
  synthetic?: false;
}
```

Required checks are named `immutable-capture`, `changed-basis-refuses`, `approved-output-not-recomputed`, `no-typescript-fallback` and `current-owner-call-path`.

Exercise real captured basis/report/proposal records and the selected integration boundary, not just a mock that returns `true`. Broader transaction, concurrency and permission cases remain the application's responsibility. The supplied authority unit tests are not used as a substitute for this hook.

The runner provides a harness-only candidate service. It does not write deployment trust and does not issue valid production approval. This hook must use isolated test infrastructure, never live company books.

The `sourceFiles` dependency inventory and host coverage need human review. Hashes establish which bytes were checked; they do not prove that an adapter named every relevant dependency or exercised a meaningful test.

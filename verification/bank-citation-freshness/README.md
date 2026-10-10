# Bank citation freshness

Owner review bug 6, synthetic HTTP evidence only. Same actor, session, book and bank-row identity at an older source revision returns `409 StaleDependency`. Foreign identity, actor, book and session remain forbidden. Discovery, direct matching, allocation preparation and approval share bank subject construction. The candidate response exposes the exact stored ranked `optionSetDigest`, separately from its broader response digest.

The request driver used by the existing bank screen refreshes candidates after parsed HTTP 409 `StaleDependency`. It resubmits once with a new citation and payload key only when option digests match. Changed options retain the refusal and refresh the existing candidate view for a new decision; a second stale response escapes without another refresh. Saved or uncertain request replays keep their exact payload/key and cannot automatically substitute newly observed options. The form's storage replacement checks the original request binding and saves the replacement before sending it.

## Evidence

- Before: `test-results/pr20-bank-freshness-before`, one selected workflow failed because row B's citation returned 403 after row A matched. Stable source hash `bd0bcce74773873c415b27ca0d840958ac9b07b071e7caa008a433a02b89d3fd`.
- Intermediate: `test-results/pr20-bank-freshness-after`, freshness and existing bank authorization workflows passed; the driver workflow stopped at an invalid overlapping statement fixture. This is not passing driver evidence.
- After: `test-results/pr20-bank-freshness-resumed`, two selected workflows passed and three were unselected. The fixture imports unrelated statements on October 1 and October 2, outside the original September range. Existing overlap checks stay intact. [observed.json](observed.json) derives exact digest comparisons, keys, retry counts and outcomes from the retained driver artifact and source-integrity record.

```sh
OPENERP_E2E_ARTIFACTS=test-results/pr20-bank-freshness-resumed bun run test:e2e \
  apps/api/tests/decision-provenance.e2e.test.ts \
  -t 'same bank subject stale citation|bank request driver refreshes'
```

The driver uses real fetch into disposable PostgreSQL and the Worker HTTP application. Assertions bind the option digest independently to the stored suggestion record; successful refreshed preparation is also approved through the public allocation owner. These tests do not render the screen or exercise browser sessionStorage. Recovery replacement and component wiring are source/type checked; browser, storage, composition and visual parity remain unverified. Exposure equivalence across earlier revisions is separate bug 7 and is unchanged here; successful refresh is not claimed to produce independent or clean labels.

Final changed-file and clean-commit qualification are recorded by the parent checkpoint. Full/owners/design and required MCP schema checks are not claimed by this focused evidence.

# Page 00 delivery contract

Page 00 owns current visual composition. Adopted product contracts own behavior,
permissions and financial rules. Archived designs preserve historical obligations
until reconciled; their example amounts, approval policies and proposed features
are not automatically adopted. Code records implementation, not acceptance.

## References and ledger

`verification/paper/kanon-manifest.json` is the machine-readable ledger. The
2026-10-09 snapshot contains page 00 PNGs, JSX and root computed styles. It is a
reference capture, not proof that the code matches or that every illustrated
behavior is adopted. Exact screen/state adoption is recorded in each entry.
Use `bun run check:design` to validate references and the legacy-import ratchet.
After manifest edits, regenerate the human ledger with
`bun run check:design --write-ledger`; CI rejects a stale rendered ledger.
The older `parity-manifest.json` stays intact for historical harness consumers;
its deleted-page targets are not the current visual acceptance authority.
K-00–K-07 include explanatory board content, not just rendered UI. Foundation
verification must create separately adopted specimen entries from the actual
Paper component nodes with their own dimensions/hashes, or an approved reference
composition. Product screens do not need to render the board's instructions.
Keep those specimen comparisons separate from full product-route acceptance.

Statuses: `unverified`, `design-pending`, `drifts`, `matches`, `missing`.
Only measured evidence can establish `drifts` or `matches`. A missing route or
unadopted state stays explicit. Never replace a baseline with the application's
screenshot to obtain a pass. Never loosen tolerances or hide changed regions.

For a UI change, map each changed file to a manifest entry and update its contract
in the same change. Record the actual route, audience, approved board/state,
behavior source, component owners and required interactions before implementation.
An unmapped legacy screen needs a new entry; do not force it onto a similar board.
Before modifying an entry's UI files, set its actual route, required states and
`adoption: "approved"` after reviewing the exact target. Candidate owner mappings
in the initial ledger need confirmation. The guard requires each affected entry
to change, rather than accepting an unrelated manifest edit.
Private archive originals remain in drastic-hq. Copy only reviewed synthetic
requirements/assets needed for public implementation; public contributors must
not require private workspace access.

## Verification

Compare the real application route using synthetic stored data, at the baseline
dimensions, with pinned browser, fonts, locale, theme, time and device scale.
Retain baseline/actual/diff images and a result naming the source revision,
reference SHA-256, capture command, rendering conditions, measured difference,
adopted tolerance and reviewer. Exercise keyboard/focus, state transitions,
reload, changed-source refusal and unknown-outcome recovery separately through
the normal API/browser owners. Gallery proof does not qualify a product route.
Keep browser evidence under a tracked evidence directory; transient test-results
alone cannot support a `matches` claim. No screenshot comparison was run when
this initial ledger was created.

After adopting an entry's `comparison` policy (`channelTolerance`, `maxDiffRatio`,
`adoptedBy`), run `node verification/paper/compare.mjs K-xx capture.json
evidence-directory`. Capture metadata names `actual`, `command`, `reviewer`,
`sourceRevision`, SHA-256 `sourceHashes` for the owning files, and `conditions`
with browser, deviceScaleFactor, fonts, locale, theme, time, fixture, viewport
and route. The runner rejects changed sources/references and image resizing;
it writes actual/diff/result and fails above the adopted tolerance. It does not
capture the browser or automatically approve/update a manifest entry.

## Migration order

1. Verify tokens, shell/topbar, layouts, rows/panels, actions and overlays.
2. Deliver Att göra → Granska → questions/recovery → Bankmatchning as a real loop.
3. Deliver invoices, drafts, recurring invoices and reminders.
4. Deliver vouchers, VAT, closing, bureau portfolio and overview.

Use kanon for new and reworked compositions. Existing legacy import exceptions
are exact file/module pairs in `legacy-ui-imports.json`; remove pairs as callers
migrate. No new pair may be added after this initial inventory. Generic UI
infrastructure exemptions are explicit in that file and require separate review.

## Linear reconciliation

Label open issues referencing deleted pages `design-reference-stale` until their
individual mappings are resolved. Preserve the historical issue text and append
a dated replacement visual contract. Keep behavior and recovery obligations.
Pure visual work can close as superseded only after its replacement and remaining
acceptance have been identified. No matching K-board means `design-pending`, not
permission to invent a screen. Preserve completed slices and owner-paused checks.

## Guard failure contract

Before implementing the guard, retain these failure cases: new file importing
legacy UI; new legacy module in an existing file; re-export or dynamic import
bypassing the rule; stale exception after removal; exception inventory growth;
missing/changed baseline; duplicate screen IDs; changed UI without a mapping or
contract update; matched status without durable evidence. The guard enforces
mechanical coverage and reference integrity, not visual or behavioral correctness.

Comparison failures to retain before implementing the runner: missing adopted
tolerance; changed baseline hash; wrong image dimensions; missing capture
conditions/provenance; changed implementation after capture; image mismatch above
the adopted tolerance. Comparison must not rescale, crop or mask either image.

# K-01 loaded palette verification

Owner. Erik Kroon. Refs DRA-180 and DRA-179.

Screen and audience. The synthetic bureau operator's real
`/entities/$entityId/books/$bookId/overview` route exercises the shared appearance
menu. The bookkeeping route checks theme use in a register.

Adopted reference. K-01 Tokens, light and dark states, revision
`kanon-2026-10-09`. The independent expected colors come from the named swatches
in [the captured JSX](../../baseline/kanon-2026-10-09/K-01.jsx.json).
No reference or adoption policy changes in this slice.

Behavior source. The appearance preference owners are
`apps/web/src/lib/theme.ts`, `apps/web/src/lib/preference.ts` and
`apps/web/src/routes/__root.tsx`. Appearance is local to the browser.
This verification uses the existing book authority and synthetic session.
It neither reads amounts as expectations nor changes accounting behavior.

Required states. Light, selected dark, dark after reload and restored light.
The synthetic overview has empty registers and transient pending reads. The
heading wait establishes that the route rendered, not that every read settled.
Error, blocked, stale and unknown outcome are outside this palette slice.
K-10 and K-11 behavior acceptance remains open.

Shared owners. `packages/ui/src/styles/globals.css` defines the palettes.
`packages/ui/src/theme/kanon.stylex.ts` exposes the tokens to kanon parts.
`BookWorkspace` owns the appearance control. The test reads the loaded root
variables through the browser's computed styles.

Failure cases recorded before extending the browser recipe:

- A named K-01 variable is missing or has the wrong light or dark value.
- Choosing dark leaves the light palette or changes only some variables.
- Reload loses the saved theme or changes its loaded palette.
- Restoring light leaves a dark class or dark palette behind.
- The served document omits the preference script.
- A register still renders light text in dark mode.
- The appearance control is ambiguous or cannot close after selection.
- Runtime startup, authentication or source-integrity verification fails.
- An artifact exposes credentials or cannot be traced to the tested sources.

Keyboard, native 200% zoom, narrow width and full component use of the tokens
remain unverified here. The existing recipe selects the actual appearance
control but does not qualify all shell interactions.

Missing decisions. K-01 is an explanatory board with no comparison policy.
Separate specimen adoption is still required for visual comparison. The product
overview fixture does not reproduce K-08's illustrated state. These captures
cannot establish either board's visual parity.

Repeat the browser recipe with `bun run test:browser
tests/browser/dark-theme.e2e.ts`. The launcher owns a fresh PostgreSQL, API, web
runtime and browser. It configures a 1440 by 900 viewport, Swedish locale and
Europe/Stockholm timezone. It selects the pinned Codex proxy and Luna model.

Done checks for this slice are the exact loaded palette assertions, reload and
restore assertions, source-integrity receipt, reviewed JSON and screenshots,
`check:browser`, `check:changed`, `check:changed:full` and the K-01 manifest note.
Baseline PNGs remain in the immutable reference directory. No actual/diff/result
comparison is claimed, and K-01 remains `unverified`.

Observed result. The [palette receipt](palette.json) records all 14 named colors
in four states. The [run receipt](receipt.json) records the passing selected
test, exact owning source hashes and stable source census digests. The run used
a modified checkout and does not claim clean-checkout qualification. The
configured model was Luna, but this deterministic recipe has no agent steps and
claims no model judgment. The four retained screenshots contain synthetic data
and show the existing route, including pending reads. They are theme evidence,
not visual comparison inputs.

Implementation. This slice changes verification and ownership metadata only.
The application palette already matches the named reference colors.
Remaining work includes K-01 typography and dimensions, adopted specimens,
K-06 shell migration, K-10 and K-11 route comparisons and Phase B product work.
Production qualification is outside this synthetic exercise.

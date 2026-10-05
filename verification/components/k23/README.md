# K23 shared component board

This standalone fixture renders the shared UI package without the product app, database or authentication. Paper's K23 frame in Enthusiastic lantern is the reference. The retained JSX and computed styles supply dimensions and copy. The provided 1440 by 1080 Paper PNG supplies the comparison baseline.

Run from the repository root when the serial verification slot is available:

```sh
node verification/components/k23/parity.mjs
```

The gate starts one loopback Vite renderer, launches one Chromium, waits for local Inter and writes `k23.actual.png`, `k23.diff.png` and `report.json` to `test-results/components/k23`. It uses the existing pixel tolerance of 24 and 1% maximum difference. Set `K23_PARITY_OUT` to retain a dated result elsewhere. It closes its browser and server on completion or failure.

The fixture imports actual shared Button, Input, CheckboxControl, SwitchControl, DecisionCard, SemanticNote, WorkflowStatusLabel, Heading and Text components. SettingsNavigationItem is the same item consumed by SettingsWorkspace; RegisterNavigation owns route links without ARIA tab-panel semantics; RegisterRowSurface supplies the same selected and hover treatments consumed by RegisterRow. Its compact density is K23's 34 px row and 36 px navigation, while existing register density retains other frames' 40 px row and 47 px header navigation. Local styles compose the board. Simultaneous hover and focus previews change state appearance only. Accepted outline/ghost weight and ghost padding are shared Button defaults.

The gate then reloads with `?natural=1` to remove all previews and checks keyboard-focused input, invalid input, hovered ghost Button, solid Button focus and inline row-control focus. State observations and screenshots are retained. This bounded visual qualification does not establish full keyboard navigation, runtime accessibility or product E2E behavior.

The [failure contract](failure-contract.md) retains admission and proof requirements. Static parity does not establish keyboard interaction, runtime accessibility, narrow layout or parity of any product screen. New browser E2E qualification uses the repository's pinned TesterArmy and Luna recipe separately.

The retained [2026-10-05 report](proof/report.json) passed at 0.7591% difference, with the local font loaded, zero browser errors and all bounded native visual states passing. The [actual image](proof/k23.actual.png), [diff image](proof/k23.diff.png), [native input focus](proof/k23.focus.png), [invalid input](proof/k23.invalid.png), [ghost hover](proof/k23.hover.png), [row focus](proof/k23.row-focus.png) and imported-source hashes record that run. Repository checks and full interaction qualification are separate obligations in the [DRA-127 evidence](../../../docs/plans/evidence/dra-127-component-board-2026-10-05.md).

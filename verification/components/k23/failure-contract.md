# K23 component verification failures

The fixture must render shared production components, not a screenshot or copied control markup. The standalone renderer must not start the accounting API, connect to a database, require authentication, or submit financial commands.

Before implementing the board and its gate, these cases must fail or remain explicit:

- Missing Paper baseline, missing source JSX/styles, invalid PNG, or a baseline with different dimensions.
- Missing local font, stylesheet, shared component import, or a browser console/page error.
- A pixel difference above the existing 1% gate with the existing tolerance of 24.
- A screenshot taken before the local font loads or after controls change from their specified initial state.
- A server outside loopback, a missing board root, or an HTTP request to an external provider/API.
- A fixture that overrides shared control colors, dimensions or selected styles to hide a production component defect.
- A checkbox or switch that has no accessible name, cannot receive keyboard focus, or does not retain its changed state.
- A decision group that permits both choices to be selected.
- A disabled save button that accepts activation, a readonly field that becomes editable, or an invalid field that loses its error association.
- A missing actual/diff image, source hash or result report. A check that was not executed cannot establish completion.

The board's simultaneous focus and hover examples require fixture-only state previews. Those previews are labeled in its source and do not establish runtime focus or hover correctness. The gate must exercise actual keyboard focus separately when interaction qualification runs.

The native visual-state qualification reloads with `?natural=1`, removing every simultaneous state preview. A real keyboard-focused editable field must have the blue 2 px border; an invalid field must retain its red border and error association; a solid Button must retain a visible focus shadow despite its zero-width border; a hovered ghost button must have the accepted fill, 10 px inline padding and normal weight; the inline row control must have a blue outline without a fill. Failure must affect the report result and retain a state screenshot. These bounded style checks do not establish full keyboard navigation, accessibility or product E2E qualification.

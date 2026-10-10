# Page 00 boards for agents without Paper

Everything an agent needs from Paper page 00 ("00 Kanon: designsystem och Bureau")
is in the repository, so cloud agents and orbs can build and compare without
Paper access.

| What | Where |
| --- | --- |
| Board images at 1x, the comparator baseline | `../baseline/kanon-2026-10-09/K-xx.png` |
| Board structure and exact styles (Paper JSX export) | `../baseline/kanon-2026-10-09/K-xx.jsx.json` |
| Token values the JSX references (`var(--color-k26-…)` and others) | `tokens.css` |
| 2x images of the adopted screens and core rule boards, for reading small text and spacing | `2x/K-xx.png` |
| Pattern boards M-01 Två godkännare, M-02 Godkännandet gäller inte längre, M-03 Utfall i flera steg (not adopted) | `patterns/` |
| Board to route, adoption and comparison policy | `../kanon-manifest.json` |

On 2026-10-10 every 1x baseline image was re-exported from Paper and was
pixel-identical to the committed baseline (0.000% difference for all 27 boards
compared), and the token hash was unchanged. The baseline is current.

Rules:

- Take exact values from the JSX and `tokens.css`; use the images to verify, not
  to measure.
- The comparator (`../compare.mjs`) measures only against the adopted 1x
  baseline. The 2x images and pattern boards are references and never replace a
  baseline. Baseline changes need explicit design adoption.
- The application implements these tokens as kanon tokens in
  `packages/ui/src/styles/globals.css`; build from `@open-erp/ui/kanon/*`, not
  from the raw Paper names.

# Sources and provenance

The primary source baseline inspected for this work is:

- OpenERP commit `0eaad6402241ff3853fdc1af015e13f343873641`.
- Bend commit `af569d4826913b2ce3557e9829ccad31fcf86f94`.

The archive author did not have the integrated worktree. That historical context is retained in `evidence/historical/parent-integration-reported.json`. Current hashes and observed compiler results are in `evidence/current/`.

## Primary references

- https://github.com/erik-kroon/openERP/blob/0eaad6402241ff3853fdc1af015e13f343873641/docs/architecture.md
- https://github.com/erik-kroon/openERP/blob/0eaad6402241ff3853fdc1af015e13f343873641/docs/domain.md
- https://github.com/erik-kroon/openERP/blob/0eaad6402241ff3853fdc1af015e13f343873641/jurisdictions/se/src/vat/actual.ts
- https://github.com/bendlang/bend/blob/af569d4826913b2ce3557e9829ccad31fcf86f94/bend2/bend.ts
- https://github.com/bendlang/bend/blob/af569d4826913b2ce3557e9829ccad31fcf86f94/bend2/comp.ts
- https://github.com/bendlang/bend/blob/af569d4826913b2ce3557e9829ccad31fcf86f94/bend2/main.ts
- https://github.com/bendlang/bend/blob/af569d4826913b2ce3557e9829ccad31fcf86f94/bend2/safe.ts

The JS build adapter uses `js_lib(book, roots, exports)` and constructor metadata. Verification fetched and hash-checked the pinned source, ran the official source checker and produced identical JS artifacts. The compiled suites and independent safe kernel pass. The Lean 4.34.0 asset pin and reproduction commands are recorded in `docs/QUALIFICATION.md`.

## Exact upstream blob pins

| File | Git blob SHA-1 |
| --- | --- |
| `bend2/bend.ts` | `c38e9e203530568b500dfc34785372d427706a6c` |
| `bend2/comp.ts` | `12ffbef1837a184fb7c5a255c4847397b2eec75a` |
| `bend2/base.bend` | `06fe1e8c4741987ae04b171ac785b2258371ddc3` |
| `bend2/safe.ts` | `c9cfdc11bb5b8339fd076827e7d5ba08458990d3` |
| `bend2/bendtt.lean` | `3ea970dfbb204740d094d1e3504c91ecdb6901f2` |
| `bend2/main.ts` | `0d5be3fdda74d076c4ebdd53b60d73fd155506ef` |

## Archived material

The original downloadable kits and their distribution manifests are in Git
history; this folder keeps only what the checks use.

`tooling/dev-checker.ts.gz` is the byte-preserved development adaptation under the upstream Apache license. It is never accepted by the official build path. `upstream/vat-monetary-slice.ts.gz` and the old floor patch remain historical regression material. The current shared owner has already corrected negative integral floor. The current-owner comparison never uses the excerpt.

New OpenERP-related source is distributed under AGPL-3.0-only. The inherited Apache-licensed checker material retains its separate notice and license. See `NOTICE`, `LICENSE` and `tooling/LICENSE-APACHE-2.0`.

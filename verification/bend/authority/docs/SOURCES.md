# Sources and provenance

The primary source baseline inspected for this work is:

- OpenERP commit `0eaad6402241ff3853fdc1af015e13f343873641`.
- Bend commit `af569d4826913b2ce3557e9829ccad31fcf86f94`.

The archive author did not have the integrated worktree. That historical context is retained in `evidence/historical/parent-integration-reported.json`. The local integration now reuses the parent's checked loader and source archives; current hashes and observed compiler results are in `evidence/current/`.

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

## Archives

`archives/openerp-bend-kit-0.1.0.zip` is the exact original downloadable kit, preserved byte-for-byte. Its SHA-256 is in `archives/SHA256.json`. It is not a complete official Bend checkout. The new archive does not replace the parent's preserved upstream-source archives.

`../tooling/dev-checker.ts.gz` is the parent's byte-preserved development adaptation under the upstream Apache license. It is never accepted by the official build path. `../upstream/vat-monetary-slice.ts.gz` and the old floor patch remain historical regression material. The current shared owner has already corrected negative integral floor. The authority owner gate does not use the excerpt or the parent's source-inspection harness.

`archives/authority-upgrade-manifest.json` is the original distribution manifest,
verified by the no-overwrite installer before adaptation. Local changes reuse the
parent loader, bind its dependencies into source hashes, satisfy repository
lint/type rules, make declaration checks mandatory, and repair the existing
development-refusal test so it also runs under the compiled backend. The Bend
implementation and proof bytes are unchanged from the supplied upgrade.

New OpenERP-related source is distributed under AGPL-3.0-only. The inherited Apache-licensed checker material retains its separate notice and license. See `NOTICE`, `LICENSE` and `tooling/LICENSE-APACHE-2.0`.

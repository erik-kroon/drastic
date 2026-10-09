# Bank review capture comparison

Compare the retained TesterArmy captures with the approved O37/O37a–e PNGs. This is an offline image comparison, not another browser runtime. Keep the existing parity metric: the maximum RGB channel difference exceeds 24, and at most 1% of the complete 1440 × 900 frame may differ. Do not crop, mask, rescale, replace a baseline, or raise the threshold to obtain a pass.

Before implementation, these failures must remain explicit. Missing, non-PNG or non-opaque inputs fail. Different dimensions fail. A changed baseline or capture hash fails. Missing or duplicate state entries fail. Any state above the bound fails the whole comparison. Invalid limits and paths outside the checkout fail. A passing pixel comparison cannot establish source identity, correct selection, behavior or issue completion; retain those independent checks.

Use the pinned offline tool with `uv run --no-project --python 3.11 --with pillow==11.3.0 python verification/paper/compare-bank-captures.py <manifest.json> <output-directory>`. Pillow is a temporary verification dependency, not a product dependency. The manifest retains exact file hashes and six state mappings. Keep its report and full-frame diff PNGs with the implementation evidence.

## Scoped owner decision, 7 October 2026

The user instructed “under 2.5% can be called pass”. The decision authorizes a strict ratio below 0.025 for O37 and O37a–e. Preserve full frames, baseline/capture hashes and pixel tolerance 24. Historical manifests retain the 1% gate. New 2.5% manifests must reference this decision; missing or inconsistent authority, mixed limits, or a ratio at exactly 2.5% fail. No broader acceptance obligation is waived.

Historical planning links and captures omitted from this source distribution remain in the private working archive.

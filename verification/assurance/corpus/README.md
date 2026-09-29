# Independent synthetic corpus

`rounding.json` contains 420 expected signed-rounding outcomes calculated with Python exact integers/Fraction, not the application. `release.json` contains 72 cumulative endpoint differences. `canonical.json` contains seven manually specified canonical strings and independent SHA-256 digests. `financial-vectors.json` keeps selected human-readable expected accounting consequences.

These are arithmetic and identity fixtures, not statutory rules or company data. Production tests import the actual TypeScript owners and compare their outputs to these expectations. They do not invoke the production calculator to manufacture expected results. The reference generator is `../scripts/generate-oracle.py`; it must not run as part of an ordinary test execution or automatically bless changed expectations.

The source date schema currently has lexical versus calendar-owner distinctions. Do not require the lexical AccountingDate schema alone to implement every date-policy check. C14N generic JSON also permits numeric -0 to normalize to 0, while monetary strings reject -0. The tests preserve those actual contract boundaries rather than claiming all types have identical semantics.

If a qualified financial rule changes, supply an independently reviewed expected example and update its specific version. Never weaken a failing test solely to make the implementation pass.

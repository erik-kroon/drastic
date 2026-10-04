# Offline Peppol validator

This is the technical validator for the selected local exchange adapter. It does not qualify a network access point or participant. `vendor/manifest.json` pins exact unmodified UBL2.1 XSD closure, OpenPeppol May2026 release3.0.21 and EN16931 rules1.3.16, and the MIT Schematron compiler revision. The full XML notices are preserved. EN16931 is distributed under EUPL1.2; its license is retained here. The official examples are unchanged synthetic interoperability documents from https://docs.peppol.eu/poacc/billing/3.0/files/BIS-Billing3-Examples.zip.

Bootstrap the ignored local Python environment with the pinned SaxonC-HE12.9 wheel and verified hashes:

```sh
node verification/peppol/setup.mjs
.cache/peppol-validator/bin/python verification/peppol/check.e2e.py
```

The CLI `validate.py` reads one JSON request from stdin containing exact XML, pinned `releaseSha256` and expected retained semantic fields. It writes one complete JSON validation receipt. XSD parsing uses `xmllint --nonet`; Schematron uses SaxonC with protocol resolution restricted to local files and pinned rule/compiler bytes. DTD, entity and XInclude inputs refuse before parsing. Temporary original/compiled bytes are removed when the process exits. The surrounding adapter must use a bounded process deadline and authenticated requests.

Eleven public CLI checks passed on4October2026: original invoice/credit, changed buyer/tax/reference, unpinned release, changed rule bytes, unavailable engine, entity declaration, unsupported root and malformed XML. Saved receipts are in `test-results/peppol-validation/`. These validate the actual offline engine, not the unfinished exchange application owner. A missing engine or changed vendor file returns `ValidationUnavailable` and cannot pass.

import json
import hashlib
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import sys

root = Path(__file__).resolve().parent
out = Path(os.environ.get("PEPPOL_VALIDATION_OUT", "test-results/peppol-validation"))
out.mkdir(parents=True, exist_ok=True)
release_hash = hashlib.sha256((root / "vendor/manifest.json").read_bytes()).hexdigest()
expected = {"documentId": "Snippet1", "documentType": "Invoice", "currency": "EUR", "sellerParticipant": "9482348239847239874", "buyerParticipant": "FR23342", "exclusiveMinor": "132500", "taxMinor": "33125", "payableMinor": "165625", "originalInvoiceRef": None, "buyerReference": "0150abc", "orderReference": None}
results = []

def check(name, xml, semantic, outcome, release=release_hash, validator=root / "validate.py", interpreter=sys.executable):
    result = subprocess.run([interpreter, str(validator)], input=json.dumps({"xml": xml, "expected": semantic, "releaseSha256": release}), text=True, capture_output=True)
    assert result.stdout, name + ": validator produced no receipt " + result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["outcome"] == outcome, name + ": " + json.dumps(receipt)
    assert result.returncode == (0 if outcome == "passed" else 1), name
    (out / (name + ".json")).write_text(json.dumps(receipt, indent=2) + "\n")
    results.append({"name": name, "outcome": outcome})

invoice = (root / "fixtures/base-example.xml").read_text()
credit = (root / "fixtures/base-creditnote-correction.xml").read_text()
check("official-invoice", invoice, expected, "passed")
check("official-credit", credit, dict(expected, documentType="CreditNote", originalInvoiceRef="Snippet1"), "passed")
check("wrong-buyer", invoice.replace(">FR23342<", ">FR23343<"), expected, "SemanticMismatch")
check("wrong-tax", invoice.replace(">331.25<", ">331.26<"), expected, "ValidationFailed")
check("wrong-credit-reference", credit.replace("<cbc:ID>Snippet1</cbc:ID>", "<cbc:ID>Other1</cbc:ID>", 2), dict(expected, documentType="CreditNote", originalInvoiceRef="Snippet1"), "SemanticMismatch")
check("unavailable-engine", invoice, expected, "ValidationUnavailable", interpreter="/usr/bin/python3")
with tempfile.TemporaryDirectory(prefix="openerp-validator-drift-") as scratch:
    copied = Path(scratch)
    shutil.copytree(root / "vendor", copied / "vendor")
    shutil.copy2(root / "validate.py", copied / "validate.py")
    (copied / "vendor/rules/PEPPOL-EN16931-UBL.sch").write_text("changed")
    check("changed-rule-bytes", invoice, expected, "ValidationUnavailable", validator=copied / "validate.py")
check("unpinned-release", invoice, expected, "ValidationUnavailable", "0" * 64)
check("external-entity", '<!DOCTYPE Invoice [<!ENTITY external SYSTEM "file:///etc/passwd">]>' + invoice, expected, "UnsafeXml")
check("unsupported-root", "<Invoice/>", expected, "UnsupportedDocumentType")
check("malformed-xml", "<Invoice", expected, "MalformedXml")
(out / "receipt.json").write_text(json.dumps({"synthetic": True, "publicSurface": "validator CLI", "results": results}, indent=2) + "\n")
print(str(len(results)) + " public validator checks passed")

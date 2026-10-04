import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
NS = {"c": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2", "a": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"}
ROOTS = {"{urn:oasis:names:specification:ubl:schema:xsd:Invoice-2}Invoice": "Invoice", "{urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2}CreditNote": "CreditNote"}


class Refusal(Exception):
    def __init__(self, outcome, diagnostics=None):
        self.outcome = outcome
        self.diagnostics = diagnostics or []


def minor(value):
    if value is None or not re.fullmatch(r"-?[0-9]+(?:\.[0-9]{1,2})?", value):
        raise Refusal("UnsupportedAmount")
    negative = value.startswith("-")
    whole, _, fraction = value.removeprefix("-").partition(".")
    amount = int(whole) * 100 + int(fraction.ljust(2, "0"))
    return str(-amount if negative else amount)


def validate(request):
    manifest_bytes = (VENDOR / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    release_hash = hashlib.sha256(manifest_bytes).hexdigest()
    if request.get("releaseSha256") != release_hash:
        raise Refusal("ValidationUnavailable")
    declared = set()
    for entry in manifest["files"]:
        path = VENDOR / entry["path"]
        if path.is_symlink() or path.resolve() != path or not path.resolve().is_relative_to(VENDOR):
            raise Refusal("ValidationUnavailable")
        raw = path.read_bytes()
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise Refusal("ValidationUnavailable")
        declared.add(entry["path"])
    actual = {str(p.relative_to(VENDOR)) for p in VENDOR.rglob("*") if p.is_file() and p.name != "manifest.json"}
    if actual != declared:
        raise Refusal("ValidationUnavailable")
    xml = request["xml"]
    if not isinstance(xml, str) or len(xml.encode("utf-8")) > 1048576:
        raise Refusal("UnsafeXml")
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?\s*(?!xml\b)|http://www.w3.org/2001/XInclude", xml, re.I):
        raise Refusal("UnsafeXml")
    try:
        document = ET.fromstring(xml)
    except ET.ParseError:
        raise Refusal("MalformedXml")
    document_type = ROOTS.get(document.tag)
    if document_type is None:
        raise Refusal("UnsupportedDocumentType")
    reports = []
    with tempfile.TemporaryDirectory(prefix="openerp-bis-validation-") as scratch:
        source = Path(scratch) / "document.xml"
        source.write_text(xml)
        result = subprocess.run(["/usr/bin/xmllint", "--nonet", "--noout", "--schema", str(VENDOR / "ubl/xsd/maindoc" / ("UBL-" + document_type + "-2.1.xsd")), str(source)], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise Refusal("ValidationFailed", [{"validator": "UBL2.1 XSD", "diagnostic": result.stderr.replace(scratch, "<private>")}])
        from saxonche import PySaxonProcessor
        with PySaxonProcessor(license=False) as processor:
            if processor.version != "SaxonC-HE 12.9 from Saxonica":
                raise Refusal("ValidationUnavailable")
            processor.set_configuration_property("http://saxon.sf.net/feature/allowedProtocols", "file")
            compiler = processor.new_xslt30_processor().compile_stylesheet(stylesheet_file=str(VENDOR / "compiler/iso_svrl_for_xslt2.xsl"))
            for name in ["CEN-EN16931-UBL", "PEPPOL-EN16931-UBL"]:
                compiled = Path(scratch) / (name + ".xsl")
                compiled.write_text(compiler.transform_to_string(source_file=str(VENDOR / "rules" / (name + ".sch"))))
                validator = processor.new_xslt30_processor().compile_stylesheet(stylesheet_file=str(compiled))
                report = validator.transform_to_string(source_file=str(source))
                svrl = ET.fromstring(report)
                failures = [{"id": node.get("id"), "flag": node.get("flag"), "location": node.get("location"), "text": " ".join(node.itertext()).strip()} for node in svrl.findall("{http://purl.oclc.org/dsdl/svrl}failed-assert")]
                reports.append({"validator": name, "failedAssertions": failures, "svrl": report})
            if any(report["failedAssertions"] for report in reports):
                raise Refusal("ValidationFailed", reports)
    def text(path):
        nodes = document.findall(path, NS)
        if len(nodes) > 1:
            raise Refusal("SemanticMismatch")
        return nodes[0].text if nodes else None
    observed = {"documentId": text("c:ID"), "documentType": document_type, "currency": text("c:DocumentCurrencyCode"), "sellerParticipant": text("a:AccountingSupplierParty/a:Party/c:EndpointID"), "buyerParticipant": text("a:AccountingCustomerParty/a:Party/c:EndpointID"), "exclusiveMinor": minor(text("a:LegalMonetaryTotal/c:TaxExclusiveAmount")), "taxMinor": minor(text("a:TaxTotal/c:TaxAmount")), "payableMinor": minor(text("a:LegalMonetaryTotal/c:PayableAmount")), "originalInvoiceRef": text("a:BillingReference/a:InvoiceDocumentReference/c:ID")}
    if observed != request["expected"]:
        raise Refusal("SemanticMismatch", reports)
    return {"outcome": "passed", "releaseSha256": release_hash, "xmlSha256": hashlib.sha256(xml.encode("utf-8")).hexdigest(), "semantic": observed, "diagnostics": reports, "networkResolution": "disabled", "networkAccessPointQualification": "not-established"}


try:
    request = json.loads(sys.stdin.read(2097153))
    receipt = validate(request)
except Refusal as failure:
    receipt = {"outcome": failure.outcome, "diagnostics": failure.diagnostics}
except Exception:
    receipt = {"outcome": "ValidationUnavailable", "diagnostics": []}
print(json.dumps(receipt))
sys.exit(0 if receipt["outcome"] == "passed" else 1)

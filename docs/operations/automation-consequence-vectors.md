# Independent consequence vectors

Prepared before AUT-03 implementation or observed results. These synthetic expectations do not adopt a production K2 mapping.

| Captured inputs | Expected result |
| --- | --- |
| Two expense accounts explicitly mapped to the same synthetic K2 leaf, with identical VAT category, normalized deductible share, period and required dimensions | Equivalent |
| Same leaf, category and period; deductible share `1/1` versus `1/2` | Different |
| Same apparent leaf name; balance-sheet asset versus income-statement expense | Different |
| One account absent from the captured mapping | Unknown |
| Same treatment components; changed mapping content checksum | Different class identities |
| Same components; explicit VAT category missing | Unknown |
| Same components; required dimension value differs | Different |
| Same components; deductible shares `1/2` and `2/4` | Equivalent |
| Two identical incomplete captures | Unknown |

Use mapping content identity, not its schema version, to distinguish changed mappings. Current supplier treatment records do not declare a VAT category; a rate, account number or full-deduction flag cannot substitute for it. Current statement role mappings do not establish detailed K2 classification. The consumer must preserve these limits as unknown facts.

The intended application consumer is the AUT-02 captured-evidence export. It must not select a later statement mapping or rebuild required dimensions from the current catalogue. Known consequence classes require captured applicability, period and dimension requirements. Exact financial values remain separate from text redaction.

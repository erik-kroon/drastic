# AUT-04: retained purchase VAT categories

This is a bounded opt-in extension of the existing Swedish purchase owner. ADR 0002 remains a research decision: it establishes no approved production VAT profile, legal commencement dates or deduction entitlement. Synthetic releases may declare synthetic validity intervals to verify mechanics; their rates do not adopt tax law.

Existing `ReviewedTreatment` keeps its required exact rate, deduction, rounding and tolerance. Existing requests and posted records retain their meaning. An optional explicit category selection asks the server to verify those exact numbers against a declarative purchase-category section of the immutable VAT release actually admitted at the retained tax point. A category is never inferred from an account, rate or full-deduction basis.

The first supported entitlement is ordinary domestic purchase with separately reviewed full deduction. Representation, mixed use, partial deduction, reverse charge and unknown entitlement are outside this resolver. A release category declares its qualified rate reference and evidence requirements. No absent section, category or evidence requirement receives a default.

The proposed support evidence is existing immutable VAT fact revisions, named explicitly by the selection. The application must verify book scope, source evidence, tax point, exact reviewed source amounts, domestic-purchase classification, confirmed domestic eligibility and confirmed full deduction with retained review/deduction evidence. Mutable fact heads and a supplier address cannot establish entitlement. Revision IDs and digests are retained, not just current fact IDs. Withdrawal or invalid linkage must refuse an opt-in resolution.

The server-generated resolution witness pins category ID/schema, resolver version, retained tax point, selected rule release ID/content checksum, exact resolved rate/deduction and support revision IDs/digests. Clients cannot invent this witness. An exact-rate or deduction mismatch refuses preparation; the resolver never replaces the human's exact treatment. Approval binds the resulting review digest. Execution reads the sealed treatment/witness and does not choose a newer category or rate. Any required current-authority check may refuse, but must not reinterpret the sealed numbers.

The exporter and suggestion evidence can carry only categories/witnesses actually stored with the treatment. Historical rate-only records remain category-unknown. Consequence projection may pin the stored category/resolution identity while historical statement mapping, period bounds and dimension requirements remain unknown. This does not qualify autonomy or train a model.

Independent synthetic failure and boundary expectations, written before implementation:

- A legacy rate-only supplier review/approval retains its exact values and has no invented category or resolution.
- Two explicitly admitted synthetic releases meet at a date boundary: one category resolves the first release's rate before the boundary and the second release's rate on/after it. Preparation with the opposite exact rate refuses. Source amounts remain exact.
- Missing admitted VAT profile, missing purchase section, unknown category, missing/foreign/withdrawn support revision, unsupported entitlement and mismatched source/tax point refuse opt-in preparation without retaining a review.
- A partial-deduction or representation selection cannot become ordinary/full deduction because its amount happens to match.
- A client-authored resolution witness is refused; returned witnesses must identify the actual selected immutable release and support revision digests.
- A newly activated release after approval cannot change the sealed category, rate, witness or posted result. Replay retains the same review/receipt.
- Real HTTP export of a stored category includes that category and exact witness; a legacy treatment remains unknown. Payroll/employee privacy boundaries remain intact.

Verification uses public supplier-review/profile/VAT-fact operations and isolated synthetic material, with repeatable artifacts. There is no new production release, legal-source qualification, provider, training, UI or MCP catalog flow. The existing VAT owner and release authority are reused rather than adding another tax registry.

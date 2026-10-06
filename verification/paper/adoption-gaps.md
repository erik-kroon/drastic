# Live Paper adoption gaps

Reference: Enthusiastic lantern, live JSX read on 2026-10-04, token hash `831a6b71`. This is an implementation ledger, not design approval or a declaration of pixel parity. Historical screenshots are not visual references.

| Surface | Implemented and observed | Remaining work |
| --- | --- | --- |
| Shared registers | 224px sidebar, 48px header, 47px tabs; 340px sales and 420px To do previews. Touch rows retain 44px targets. | Dense/long-name stress, 200% zoom, keyboard paths and every register must be reviewed. |
| Sales invoices | Retained draft selection and amounts; server-calculated draft lines and VAT in the preview; existing invoice editor and issue/payment owners retained. | Issued preview line sources, due-date/status lanes, toolbar coverage totals, invoice document and editor states. |
| Customers/suppliers | Directory selection, server search, creation and focus return observed in the prior pass. | Recheck against current live frames after shared header changes; defaults, archive, failure and long-record states. |
| Articles | Main-surface register, fixed 90/80/120px unit/VAT/price lanes; 520px dialog at top 90px with 32px fields. Real create, edit reopening, Escape/focus and 390px layout observed. | Article contract has no revenue-account field. Preserve code, reviewed policy and archive controls; do not infer an account. Long descriptions and revision failure remain to verify. |
| Quotes/orders | Main-surface register, source chooser, real create and acceptance observed. Line inputs now belong to the submitting form. Retained totals remain server-owned. | Current contract has no quote number, quote validity or delivery status. Creation still depends on a retained draft. Review detail, revision and partial-conversion layouts and recovery states. |
| Recurring | Real paginated agreement list; empty state replaces disabled-query loading; retained recovery route remains reachable. | List does not include current template totals or scheduling dates. Full preview, creation/edit/pause/stop and history design adoption remain open. |
| Purchases | Existing register and real supplier/draft owners retained. Live reference confirms 400px preview. | Posted journal preview, payment actions, due/status lanes, draft/upload/duplicate/payment-file states. |
| To do | Existing attention sources and original-document owner retained; preview width corrected. | 130px status lane, proposal lines, focused review, VAT exception, approver/return/search states. |
| Bank | Existing real bank and matching owners retained. | Live frame comparison and register/detail/state adoption pending. |
| Documents | Existing real inbox and document owners retained. | Live frame comparison, original preview, upload and preparation states pending. |
| Bookkeeping | Supported inline navigation retained. | Main journal, detail, entry/correction, chart and subledger frame comparison pending. |
| Reports | Plain catalog with nine implemented destinations; navigation retained. | Individual report geometry, columns, totals and failure states pending. |
| Closing | Period list and 420px readiness panel; real incomplete-readiness block observed. | Current frame recheck, complete/error/stale states and evidence/history layouts. |
| Settings | 200px local navigation; existing company/accounting/tax owners retained. | Current frame recheck and each form/modal/state adoption. |
| Overview | Two-column composition uses retained financial sources. | Current chart and activity sources, source/unknown/rest states and exact geometry pending. |
| Account/setup/bureau | Existing routes remain available. | Inventory current frames against existing owners and implement applicable screens. |

An absent financial fact must remain absent. A passing changed-file gate proves source checks; it does not close any visual or workflow obligation above.

## Parity blockers recorded 2026-10-04 (sales screens)

These keep the sales parity entries failing. Each needs a product or contract decision, not a styling change.

- **Missing tabs:** the design has Inkommande order (M15) and ROT och RUT (M11) in the Försäljning tab row. The app has no view for either, so a tab would be dead. The app also has Krav (collections), which no frame shows.
- **Articles, Intäktskonto:** M5 shows an Intäktskonto column (3041). `Catalog.SaveArticle` carries no revenue account, so the value cannot be shown without inventing a financial fact. Needs a contract field with a reviewed source.
- **Invoice register, M1:** the design groups rows by state (Förfallna, Skickade, Utkast, Betalda), shows invoice numbers, a Period and Status filter row, Öppna fordringar, and a preview with Registrera betalning and Ladda ner PDF. The app register is a flat list. The disposable seed also has only draft invoices, with no issued or paid ones.
- **Sidebar count:** Att göra shows the number of open attention items. The canonical fixture expects 7; the disposable seed produces fewer.
- **Customers, M3:** the register shows Öppet and Fakturerat i år per customer, and the detail shows organisationsnummer, betalningsvillkor, momsnummer status, a Fakturor list, Ny faktura till kunden, Redigera uppgifter and Visa kontoutdrag. No contract returns per-customer open or billed totals; joining the sales register by display name would be unreliable. Needs a customer summary read from the receivables owner.
- **Quotes and orders, M12:** the design shows quote numbers (O-2026-0005), Giltig till, a sent state (Skickad 25 sep) and Förfallen. `SalesDocument` has only kind, state (draft, accepted, cancelled) and revision. Needs numbering, validity and a sent state in the sales-documents owner.
- **PDF:** M1's preview shows Ladda ner PDF. The app has no invoice PDF download ("pdfNotAvailable"), so the link is omitted.
- **Invoice register toolbar:** the frame has Period and Status chips and no search or sort. The register now shows only a Status chip (functional) and the Öppna fordringar sum. Search and sort remain supported through the URL (`q`, `sort`) but have no visible control; the Period chip is omitted because the register read has no period filter.

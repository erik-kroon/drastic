# Correction presentation and recovery failure contract

The real financial journey is `tests/browser/posting-correction-recovery.e2e.ts`. The isolated board proves only the production presentation and native rendering. It uses its own synthetic book and cannot execute a correction.

| Failure | Required result |
| --- | --- |
| Bundle, impact, book, selected original or child digest does not match the entry | Refuse financial actions and retain the original. |
| Selected original is absent from the retained chain | Refuse the read rather than replacing missing values with zero. |
| Currency scale is absent or metadata cannot be read | Show unknown amounts and refuse approval. |
| Bundle or impact refetch fails while cached data exists | Refuse approval until a successful authoritative refresh. |
| Read or write authority is denied | Refuse financial actions and expose the actual denial. |
| Approval or execution response is lost | Retain the exact request key and approval witness; recover the server receipt without duplicate posting. |
| Basis changes after preparation | Hide approval; compare the frozen/current witnesses and prepare a new immutable impact and bundle. |
| Manual, schedule, period or account basis changes | Show the actual blocker or neutral basis change; do not invent an invoice allocation cause. |
| Another correction wins | Retain the original voucher snapshot; do not claim that the economic chain or competing postings are unchanged. |
| A target period becomes locked | Expose the separate closing workflow using current blockers. |
| A period is locked but no represented filing evidence exists | Show period policy only; do not assert an existing filed return, acknowledgement or VAT approval workflow. |
| Optional display evidence has a different original/digest | Ignore it. Names, dates, counts and reserved labels are shown only when explicitly represented. Financial amounts come from the retained/current owner records. |
| A visual fixture represents a filed VAT policy | Keep it read-only and explicitly synthetic; it cannot establish a live filing owner, submission or created impact case. |
| A baseline is not a true 1440 × 900 PNG | Stop before rendering. |
| Inter does not load, rendering raises an error or a nonlocal request occurs | Fail the comparison. |
| Pixel difference exceeds the existing 1% gate at channel tolerance 24 | Keep a failed report, actual image and diff; do not weaken the gate or replace the baseline. |
| Source changes while qualifying | Repeat from a fixed source snapshot and retain the source hashes with the new proof. |
| Original selection or replacement form resolves the wrong voucher, account, period, date or amounts | Read the stored public bundle/impact and require the exact selected original, 7,000 minor-unit replacement and matching witnesses. |
| Reviewing effects or sealing a draft posts ledger entries early | Ledger remains identical before single aggregate approval and execution. |
| Impact confirmation is skipped or the reviewed draft remains editable | Sealing stays disabled before confirmation; frozen draft fields refuse editing after impact review. |
| UI preparation fails to reach the canonical owner or loses return context | Require the bookkeeping correction route with stored bundle/digest and original work context. |

A Paper example is not an application ownership decision. The source displays future voucher labels and actor events which currently have no live correction metadata owner. Q46 also depicts a filed VAT return and impact-case workflow whose live application owner remains unresolved. Passing the component board would verify the represented presentation, not those absent owners.

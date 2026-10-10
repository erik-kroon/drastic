# Document source review and recovery

Owner: Erik Kroon. DRA-194 qualifies current public application owners; DRA-97 owns original-evidence acceptance beside treatments and bank matches, and DRA-103 owns the complete document-to-posting journey. Prior accepted slices remain accepted. Owner-paused checks remain paused.

## Current screen contract

The audience is the existing synthetic bureau operator. K-11 owns `/entities/$entityId/books/$bookId/reviews/$planId/$revision`, composed by `ReviewScreen`, `ReviewOwner` and `SupplierFocusedReview`. `EvidenceInspector` resolves the sealed evidence reference and `OriginalDocument` resolves its scoped retained occurrence. K-15 owns recovery on the work route; K-16 owns posted records on the books route. Adoption and immutable references are recorded in `verification/paper/kanon-manifest.json`.

The source of behavior is the current supplier acceptance, source retention and posting recovery applications. Authority, exact approval binding, stored amounts, atomic receipts and immutable posted history remain frozen. A read failure must not fabricate an original, approve automatically, post automatically or replace a sealed reference with a newer draft.

Populated, selected and stale reviews, failed reads, unknown outcomes and posted receipts apply. Loading is a read transition. An absent original is an error on an existing review, distinct from an empty queue, an unreadable PDF, a changed draft or an interrupted HTTP response. Missing error-state visual adoption and baseline states remain explicit; they do not justify changing the approved comparison policy.

## Archived obligation reconciliation

The P1–P13 labels below are provenance for behavior. Deleted page 05 screens are superseded as visual targets by page 00. No archived screenshot is a current design or product-policy source.

| Historical area | Current application owner | Disposition |
| --- | --- | --- |
| P1 archive | `document-inbox.tsx`, purchases documents view | Retain scoped originals and acquisition identity; archive layout superseded. |
| P2 origin and original | `evidence-inspector.tsx`, `original-document.tsx` | Retain original identity, hash, page continuity and recovery beside the proposed treatment; K-11. |
| P3 question history | `work-questions.tsx`, work-question application | Retain saved questions and replies; standalone history composition design-pending. |
| P4 agreement | Current retained occurrence and evidence owners | Retain supporting source identity; specialized agreement workflow design-pending. |
| P5 authority document | Current retained occurrence and evidence owners | Retain supporting source identity; no new statutory rules or submission authority. |
| P6 activity | Existing journal and posted-record history owners | Retain immutable receipts and traceability; specialized activity composition design-pending. |
| P7 choose source | `source-intake/workspace.tsx`, source retention | Retain explicit acquisition/source choice; no live provider qualification. |
| P8 document search | `document-inbox.tsx`, supplier inbox | Retain scoped query, selected occurrence and return context. |
| P9 no search results | Same inbox owner | Retain empty query state; no inferred absence outside declared coverage. |
| P10 upload and read failure | Source intake and `OriginalDocument` | Retain failed reads and retry, distinguish lost objects from unreadable documents. |
| P11 preview and replacement | Source retention, supplier draft revisions and acceptance | Retain frozen selected original; newer draft makes prior approval stale rather than silently replacing evidence. |
| P12 alternate question history | Existing work-question owner | Retain behavior with P3; alternate deleted layout superseded. |
| P13 interrupted upload | Source-retention recovery by original request key | Retain unknown-outcome recovery; successful source retention is not document approval or posted accounting. |

## Failure obligations before fixture changes

Use the disposable native filesystem object adapter, public API and real browser. Only the current launcher's synthetic retained object may be faulted. Validate its original bytes against the independent upload and SHA-256, move it to a backup, and always restore the exact file in `finally`. Never alter database evidence, sealed plans, approvals, receipts or ledger history.

1. A physically missing retained object returns `MissingEvidence`; the browser withholds its original preview and offers the existing retry.
2. Equal-length corrupt bytes also return `MissingEvidence`, never a substituted preview.
3. Neither failed read creates an approval, acceptance or ledger entry. The selected plan ID/digest and evidence reference remain unchanged.
4. Restoration followed by keyboard retry renders the same original; its public native read retains the independent bytes/hash.
5. A newer draft retains the old selected original while withholding stale approval. It remains excluded from actionable work.
6. Explicit approval and posting after recovery retain the original draft digest and exactly one posting receipt.
7. Reload, owner return context, two-page continuity and stored 1250000 minor-unit amount remain independently asserted.

The fixture qualifies local object loss and corruption, not external-provider reliability or optical accuracy. Missing-source approval policy beyond existing explicit acknowledgments requires an owner decision; no new financial guard is introduced here.

## Proof and remaining qualification

Reuse `tests/browser/supplier-frozen-original.e2e.ts` for retained/missing/corrupt/changed originals and explicit posting. `posting-supplier-expiry.e2e.ts` covers expiry, failed reads and one receipt after a lost response. `posting-recovery.e2e.ts` covers standalone unknown-outcome recovery. Document question and intelligence journeys retain their separate reading/highlight obligations.

Run each targeted browser recipe sequentially through `bun run test:browser`. Keep full-frame K-11/K-15/K-16 measurements separate from behavior receipts, using approved references and unchanged tolerances. A measured drift is not parity completion. Native 200% zoom, reduced motion, cold-start performance and bank original acceptance remain linked obligations for DRA-106/DRA-97; existing historical outcomes do not qualify them on changed source.

Current DRA-194 local packet: `verification/paper/evidence/k11-core-finish/original-recovery.json` records physical missing/corrupt refusals, exact-byte restoration, keyboard retries, unchanged approval/ledger, changed-draft exclusion and one native posting receipt. The selected books-route voucher preserves both signed 1250000 minor-unit lines, the uploaded original and the immutable record after reload.

Current full-frame measurements remain drifts: K-11 27.1391% and K-16 8.1167%, both above the adopted 2% tolerance. K-15 retains its existing independent unknown-outcome packet. K-11's illustrated combined approve/post, return and rejection actions have no corresponding adopted supplier operation. K-16's payment, activity and next-task composition is not qualified by the voucher-only fixture. These gaps remain separate from successful source recovery; no `matches` or complete screen-family acceptance is claimed.

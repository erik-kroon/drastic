# Credit-note PDF artifacts

## Scope and ownership

The [credit document owner](../src/application/commerce/credit-documents.ts) renders an already issued `CustomerCreditSemanticDocument`. It copies retained parties, dates, references and amounts. It does not calculate VAT, issue another number, post, refund or send a document.

The PDF profile is `openerp-se-credit-note-pdfcn-v1`: Swedish SEK, scale 2, up to 50 retained lines and a 2 MiB artifact. The [pdfcn presentation](../src/application/commerce/credit-document-renderer.tsx) composes the same pinned, adapted components as legal invoices, rendered by Takumi with bundled font coverage and a fixed Drastic theme. All amount formatting uses the retained minor-unit strings. Unsupported characters cause a visible failure; they are not replaced or removed. Migration [0042](../migrations/0042-pdfcn-renderer.sql) updates the renderer constraint for this direct replacement of the synthetic setup; the owner confirmed there are no existing customer artifacts or real database to migrate. The adoption record distinguishes implementation from verification.

The immutable credit receipt keeps its issue-time `artifactState: issued_artifact_pending`. Read the separate artifact view for current state. `available` means that verified bytes are retained, not that a customer received them or that a VAT return includes the credit.

## Public operations

All paths start with `/api/v1/entities/:entityId/books/:bookId/commerce`.

| Method and path                            | Result                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `GET /customer-credit-notes/:id/artifact`  | Frozen document, current `pending`, `rendering_failed` or `available` state, descriptor and last failure.      |
| `POST /customer-credit-notes/:id/artifact` | Render or recover the exact artifact. Send an idempotency key, `expectedDocumentDigest` and `rendererVersion`. |
| `GET /customer-credit-artifacts/:id`       | Descriptor and base64 PDF bytes. Verify `byteLength` and the bare hexadecimal `sha256`.                        |

The shared capability catalog exposes the same scoped operations. Rendering is preparation, not human approval. Every read and write resolves current book authority. A changed body under a completed command key conflicts.

## Rendering and recovery

1. Under the book lock, recover the command or load its immutable document and outbox intent. Check document identity, revision, digest and renderer version.
2. Render outside the database transaction. The wait is bounded to 15 seconds.
3. In a new transaction, recheck authority and the retained document. Insert the artifact and acknowledge its outbox intent together. Save the command result.
4. On retry, return the retained descriptor and bytes. Never repeat financial issuance.

The artifact key permits one result per book/document/revision/renderer. Migration [0022](../migrations/0022-credit-document-artifacts.sql) binds the exact source revision with a foreign key and checks PDF size, prefix and content hash. Artifact and failure rows are immutable. Runtime writes are limited to inserts and the outbox's `delivered_at`/`attempts` columns.

Here, outbox `delivered_at` means the render intent was processed. Customer delivery remains `false`. A later failed attempt cannot replace an available artifact. The view can retain an earlier failure beside an available artifact; `state` is the current outcome.

## Bun consumer

The existing preparation runner includes `CreditDocumentQueue`. It reads pending render intents for books accessible to its current credential, then enqueues a deterministic job keyed by book and outbox ID. effect-mq owns claims, leases and five bounded retries. The application bounds recorded failures to 20 per document/renderer.

Set `DATABASE_URL` and `OPENERP_PREPARATION_TOKEN`, then run `bun run --cwd apps/api jobs:preparation`. A committed intent remains discoverable while the runner is offline. Operators or agents with current book access can also call the same rendering operation through HTTP/MCP. An immutable document that exceeds this renderer's supported profile needs a qualified renderer change, not another credit or edited source facts.

## Verification

The authorized E2E case creates an isolated synthetic book and three human identities. It records and reviews the existing bounded seller policy, activates its accounting profile, and issues an original invoice and three credits through public APIs. No financial rows are seeded directly in SQL.

Observed results:

- Original receivable: `12500` minor units. Credits: `2500`, `1250`, `1250`. Remaining receivable: `7500`.
- Fresh rendering succeeds in workerd and through the real Bun/effect-mq consumer.
- Changing the current customer name does not alter the retained credit's party details.
- A wrong document digest and another book refuse access or binding.
- An injected outbox-acknowledgment fault rolls back artifact insertion. Failure state remains visible, and the same command key succeeds after the fault is removed.
- Unsupported glyphs remain a failed render with no artifact. The issued credit remains intact.
- Replay returns the same artifact. Changed input conflicts. Rendering changes no journal, numbering, approval consumption or original financial receipt.

Run `bun run test:e2e`. Inspect `test-results/e2e/credit-document-journey.json`, `customer-credit.pdf`, `credit-render-runner.log`, the source manifest, source-integrity result and suite results. The PDF's extracted text was also checked for the original reference, frozen parties and `20,00` net / `5,00` VAT / `25,00` credited total.

This is synthetic workflow and artifact evidence. It is not actual-company qualification, a VAT-return consequence, customer delivery, refund or statutory acceptance. No dedicated browser credit workflow was added by this packet.

Historical planning links and captures omitted from this source distribution remain in the private working archive.

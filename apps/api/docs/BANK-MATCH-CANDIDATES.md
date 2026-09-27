# Bank matching candidates

## Ownership and API

The [application owner](../src/application/banking/candidates.ts) reads a bank row and its possible posted-line matches. [Database queries](../src/db/banking/candidates.ts) run in the caller's transaction. PostgreSQL does not own the discovery workflow.

| Surface | Contract                                                                     |
| ------- | ---------------------------------------------------------------------------- |
| REST    | `POST /api/v1/entities/:entityId/books/:bookId/bank-match-candidates`        |
| MCP     | `bank_discover_match_candidates`, with `{scope, input}`                      |
| Input   | `statementId`, `rowOrdinal`, optional `previousDigest`                       |
| Output  | `BankMatchCandidates` from `packages/contracts/src/bank-match-candidates.ts` |

This POST is read-only. It creates no plan, match, approval, receipt or posting. Scope admission happens before source lookup. The released profile is `synthetic-core-v1` with native writer authority.

## Scope and eligibility

The retained statement defines the account and date interval. Discovery includes every posted line in that scope at the committed sequence, including blocked lines. It refuses more than 1000 lines, 1000 periods or 50 invoice-allocation reference records for one line. It does not truncate a complete-looking result.

Original signed amount minus active matching/allocation capacity gives the remaining amount. Account activity, currency, direction, remaining capacity, reversal state and open periods still govern eligibility. A reference match cannot override them. Blocked candidates remain visible.

The book read barrier covers the source, capacities, references, periods and cutoff. The digest includes those facts and the ordered candidates. `previousDigestMatches` compares observations; it does not reserve capacity. The matching or allocation owner must recheck current state before a write.

## Reference evidence

A retained statement row can carry `paymentReference`:

```json
{
  "kind": "invoice_document_number",
  "issuerNamespace": "entity",
  "issuerId": "entity_example",
  "value": "SYN-1",
  "sourceField": "dedicated_reference"
}
```

The imported evidence must contain the same reference. An altered command does not match the retained source digest. `providerId` remains the provider's transaction ID; it is not an invoice reference.

The current comparison follows an **active commerce allocation** from a payment voucher to its issued synthetic invoice. It reads the retained `internalDocumentNumber` used by the invoice renderer. Each reference records its issuer, invoice, document revision/digest and allocation receipt. Its basis is voucher-level allocation evidence, not proof that a particular bank line belongs to that invoice.

Comparison requires a dedicated invoice-number field and the current book entity as issuer. It uses exact values. It does not remove punctuation, spaces or leading zeros. Free text, OCR, another issuer and payments without a supported issued-document relationship remain non-comparable. OCR generation, legal-invoice/provider qualification and unpaid-invoice candidate discovery are outside this profile.

Each candidate reports `referenceComparison` as `match`, `mismatch` or `unavailable`, with its retained `referenceEvidence`. More than one related invoice remains visible. Reference evidence never sets `identityEstablished` or source coverage to true.

## Ranking and review

`retained_then_reference_amount_date_v2` orders candidates by:

1. Eligible before blocked.
2. Retained source/line relationship history.
3. Exact comparable invoice reference.
4. Statement-evidence citation.
5. Equal remaining amount, then amount distance and date distance.
6. Voucher and line IDs for stable ties.

This is a review heuristic, not a probability or automatic selection. An old relationship may have been undone because it was wrong. A statement citation identifies a document, not its individual row.

The existing UI shows the comparison, source reference and retained document identity. It resets local selection on refresh and disables selection during a failed or pending read. The reviewed bank-allocation flow retains approval and execution authority. There is no new solver, money library or automatic posting path.

## Verification

The authorized E2E journey in `apps/api/tests/bank-references.e2e.test.ts` uses real HTTP operations against workerd and PostgreSQL. It creates payments, issues synthetic invoices, renders an invoice document, applies commerce allocations, imports source evidence, discovers candidates and matches bank rows.

It checks equal amounts with different references; free text/provider-ID confusion; issuer/type mismatches; punctuation and leading zeros; unsupported currency; opposite direction; cross-book refusal; read-only discovery; capacity after matching; concurrent replay; changed-input conflict; and duplicate use of a bank line.

Run `bun run test:e2e`. Inspect `test-results/e2e/bank-reference-journey.json` with `manifest.json`, `source-integrity.json` and `results.json`. The journey artifact retains the rendered document, issue/allocation receipts, source import, comparisons and match receipts. The runner preserves prior local runs under `test-results/e2e-history`.

The observed scope is synthetic HTTP behavior. Browser interaction, a live bank feed, OCR and actual-company acceptance remain separate qualification work. The old SQL dispatcher and migration-1600 instructions are superseded; Git history retains them.

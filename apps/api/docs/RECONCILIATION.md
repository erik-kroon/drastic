# Synthetic bank reconciliation

## Current ownership

Application operations live in [application/banking/reconciliations.ts](../src/application/banking/reconciliations.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

Status: implemented for `synthetic-core-v1`; manually exercised through the local Worker and restricted PostgreSQL runtime; no automated verification was performed. This module does not import arbitrary bank CSV, infer tax treatment, certify a real period, or post journals.

```text
Retained JSON evidence → immutable statement + every source row
                                      ↓ explicit one-row/one-line match
                         existing posted bank journal line
                                      ↓
                     immutable account/interval reconciliation
```

### Input and identity

Retain the complete `StatementSource` JSON as `application/json` evidence first. Import the same fields with `evidenceId` and `existingMatches`. PostgreSQL compares the retained JSON to the input after removing those two fields. Whitespace and object key order do not matter; array order and values do. Evidence size limits still apply.

- Amounts are canonical signed integer strings in book-currency minor units. Positive means debit to the selected bank asset account; negative means credit. Each source amount and balance has at most 38 digits. Report sums are not restricted to 38 digits.
- The source must explicitly say `synthetic_bank_statement_v1`. The book must have native writer authority and the `synthetic-core-v1` profile. This is not a profile or tax bypass.
- The account must be active, belong to the book, and use the book currency. A source bank account maps to exactly one ledger account, and a ledger account maps to one source bank account in this slice.
- `startsOn` and `endsOn` are inclusive calendar dates. Every observed row must fall inside that interval. Opening balance plus the sum of **all** rows must equal closing balance exactly.
- `completeness.declaredComplete` and `completeness.basis` retain the source coverage assertion. The declaration concerns only this bank source and interval. It is not independent proof that all company accounts or invoices have been supplied.
- Statement identity is `(book, sourceBankAccountId, statementIdentifier)`. Reimporting identical input converges even with a new command key. Changing that identity's content or initial match list conflicts.
- Observation identity is retained evidence plus row ordinal, with a unique source-account/provider ID when supplied. Ordinals must be unique integers from 1 to 10000; they need not be contiguous. `providerId` is explicitly `null` when absent.
- Equal dates, descriptions and amounts never collapse distinct rows. Duplicate ordinals/provider IDs reject the entire import. Overlapping statements reject atomically; multiplicity-aware overlap resolution is not implemented. No rows are silently dropped.

Synchronous reconciliation accepts at most 1,000 combined selected source/ledger rows and 100 statements. Larger selections reject without storing a partial report. Select a smaller whole-statement interval; durable large-scope reconciliation is not implemented. Full exact totals still cover the entire accepted selection.

### Existing and explicit matches

`existingMatches` imports supplied relationships; it does not rediscover them. A later `BankMatchInput` can connect a statement row to `voucherId` and `lineId`. Both paths use the same database guard:

1. The row and posted line exist in the authorized book.
2. The line uses the mapped account and has exactly the same signed amount.
3. The posting date lies inside the statement interval.
4. Neither endpoint already consumes another endpoint.

One row consumes one whole line. Repeating the same match does not consume capacity again or change its original provenance. Splits, partial allocations, cross-interval timing matches, rematching and automated matching are unsupported and reject. A match does not add another ledger posting. The source of the relationship (`imported` or `explicit`) and actor remain immutable.

### Reconciliation and freshness

`ReconcileBank` selects one book account and inclusive interval. An interval that cuts through a retained statement rejects: deriving a partial external checkpoint is unsupported. The report keeps all selected statements, source observations, posted interval lines and matches, not only totals. Ledger opening includes every prior posted line; ledger closing includes all posted lines through `endsOn`, including originals and reversals.

| Status                    | Meaning                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `complete`                | Contiguous declared-complete source coverage covers exactly the requested interval; statement boundary balances agree; bank and ledger opening/closing agree; every row and line has an exact match. |
| `balanced_but_incomplete` | Balances and matches agree, but a source declaration or interval coverage is incomplete.                                                                                                             |
| `differences`             | External balances are absent, checkpoint balances differ, adjacent statement balances differ, or a source row/ledger line is unmatched. Coverage gaps remain visible too.                            |

Difference signs are **bank minus ledger**. Missing external checkpoints are `null`, not zero. The report separately exposes `sourceCoverageComplete`, coverage gaps, unresolved differences and both unmatched collections. A net-zero unmatched pair is still unresolved.

A report is append-only. It pins the book sequence, account-scoped source collection revision, account ledger sequence, receipt, creation time and materialized input set. Replaying the command returns the original report; it does not refresh it under an old key. `getBankReconciliation` returns that immutable report plus a current freshness envelope.

- Adding a statement or match advances `bank_sources.revision` for that book/account. Identical statement/match replay does not advance it.
- A later line on this account dated on or before the report end changes `accountLedgerSequence` and makes the report stale.
- Unrelated account postings and later-dated postings do not make this account/interval report stale. A new source statement on this account does invalidate it, even outside its interval: source collection revisions are deliberately account-scoped.
- A different currency or a currently unsupported profile/writer authority also prevents a fresh result.
- Reconciliation does not alter journal proposal dependencies or consume an approval. `complete` is never a whole-period close certificate.

### API and adapter integration

All routes use the existing `/api/v1/entities/:entityId/books/:bookId` prefix and normal authenticated session/Bearer boundary. Mutations require `Idempotency-Key`.

| Handler / fixed adapter operation | Route                           | PostgreSQL function                                |
| --------------------------------- | ------------------------------- | -------------------------------------------------- |
| `importBankStatement`             | `POST /bank-statements`         | `import_bank_statement(token, scope, key, input)`  |
| `getBankStatement`                | `GET /bank-statements/:id`      | `get_bank_statement(token, scope, id)`             |
| `matchBankObservation`            | `POST /bank-matches`            | `match_bank_observation(token, scope, key, input)` |
| `reconcileBank`                   | `POST /bank-reconciliations`    | `reconcile_bank(token, scope, key, input)`         |
| `getBankReconciliation`           | `GET /bank-reconciliations/:id` | `get_bank_reconciliation(token, scope, id)`        |

The contracts export is `@open-erp/contracts/reconciliation`. `ReconciliationApi` is part of `Api`; `ReconciliationHandlers` uses the same `capabilities` handlers as MCP. Fixed statements are registered in `database.ts`. The existing scoped `pg` adapter remains the only connection owner. No new driver or client lifetime is introduced.

The functions authorize token/entity/book scope, acquire the book lock, then check/replay the persistent command identity before mutation. Receipt and source/report writes commit together. A replay after a lost response returns the same saved result. Reusing a key for changed content fails `IdempotencyConflict`. Unsupported shapes, ambiguous overlap and capacity violations fail `InvalidJournal`; missing retained content fails `MissingEvidence`. These use the existing safe `AccountingError` wire contract. Intentional domain failures expose their controlled rejection message. Unexpected SQL and connection failures remain generic.

Migration `0100-bank-reconciliation.sql` owns `bank_sources`, `bank_statements`, `bank_observations`, `bank_matches`, and `bank_reconciliations`. Runtime has no direct table privileges or helper-function execution. Only scoped security-definer command/read functions are granted, each with a protected search path. Imported matches and explicit matches are ordinary scoped bookkeeping records, not posting, payment, tax or close authority.

### Verification boundary

No tests or fixtures were added, and no deployment was run. Existing TypeScript/lint checks can check contracts and handlers; they do not prove PostgreSQL behavior. Before making a verified G2 claim, an approved E2E run must cover equal legitimate rows, existing matches, exact sums, scope rejection, overlap/split rejection, command replay/conflict, capacity conservation, incomplete-but-balanced coverage, gaps, immutable report replay, and freshness after relevant versus unrelated changes. Retain the run's inputs, report and receipts as repeatable evidence.

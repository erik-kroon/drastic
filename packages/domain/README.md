# Accounting domain

Shared Effect Schema definitions for accounting values, exact money, ledger records, books and errors. This package has no HTTP, database, browser, provider or jurisdiction dependency.

Use the explicit `values`, `money`, `ledger`, `books` and `errors` exports. The API contracts re-export the existing accounting names from these definitions so current callers use the same schema instances and error class.

These are the existing model and validation rules, extracted without changing monetary bounds, paired debit/credit amounts, canonicalization versions or stored-record meanings. PostgreSQL remains the authority for posting and financial invariants; this package is not a second posting engine.

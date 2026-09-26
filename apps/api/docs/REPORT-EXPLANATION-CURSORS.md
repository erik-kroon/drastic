#5800 report explanation continuation

## Current ownership

Application operations live in [application/reports.ts](../src/application/reports.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Failure contract — before code

0120 explanation accepts unbound sequence:ordinal positions. A cursor from another account
or an unobserved position can skip retained contributions and return an empty final page.
3400's separate general-ledger cursor does not protect this explanation endpoint.

- Authorize the current book before reading the retained report/account or cursor anchor.
- Bind continuation to exact report ID and account ID. The position must name a real included
  contribution at the saved cutoff, including opening rows before the report start.
- Bound syntax before numeric casts; catch bigint/integer overflow and refuse malformed,
  zero/negative, cross-context, nonexistent, excluded-after-end and after-cutoff anchors.
- Reject the earlier unbound two-part cursor as malformed. Omit `after` to start from page1.
- Preserve report headers, labels, cutoff, formula, totals, exact amounts, evidence and all
  original/reversal contributions. Keep100-row sequence/ordinal order and page1 behavior.
- Change only explanation SQL and its local cursor input/output schema. General-ledger,
  comparison and line-list cursors, shared route/binding signatures and UI remain unchanged.
- No new artifact, calculation, policy, tests, runtime/SQL execution, provider or VCS action.

### Implemented source

`5800-report-explanation-cursors.sql` forward-replaces only `explain_report_line`.
New `next` values are `reportId:accountId:sequence:ordinal`. The owner authorizes through
existing `get_report`, selects the saved account, checks a maximum288-character cursor and
bounded syntax, checks report/account identity, catches numeric overflow, then verifies an
actual contribution within the frozen sequence and end date. It intentionally has no report
start-date lower bound: opening contributions remain valid continuation anchors.

The local `ExplanationCursor` schema constrains only `ExplanationQuery.after` and
`ReportExplanation.next`. SQL rejects the earlier two-part format through the same bounded
syntax check as other malformed cursors. Omit `after` to start again; saved reports remain
readable without rewriting their header, rows or digest. No deployed old client is assumed.

The original page selection, full contribution count, formula and output data are unchanged.
Later/backdated postings beyond the saved sequence cannot enter. Reversals remain separate
signed contributions. End-date exclusions cannot serve as anchors. Exactly100 final rows still
return null continuation; zero-contribution accounts retain their empty first page.

General-ledger, comparison and line-list cursor definitions are untouched. Existing REST/MCP
operation names, route signatures and database parameter order are unchanged. No common
composition change or UI edit is needed.

### Source checks

Compared the forward owner with0120: only continuation validation and emission changed.
Reviewed valid opening/movement anchors, cross-report/account reuse, missing/wrong ordinal,
excluded-after-end and after-cutoff rows, numeric overflow, two-part cursor refusal, later postings,
empty pages and last-page semantics. These are source checks, not executed cases.

Reports contract Oxlint, owned Oxfmt and `git diff --check` passed. Shared type checks and peer
review remain root-owned. No tests, runtime/SQL execution, providers or VCS history action.

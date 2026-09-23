#5800 report explanation continuation

## Failure contract — before code

0120 explanation accepts unbound sequence:ordinal positions. A cursor from another account
or an unobserved position can skip retained contributions and return an empty final page.
3400's separate general-ledger cursor does not protect this explanation endpoint.

- Authorize the current book before reading the retained report/account or cursor anchor.
- Bind continuation to exact report ID and account ID. The position must name a real included
  contribution at the saved cutoff, including opening rows before the report start.
- Bound syntax before numeric casts; catch bigint/integer overflow and refuse malformed,
  zero/negative, cross-context, nonexistent, excluded-after-end and after-cutoff anchors.
- Reject legacy two-part continuation explicitly. Restart from page1; do not reinterpret an
  unbound legacy position or mutate/backfill an old report to accommodate it.
- Preserve report headers, labels, cutoff, formula, totals, exact amounts, evidence and all
  original/reversal contributions. Keep100-row sequence/ordinal order and page1 behavior.
- Change only explanation SQL and its local cursor input/output schema. General-ledger,
  comparison and line-list cursors, shared route/binding signatures and UI remain unchanged.
- No new artifact, calculation, policy, tests, runtime/SQL execution, provider or VCS action.

## Implemented source

`5800-report-explanation-cursors.sql` forward-replaces only `explain_report_line`.
New `next` values are `reportId:accountId:sequence:ordinal`. The owner authorizes through
existing `get_report`, selects the saved account, checks a maximum288-character cursor and
bounded syntax, checks report/account identity, catches numeric overflow, then verifies an
actual contribution within the frozen sequence and end date. It intentionally has no report
start-date lower bound: opening contributions remain valid continuation anchors.

The local `ExplanationCursor` schema constrains only `ExplanationQuery.after` and
`ReportExplanation.next`. Its validation message explicitly tells legacy-cursor callers to
restart from the first page. SQL independently rejects legacy two-part cursors with the same
restart instruction. No legacy continuation is silently accepted. Omit `after` to start again;
every existing saved report remains readable without rewriting its header, rows or digest.
Clients that validate the old two-part cursor schema must update their shared contracts (or
reload the updated web client) before continuing. A first-page restart does not make an old
client-side schema accept the new cursor format.

The original page selection, full contribution count, formula and output data are unchanged.
Later/backdated postings beyond the saved sequence cannot enter. Reversals remain separate
signed contributions. End-date exclusions cannot serve as anchors. Exactly100 final rows still
return null continuation; zero-contribution accounts retain their empty first page.

General-ledger, comparison and line-list cursor definitions are untouched. Existing REST/MCP
operation names, route signatures and database parameter order are unchanged. No common
composition change or UI edit is needed.

## Source checks

Compared the forward owner with0120: only continuation validation and emission changed.
Reviewed valid opening/movement anchors, cross-report/account reuse, missing/wrong ordinal,
excluded-after-end and after-cutoff rows, numeric overflow, legacy refusal, later postings,
empty pages and last-page semantics. These are source checks, not executed cases.

Reports contract Oxlint, owned Oxfmt and `git diff --check` passed. Shared type checks and peer
review remain root-owned. No tests, runtime/SQL execution, providers or VCS history action.

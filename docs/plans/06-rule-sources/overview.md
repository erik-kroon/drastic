# 06 Rule sources

Status: plan approved by the owner, 2026-10-10. Not started. Conditional live public-source fetching approved on the same date.

## Context

Agents and people need to know which rule applied on a transaction's date, with a citation. The food VAT rate dropped from 12 to 6 per cent on 2026-04-01 until the end of 2027. A system without dated sources gets that wrong with confidence.

Drastic already pins versioned rule releases with primary-source metadata (`openerp.rule_releases`, `RulePrimarySource` in `contracts/company-profiles.ts:566-592`, DRA-73). Three things are missing:

- stored sources;
- search;
- any way to notice that a source changed.

Rule rows are operator-installed and the runtime can only read them (`migrations/0004-next-02.sql:169`). This plan keeps that boundary.

This plan is separate from [05 Accounting agent mode](../05-accounting-agent/overview.md). It has its own predicate and does not block month close. Treatments keep coming from reviewed rule releases (AUT-04), never from search results.

## Definition of done

Done means all of the following hold:

- The gold question set scores correctly on every date-boundary pair, including food VAT on 2026-03-31 against 2026-04-01.
- A fixture source that changes a rate on a boundary date yields exactly one proposed dossier.
- That change creates one Att göra item, only for books whose treatments use the affected rule.
- No query text leaves Drastic.
- Search latency stays under 100 ms on a generated corpus of the measured real size.

## Scope

Included:

- source snapshots and statute history from the first snapshot onwards;
- a deterministic citation graph and Swedish full-text search in PostgreSQL;
- lookup over HTTP and MCP;
- a change monitor that writes proposed dossiers;
- recomputing release checksums from a canonical body;
- a check that a release's reviewer is not its author.

Excluded:

- statutory qualification of any release;
- installing releases from the runtime;
- reduced-rate sales mappings until the VAT release schema allows several rates per treatment (`vat-filing-release.ts:135`);
- commentary from paid legal databases.

## Phases

1. [Point-in-time corpus](phase-01-corpus.md). L.
2. [Rule lookup](phase-02-lookup.md). M.
3. [Change monitor and dossiers](phase-03-monitor.md). M.

## Owner approval: public-source fetching, 2026-10-10

Approve scheduled fetching of public legal sources: Riksdagen open data, Skatteverket's public guidance and positions, BFN, domstol.se and EUR-Lex.

Conditions:

- The fetcher identifies itself, fetches at most once per second per host, at most daily, and honours each publisher's terms.
- It credits sources as Riksdagen requires.
- It stores the raw source with its hash, and records the reuse basis of each source.
- No paid databases.
- Fetching runs in the background runner, never in a user request.
- Tests use fixtures only.
- Fetched material can only propose rule changes. An operator installs them.

This records authorization to build the flow. No fetching schedule has been enabled by this documentation change.

## Implementation guidance

- **architect** for the corpus schema.
- **interrogate** for authority ranking.
- **unslop** for prose.
- Write the failure cases first, then E2E with retained artifacts.
- `test:mcp` and `test:mcp:eval` when the lookup capability lands.

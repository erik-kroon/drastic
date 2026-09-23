#5000 retained VAT fact lineage — pre-code failure contract

This packet extends existing `getVatFact` only. No new mutation, artifact family or legal
interpretation is authorized.4400 settlement policy remains deferred.

Failure contract:

- Authorize current book scope before lookup; select the exact stable fact ID. Cross-book
  records and evidence/amount coincidences cannot establish membership.
- Include saved included AND excluded assessments. Do not infer that membership requires
  legal amendment or proves filing, currentness, completeness or production treatment.
- Preserve saved v1/v2/v3 draft IDs/digests/engines, captured fact revision/digest, assessment
  state/blockers/contribution, and saved3300 amendment change flags/deltas. No recalculation.
- Preserve existing current/history/withdrawal fields and original source receipts unchanged.
  Additive lineage is an explicit identity/assessment allowlist, not a copy of command,
  approval or reviewer input payloads.
- Read under the existing book barrier. Enforce complete500-draft and500-amendment book
  inventory limits before projection. Enforce an8MiB complete canonical UTF-8 response bound;
  refuse rather than clip arrays or erase existing history to fit.
- Do not call live VAT basis/readiness/provider owners. Saved source/draft/amendment history
  remains meaningful even when current calculation eligibility is unavailable.
- New source reads do not write, approve, withdraw, settle or post anything. Historical bytes
  and exact-key mutation recovery remain owned by their unchanged original commands.

Pre-code shape inspection: saved draft v1/v2/v3 bodies retain `basis.facts[].fact` and
`calculation.assessments[]` in matching fact order, with each assessment also carrying factId
and sourceDigest.3300 saved amendment `impact.facts[]` retains exact factId, nullable original/
replacement revision+assessment sides, sourceChanged, assessmentChanged and contributionDelta.
Later3700/4500 comparisons accept newer engines without rewriting this saved impact shape.

## Implemented source

`5000-vat-fact-lineage.sql` forward-replaces only the existing `get_vat_fact` read owner and
adds its private immutable assessment allowlist helper.3700 and saved v1/v2/v3 drafts and
3300 amendment reviews remain unchanged. No route, capability key, query binding, mutation
or retained artifact family was added.

The existing `VatFactView` keeps `current`, `history` and `withdrawal` exactly as before and
adds `lineage`:

- `drafts`: exact saved membership by stable fact ID, with draft ID/digest, captured engine,
  interval/time, source revision ID/number/digest and saved assessment. Included, excluded,
  outside-interval, unsupported and withdrawn-at-capture assessments remain visible.
- `amendments`: existing review and draft-pair identities/digests, saved impact digest and
  that exact fact's saved original/replacement sides, change flags and contribution deltas.
  Missing sides remain null. No arithmetic or tax assessment is repeated.
- `interpretation:"retained_fact_membership"`, `currentnessChecked:false` and
  `legalObligationAssessed:false`. Membership does not say that a legal amendment is due,
  that a draft is current, or that anything was filed, paid, settled or complete.

The contract reuses the existing fact-impact row schema; it does not introduce a different
amendment interpretation. `getVatFact` remains the actual REST/MCP consumer. Its existing
history receipts keep their original behavior. New lineage summaries use explicit nested
allowlists and do not copy draft/amendment command receipts, approvals or reviewer input
payloads. Assessment projection keeps only known saved assessment/contribution fields.

### Exact selection and complete-read limits

Authorization precedes lookup. All rows are selected by the authorized book and exact stable
fact ID under the existing book read barrier. Evidence hashes, amounts and similarly named
facts do not establish membership. Saved assessment ordinal, fact ID and source digest are
cross-checked against the captured fact; duplicate membership or unsupported saved engine
refuses the entire response rather than silently dropping a draft. Amendment impact version
and unique per-review membership are also checked.

The complete book inventories must stay within500 drafts and500 amendments before either
projection is read. Both reference arrays are newest-retained-ordinal first. There is no
clipped page that could be mistaken for a complete lineage. After preserving existing source
history and assembling both arrays, the complete canonical UTF-8 response is bounded at8MiB.
Oversize output raises `UnsupportedProfile`; no original history or lineage entries are
removed to make the response fit.

No live VAT basis, source eligibility, tax-account, closing, external filing or provider
owner is evaluated. A later withdrawal or metadata change cannot rewrite the captured
assessment shown here. Independent currentness remains available through the existing
appropriate draft/review readers; this projection makes no currentness claim.

## Source review and checks

Reviewed saved1000/3700/4500 draft shapes and their ordinal/identity sealing checks,3300/4500
retained impact shapes, book-scoped source history and existing500/500 inventory bounds.
Reviewed included/excluded membership, introduced/missing impact sides, different revisions,
same-evidence/different-fact isolation, cross-book identity collisions, no-live-provider reads,
allowlist projection, duplicate/malformed membership refusal and full-response byte refusal.
These are source findings, not executed cases.

The VAT contract passed Oxlint with zero warnings/errors. Owned Oxfmt and `git diff --check`
passed. Shared type checks and independent review remain root-owned. No tests, fixtures,
runtime/SQL execution, migration application, provider calls or VCS changes occurred.

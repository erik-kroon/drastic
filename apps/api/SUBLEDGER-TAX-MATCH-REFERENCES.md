# Schedule basis tax-match references —5300

## Failure contract recorded before implementation

This is factual, non-authorizing live disclosure on the existing schedule read. It does not
establish exclusive ownership, financial capacity, account classification or a conflict.

- Current entity/book authorization and the existing shared book barrier precede disclosure.
  Unknown or foreign schedules still refuse through the existing schedule owner.
- Join only this schedule's retained basis lines to active tax-match reservations by exact book,
  voucher and line. Return exact match/event identities and the immutable match's saved digest.
  The same line ID on a different voucher or in a different book must not match.
- Preserve invalid-but-reserved relations. Active means the reservation exists, not that its
  private match view is usable. Unmatched history is not an active reference; a new reservation
  must disclose its new match identity and digest.
- At most20 retained basis lines and one active reservation per line bound the complete result.
  An unexpected basis-line overflow refuses rather than silently truncating. No basis or no
  active references yields an empty collection, not a completeness or compatibility claim.
- State roleCompatibility: not_assessed explicitly. Do not infer conflict, clearance, monetary
  consumption or eligibility from either a reference or an empty collection.
- Add only a live ScheduleView field outside immutable current/revision/disposal bodies and
  all digests. Preserve postingBasis, eligibility, dependencies, controls, correction guards,
  private tax match views and retained receipt/artifact bytes exactly.
- No write, new command, shared helper/schema, route, grant, UI or provider call is introduced.
  Existing REST and MCP schedule reads consume the additive contract. Historical schema inputs
  remain decodable when the live field is absent.

No tests, fixtures, SQL application, runtime or external actions are authorized. Source checks
cannot establish SQL compilation, isolation behavior or runtime transport correctness.

## Implemented source

Forward `5300-subledger-tax-match-references.sql` replaces only public `get_schedule`, starting
from4200's complete getter. The existing REST `GET /api/v1/entities/:entityId/books/:bookId/schedules/:id`
and MCP `schedules_get` return the additive live `basisTaxMatches` field:

```text
basisTaxMatches
  roleCompatibility: "not_assessed"
  matches: [{ voucherId, lineId, matchId, eventId, matchDigest }]
```

The read keeps current authorization and the shared book barrier. It checks the complete
schedule basis-line count using a21-row overflow probe, then joins the exact20-or-fewer lines
to current reservations and their immutable matches. Voucher, line and book identities all
participate. Match identity/event/voucher/line also agree with the reservation's composite
foreign key. References sort by voucher, line and match ID using C collation.

The query does not call the private match view or filter on usability, account activity,
correction state or metadata currentness. An invalid-but-reserved match remains visible.
Unmatch removes the live reference; a later match returns its distinct saved identity/digest.
No amounts, reason, evidence body, approval or command receipt are copied. An empty array
means only that no current reservation references these retained basis lines.

`ScheduleBasisTaxMatches` is local to the existing subledgers contract. Its complete array is
bounded at20 and `roleCompatibility` is the literal `not_assessed`. `ScheduleView` accepts the
field optionally for historical response compatibility; new getter responses always include
it. No shared schema, query binding, handler, package export or grant is needed. The current
web surface is unchanged; this packet delivers the existing backend REST/MCP read contract.

The diff leaves every previous getter field and calculation intact. In particular,
`postingBasis` is not extended and no eligibility/dependency state observes these references.
Immutable current/revision/disposal bodies, saved digests,1500/1800/4100 authority, private
match views, controls and correction guards are unchanged. These are facts about related
records, not conflict warnings, role clearance, capacity reuse or financial permission.

## Verification boundary

Source review compared the full replacement with4200 and traced both existing transport
consumers. Pending separately authorized observations: unknown/foreign schedule; equal line
IDs on different vouchers/books; zero/multiple/20 active references; overflow refusal;
unmatch/rematch; invalid-but-reserved matches; and byte-identical immutable fields/digests
before and after a reference change. SQL compilation and runtime/isolation behavior remain
unverified. No tests, fixtures, SQL/runtime/provider execution or UI change was performed.

Owned checks: Oxfmt passed on the contract and this handoff. Oxlint passed on the contract
with zero warnings/errors. Source comparison confirmed only the getter's new local reference
query and live response field differ from4200. Owned files have no trailing whitespace.
No shared typecheck, tests/helpers/fixtures, SQL/runtime/migration execution, external/provider
access, dependency installation, deployment or VCS action was performed. Root owns shared
type validation and any later authorized runtime evidence.

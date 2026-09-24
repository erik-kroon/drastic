#4700 tax-account correction-impact closure — failure contract

4500 SQL sealer fix was completed and reported separately before this packet.

Pre-code requirements:

- Every active tax-account reservation on the selected book/voucher is a correction blocker,
  including a reservation whose reviewed relation is no longer usable. Invalid does not mean
  released; only4100's evidenced unmatch releases that reservation.
- Retain exact match, statement/event and voucher/line identities and a dependency digest.
  A same-named line in another voucher/book must not appear or be confused with the target.
- Match/unmatch/rematch or changed effective review metadata must change the existing impact
  basis where relevant. Old retained impact bytes/receipts and original-key recovery stay
  unchanged. No old impact is relabelled or recomputed in storage.
- The existing correction owner must expose this relation to actual impact reads, bundle
  preparation/validation and standalone reversal admission, not only to a display artifact.
- Preserve every1700 bank, commerce, schedule, owner, report and closing contribution. Keep
  the1000-resource whole-read refusal and4100's independent physical correction fence.
- No automatic unmatch, capacity release, new financial authority, posting, accounting role,
  legal/company inference or new artifact family. No tests/runtime/SQL execution.

Consumer inspection before implementation:0410 correction_impact_basis derives blockers
from every resource with blocks=true. prepare_correction_bundle and check_correction_bundle
compare exact retained/live impact bases and reject blockers. get_correction_impact compares
currentness without replacing saved bytes. correction_require_unbound consumes the same
resource owner for standalone reversal admission. Existing command owners replay before
new-state checks. Latest resource composition is1700;4700 only forward-replaces that owner.

## Implemented source and exact ownership

`4700-tax-account-correction-impact.sql` forward-replaces only
`correction_impact_resources(text,text,date)` from1700. All original resource queries and
owner contributions remain intact. The final whole-inventory1000-resource refusal remains;
nothing is silently truncated.1700 and4100 were not edited.

The new `tax_account_match` resource is selected by exact book and voucher from the private
4100 reservation owner, not from historical reviews and not only from usable relations.
It always blocks while the reservation exists. Its `id` is the immutable match ID. The
additive typed `taxAccountMatch` payload retains statement ID/digest, event ID, voucher/line
pair, match digest and current usability. The existing read path is
`/tax-account/matches/:id`. Resource detail names the exact relation and asks for explicit
unmatch; it does not execute that operation.

`dependencyDigest` pins immutable match digest, full physical reservation identity and live
active/usable status. Changed match ownership is reflected in the existing impact basis.
Account/book changes remain covered by the original correction configuration digest as well.
When no tax reservation exists, no tax resource or placeholder field is added to unrelated
resources. Old review bodies, digests, successful-key replay and aggregate receipts are not
rewritten. A released relation is no longer an active blocker; rematching creates a new
review/reservation identity.

No public route, query registry, capability binding, artifact family or runtime was added.
`packages/contracts/src/corrections.ts` extends the existing resource kind and adds optional
typed lineage metadata, preserving old impact decoding. Existing REST/MCP impact readers and
correction preparation/admission consume the new resource through the existing owner.
Root owns any exhaustive consumer copy needed outside that local contract.

## Actual consumer effects

- `prepareCorrectionImpact` now names the tax relation as a blocker before approval.
- `getCorrectionImpact` keeps saved bytes and separately compares the live resource basis.
- `prepare_correction_bundle` refuses the blocker and checks exact saved/live review equality.
- `check_correction_bundle` carries the refusal into approval and execution checks.
- `correction_require_unbound` makes the same relation visible to standalone reversal
  preparation and the existing generic physical correction guard.
  -4100's independent physical voucher-insertion fence remains unchanged as defense in depth.

No relation is unmatched by correction preparation, approval or execution. Invalid-but-reserved
relations remain blockers. No bank/commerce/owner allocation, accounting amount, legal role,
period state or source completeness claim is changed.

## Source review and checks

Compared the full4700 function against1700: only tax resource construction/composition and
its local variable were added; all previous queries, sort/owner composition and whole-read
limit remain. Reviewed same-line-ID/different-voucher isolation, wrong-book isolation,
invalid-but-reserved status, release/rematch identities, exact source/digest lineage and the
actual0410 consumers listed above. These are source observations, not transaction proof.

The correction contract passed Oxlint with zero warnings/errors. Owned Oxfmt and
`git diff --check` passed. Shared type checks and independent function-diff review are root
owned. No tests, runtime/SQL execution, migration application or external actions occurred.

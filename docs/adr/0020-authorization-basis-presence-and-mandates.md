# ADR 0020 — Authorization basis, presence proof and standing posting mandates

Status: accepted with amendments, 2026-10-10. Implementation is behind a
per-book authority policy that defaults to off; this record claims no production
qualification, provider integration or adopted UI.

## Context

Drastic is operated by a person with an agent. The application recorded "a person
decided" as "the caller authenticated with a Better Auth browser session". That proxy
was scattered over about 50 call sites with four spellings (`requireHumanSession`,
`human()`, inline `principal.kind` checks and `admitHumanActor` re-admission), and it
was applied inconsistently: `approve_change` required a session in eight families
while the posting kernel and about fifteen other approvals admitted an operator API
credential.

A browser session does not prove a person is present. An agent operating the browser,
or holding a copied session cookie, passes every session check. As agents become
capable of routine bookkeeping, the system needs to express two different things:
work that a person must perform now, and work a person has authorized in advance
within explicit bounds.

## Decision

### 1. One gesture table owns the authentication basis

`apps/api/src/application/authority.ts` declares every gesture that depends on how
the caller authenticated, with its power (prepare, approve_change, issue_document,
settle, authorize_payment, sign, submit_filing, activate_rule,
administer_membership, configure_book, provider_callback) and required basis.
Call sites call `authorize(principal, gesture)`; no call site branches on
`principal.kind`. Operator membership stays in `db/identity.ts` and is unchanged.

The table records the posture as found. Aligning a power, for example making every
`approve_change` require the same basis, is a deliberate later edit of this table and
must not be mixed into the extraction.

### 2. Presence proof for gestures the law reserves to a person

A gesture may additionally require a **presence proof**: a WebAuthn assertion with
user verification, from an authenticator enrolled out of band, over a challenge bound
to `(actor, book, gesture, exact request digest)`. The proof is single-use and is
consumed in the guarded transaction. Initial presence gestures: payment authority
(`approve_payroll_settlement_instruction`, `verify_employee_payee`,
`approve_claim_payment_file`), signature (`prepare_document_signature`), filing
(`authorize_filing`) and mandate grant.

Enrollment of an authenticator requires a one-time ticket minted by the operator
console (`bun run --cwd apps/api authority:ticket <actor>`). A session alone cannot
enroll, because a browser-driving agent could enroll a software authenticator.

Enforcement is a per-book authority policy (`openerp.book_authority_policies`) that
only the operator console writes: `bun run --cwd apps/api authority:policy <book>
required|off enabled|off`. The runtime role can read the policy but cannot relax it.
No row means off, which keeps current behavior until the enrollment and step-up
screens are designed and adopted under the page 00 delivery contract. BankID is a
later presence provider and needs its own qualification.

### 3. Standing posting mandates (PST-05), first for supplier acceptance

A mandate is an immutable, human-granted record that pre-authorizes one agent to
execute a bounded class of supplier-invoice acceptances. It binds book, grantor,
grantee, accepted profiles, named counterparty revisions, currency, per-event gross
limit, aggregate gross limit, maximum event count and validity interval. It requires
two approving operators distinct from the preparer, with interactive sessions and
presence proof (when enforced). Any operator may revoke it. It never authorizes
payment, signature or filing.

Execution under a mandate is one transaction: lock the mandate, check revocation,
validity, grantee identity, the grantor's current operator authority, the sealed
review digest and blockers, every term, and the remaining limits; then mint an
approval bound to the exact review digest with authority basis `mandate`, run the
ordinary acceptance execution, and append the consumption. Anything out of bounds is
refused and stays in exact-plan human review. A mandate is never inferred from rules
or repeated approvals (ADR 0017).

The same per-book policy enables grant and execution; the default refuses. No book
may enable it until AUT-27 implements and verifies the two-approver gate. Grant,
revocation, reads and execution are HTTP operations. Execution is not yet in the MCP
catalog; adding it requires its own MCP evaluation.

## Owner acceptance, 2026-10-10

Accept the gesture table, presence proof and bounded supplier-acceptance mandates, with these amendments:

1. A non-advancing non-zero counter is a risk signal and is refused; constant-zero authenticators are valid.
2. Granting a mandate requires two approvers, and the preparer never counts (AUT-27, page 00 M-01). No book may enable mandates until that is built.
3. Mandates stay limited to supplier acceptance, cannot pay, sign or file, and stay off by default.

The existing single-approver grant implementation is not sufficient for enablement. AUT-27 must retain separate preparation and two distinct approvers bound to the same immutable terms, and prove the required refusals before any book can enable mandates. Acceptance changes no per-book policy and claims no production qualification.

## Failure cases (written before implementation)

Presence proof:

| Given / when                                                          | Required observation                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Enforcement on, payment gesture with session and no proof             | `PresenceRequired`; no approval row, no command receipt.                |
| Proof issued for request A, gesture submitted with request B          | Refused; proof stays unconsumed and usable for A.                       |
| Proof replayed for a second request after one success                 | Refused; first result unchanged.                                        |
| Proof bound to another gesture, book or actor                         | Refused.                                                                |
| Expired challenge                                                     | Assertion refused; no proof recorded.                                   |
| Assertion without the user-verified flag                              | Refused.                                                                |
| Assertion signed by an unenrolled or revoked key                      | Refused.                                                                |
| Signature counter fails to advance when either stored or received counter is non-zero | Refused. Always-zero counters remain supported. |
| Enrollment attempted with session but no ticket, or a consumed ticket | Refused; no authenticator stored.                                       |
| API credential requests a challenge                                   | Refused; presence is only for interactive sessions.                     |
| Enforcement off                                                       | Every existing gesture behaves exactly as before.                       |
| Guarded transaction rolls back after the proof check                  | Proof consumption rolls back with it.                                   |

Mandates:

| Given / when                                                          | Required observation                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Flag off                                                              | Grant and execution refused; no rows.                                   |
| Agent or API credential grants a mandate                              | Refused.                                                                |
| Two executions compete for the last aggregate capacity                | Exactly one commits; the other is refused; consumed total ≤ limit.      |
| Execution beyond per-event limit, count or validity                   | Refused; review remains for human approval.                             |
| Counterparty revised after grant (changed facts)                      | Refused until a new mandate names the new revision.                     |
| Review digest stale or blockers present                               | `StaleDependency`; no consumption.                                      |
| Mandate revoked, then execution                                       | Refused; earlier consumptions and postings unchanged.                   |
| Grantor loses operator membership or admission                        | Refused.                                                                |
| Caller is not the named grantee                                       | Refused.                                                                |
| Replay of the same execution key                                      | Same receipt; one consumption, one voucher.                             |
| Failure after consumption insert                                      | Voucher, approval, consumption and receipt roll back together.         |

## Alternatives rejected

Keying the policy on power alone (it would silently change about fifteen approval
paths); treating any WebAuthn assertion as presence without request binding (it
would approve whatever the page shows next); allowing session-only enrollment;
automatic mandates inferred from repeated approvals; and reusing period-work batch
approval, which approves an exact manifest rather than a bounded future class.

## Consequences

Approvals now distinguish a direct gesture from a mandate in their stored
authority basis. A later owner decision can align `approve_change`, require
presence for more gestures, add BankID, extend mandates to other posting owners and
expose mandate execution in the agent catalog by its own MCP evaluation.

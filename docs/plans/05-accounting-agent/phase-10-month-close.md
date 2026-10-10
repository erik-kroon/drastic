# Phase 10. Month-close playbook

[Overview](overview.md)

## Goal

"Gör september klart för Fjällby" runs end to end on the synthetic month and meets the program definition of done in the overview. It uses code, rules, firm memory and people only. Models come afterwards, in Phases 11 and 12, as measured improvements on this result.

## Changes

- The month-close playbook composes:
  - the supplier invoice playbook;
  - bank matching;
  - completeness with one batched question;
  - VAT preparation up to the point where filing needs a security key.
- It finishes when the Phase 1 verdict is `done`, or when every gated check that is not passing has exactly one waiting item naming its cause.
- A run report states:
  - touches per transaction against the Phase 3 baseline;
  - handled transactions, measured with AUT-25, not billed;
  - which gated checks moved from fail to pass;
  - every NOT VERIFIED or INCONCLUSIVE expectation.

## Failure cases

- The run reports done while any gated check is not a fresh `pass`.
- Filing, payment or signing happens without a presence gesture.
- A kill at any step boundary changes the canonical projection.

## Verification

- Static. Full changed checks, owners, design.
- Runtime.
  - The scorer runs over all twelve synthetic books, with kill-and-resume at every step boundary.
  - The decision trail and run reports are committed under `verification/agent-mode/`.

Size M. Depends on Phases 1 to 9.

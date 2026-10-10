# Phase 9. One batched question to the client

[Overview](overview.md)

## Goal

A run asks each client once, with every askable fact in one question, and turns the answers back into facts. Today a question targets one record and can only be addressed to a book operator (`work-questions.ts:519-525`).

## Blocker

There is no client role. ADR 0019 is accepted for bureau/client on 2026-10-10, with typed answer slots, no client free text in model state and AUT-16 consent through that role. The phase cannot reach clients until the role, invitations and scoped authority are implemented and its synthetic browser proof is retained. Until then the same mechanism addresses a bureau operator.

## Changes

- A question bundle over many records, built on `work-questions.ts`. It keeps the per-record question rows, so posting gates like `requireResolvedSupplierQuestions` keep working.
- Each slot has a stable identity bound to the book and to the subject revision.
  - The batch is a delivery envelope over slots, not one indivisible form. Partial answers save and resume.
  - Every slot offers "I do not know" or "none of these applies" where that is truthful.
  - Reminders cover only unanswered slots, at a cadence the owner approves.
  - A materially revised transaction never inherits a stale answer.
- Typed answer slots per fact kind.
  - Closed answers (private or business, which project, receipt attached) are parsed deterministically.
  - A free-text answer goes to a person, who records the fact. No model reads client free text. ADR 0021 data minimisation keeps it out of every model state.
- Agents may create a bundle over MCP after classification in `agent-policy.ts`. They never answer or close one.
- Notifications for asked and answered questions. Nothing notifies today.
- The wording comes from a reviewed template, with names filled in by the server.

## Data structures

- `QuestionBundle`. `{ id, runId | null, book, askedTo, slots: AnswerSlot[], state }`.
- `AnswerSlot`. `{ factId, kind, answer: closed value | attachment | free text | null, recordedBy }`.

## Failure cases

- Two runs ask the same client about the same fact.
- An answer to one slot resolves a different fact.
- An agent answers or closes a bundle.
- An attachment that is not an already retained original is accepted.
- Client free text reaches any model call.

## Verification

- Static. Changed checks, owners, `test:mcp`, `test:mcp:eval`.
- Runtime. E2E on the Phase 3 month.
  - One bundle per client covers every askable fact.
  - Seeded answers resolve exactly their facts.
  - The browser journey runs with `bun run test:browser` once the Phase 13 board is adopted.
  - Artifacts under `test-results/agent-p9`.

Size L. Depends on Phase 8 and ADR 0019.

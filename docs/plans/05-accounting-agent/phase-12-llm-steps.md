# Phase 12. LLM steps and investigation

[Overview](overview.md)

## Goal

Add an LLM only where judgement or language is needed, and keep it only if it measurably beats the Phase 11 result. An LLM never makes a closed accounting choice and never posts.

## Changes

- A provider-neutral LLM adapter behind the AUT-28 boundary. Outputs are typed JSON only. Tokens are restored only into typed fields.
  - Build it on Effect's `LanguageModel` and `Toolkit` (`effect/unstable/ai`), so tools share the Effect Schema contracts that HTTP and MCP already use.
  - The module is unstable, so it stays behind one small Drastic port. A version change then touches one adapter.
  - The Vercel AI SDK and TanStack AI are not used on the server, because they would duplicate the typing in a second, Promise-based stack.
  - The inner loop is our own, on Effect AI. Owner decision, 2026-10-10.
    - No external agent harness is a dependency.
    - We borrow from Yielded Agent:
      - budgets;
      - an authorization check on every inner call;
      - fail-closed approvals inside code mode;
      - a cap on model-visible output bytes;
      - uncertain outcomes that are reconciled, never replayed.

    The [borrow ledger](harness-research.md#borrow-ledger) names each source.
    - Revisit when Yielded Agent reaches 1.0 with a stable store and confirmed PostgreSQL durability. At that point it could replace this inner loop behind the same port. Its test suite is a source of failure cases now.
- An investigation step in code mode, following [harness-research.md](harness-research.md).
  - The model writes one read-only program against the capabilities classified `read`. It excludes client question text and document text, which stay out of model state under ADR 0021.
  - The program is fixed before it reads data.
  - The host re-checks authority on every call and enforces a budget of calls, rows, bytes and wall clock.
  - The program returns one schema-checked finding, tokenised by AUT-28 before any model sees it.
  - The program, its catalog version, its as-of snapshot and a call journal are stored, so the finding replays deterministically.
  - One interpreter runs on both hosts, so a finding produced on Cloudflare replays identically on self-host.
    - Write our own interpreter from this specification. Owner decision, 2026-10-10: build from scratch and copy no code.
      - It is modelled on the design OpenCode's codemode describes: an Acorn parser as an ordinary dependency, then a tree-walking evaluator on Effect with no `eval`.
      - It accepts only the JavaScript subset a read program needs.
      - Values cross the boundary as JSON.
    - Determinism is built in from the start.
      - There is no random and no `crypto`.
      - `Date` is the as-of time in UTC.
      - Regular expressions are bounded or absent.
      - There are no extensions.
  - On self-host, run it in a Bun process separate from the API, with an OS memory cap and a kill on wall clock. The interpreter shares memory and thread with its host, and it cannot stop a regex stall or memory exhaustion by itself.
  - On Cloudflare, run the same interpreter inside a Worker Loader isolate.
    - Use `globalOutbound: null`, no env and a CPU limit.
    - Capabilities come through a pass-scoped RPC target.
    - Never run it from a Durable Object that serves other traffic.
  - Drastic adds what none of the researched sources provide:
    - **A full call journal.** Each entry records sequence, path, decoded input, the JSON the program saw, status, rows, bytes and latency. It is stored with the program digest, the interpreter commit and the catalog digest.
    - **Authority** re-checked in the call hook and again inside each capability.
    - **Row and byte budgets**, reserved before a call and accounted after it.
    - **Capability calls one at a time**, so they complete in the order they were made.
    - **An as-of snapshot** held by the host. The program never passes it.
    - **Replay** that serves the journal and fails on any divergence.
    - **Strict output.** A truncated or timed-out result is a failure, never a finding.
  - Programs that keep proving useful become deterministic checks.
  - Start with the smallest language that a read program needs. Widen it only when an investigation proves it necessary.
  - Each ceiling is separate: instructions, elapsed time, memory, host calls, rows scanned, bytes returned and final output size. A small output cap does not stop a large internal query.
  - The broker derives the book and scope from the run, never from arguments the model supplies.
  - Hosted and self-hosted code mode are separate security targets that share one behavioural contract. Qualify the self-host process boundary on its own.
  - Threat-model the combination of private data, attacker-controlled content and an output channel. Read-only does not prevent exfiltration.
  - A baseline arm calls tools one at a time, so the eval can show whether code mode earns its place.
- A second-opinion step. Before a batch reaches a person, a model from a different family reviews it. Its findings map to K-04 statuses.
- An eval on the Phase 3 month comparing runs with and without these steps on touches, consequence errors and cost per handled transaction.

## Data structures

- `Finding`. `client_question | correction_proposal | note | unknown`, each with evidence references.
- `LlmBudget`. `{ maxCalls, maxInputTokens, maxCost }` per step.

## Failure cases

- An LLM output names an account or VAT treatment that is then used without a decision step or a person.
- Instructions inside source data change the agent's tools or targets. The AUT-24 watchdog question must trip.
- An unknown token appears in output and is restored.
- The budget is exceeded and the step reports success.
- A program reaches the network, a `prepare` capability, or a capability added after the run started.
- A replay of a stored program at its as-of snapshot produces a different finding.

## Verification

- Static. Changed checks, `check:changed:full`.
- Runtime. Fixture-model E2E for every failure case. The eval decides whether each step ships. Record VERIFIED, NOT VERIFIED or INCONCLUSIVE in the decision trail. Artifacts under `test-results/agent-p12`.

Size L. Depends on Phase 11, AUT-24, and the owner's LLM provider decision (AUT-00).

# Harness research for the run engine

[Overview](overview.md)

Read on 2026-10-10 from source and docs, as input to the Phase 4 arena. We looked at T3 Code, the Codex app-server, Prime Agent, OpenCode, Pi, and code mode as Cloudflare and Anthropic describe it. All are coding agents. None of them binds an approval to stored content.

## What each one teaches

- **T3 Code** (MIT). Event-sourced, written in Effect.
  - A pure orchestrator turns commands into events. One transaction commits events, projections, the command receipt and outbox effects. A worker performs the effects and feeds the results back as commands.
  - The structure is run, then attempt, then a tree of nodes. Only the root node completes a run.
  - Approvals are durable request records, but they expire when the provider process dies.
- **Codex app-server** (Apache-2.0). A thread holds turns, and a turn holds items. An approval request carries the exact action and follows the order started, requested, resolved, completed. The item notifications are the source of truth.
- **Prime Agent** (MIT, a fork of Pi). Commands are journaled before dispatch. A command with no durable result is reported as uncertain and is never replayed. Goals end only through gate commands or a budget.
- **OpenCode** (MIT). V2 is an Effect rewrite still in progress.
  - A durable session event log and a durable inbox of prompts, accepted with idempotent ids.
  - Typed tools that decode input and validate output with Effect Schema.
  - Permission rules of the form action, resource, effect.
  - Context epochs, which store the exact context shown to the model.
  - Pending approvals live in memory and are declined on shutdown.
  - It has a `codemode` package, an interpreter without `eval` that runs over Effect Schema tools.
- **Pi** (MIT, 1.0 on 2026-10-01). The experimental `pi-durable` package is the closest match to a run engine.
  - Each step commits its intent, performs the effect, then commits its outcome.
  - A tool reruns after a crash only if it declares itself replay-safe. Otherwise the model sees "interrupted".
  - Durable waiting on child tasks and on external events, with stored handles.
  - Code mode runs in a QuickJS WebAssembly sandbox.
- **Code mode** (Cloudflare and Anthropic).
  - The model writes one program against typed APIs. The program runs in an isolate with no network, and intermediate data stays inside it.
  - Cloudflare's Dynamic Workers have been in open beta since 2026-03-24.
  - Open-source workerd enforces no limits and is not a hardened sandbox.
  - Anthropic's hosted programmatic tool calling keeps container data for up to 30 days and is not zero-retention, so it conflicts with the AI egress boundary.

## Borrow

1. **Decide, commit, act.** A pure step decider. One PostgreSQL transaction writes the step events, the projection, the command receipt and an outbox row. A worker claims the outbox row and calls the accounting owner. (T3 Code)
2. **Run, attempt, node.** A retry is a new attempt, never an overwrite. Only the root node completes a run, and only after the gated checks pass. (T3 Code, Prime Agent)
3. **Intent, effect, outcome.** Steps declared replay-safe repeat with the same idempotency key. Any other interrupted effect is marked uncertain and reconciled against the owner by that key, never retried blindly. (pi-durable, Prime Agent)
4. **A durable inbox.** The outcome request, client answers, approvals and steering enter a run as accepted rows with caller ids. The run consumes them only at step boundaries. (OpenCode)
5. **Approvals as durable waiting nodes.**
   - Each is bound to the digest of the stored records it approves and to the required gesture, including a security key where ADR 0020 asks for one.
   - It survives restarts, and it expires only by policy.
   - The UI follows the started, requested, resolved, completed order. (Codex app-server)
6. **One typed contract per capability.** It decodes input and validates output, and the same contract serves HTTP, MCP and run steps. Permission rules evaluate in trusted code as action, resource and effect. The effects are `allow`, `prepare_only`, `require_approval` and `require_presence`. (OpenCode)
7. **Context epochs.** Each LLM step stores the exact context it saw, for the decision log. (OpenCode)
8. **Delegation only narrows.** Each run gets a scoped, expiring credential, and a child step never gains authority. (T3 Code)
9. **Code mode for investigation only.**
   - The program is fixed before it reads data.
   - Its bindings are only the capabilities classified `read`, without document or question text.
   - The host re-checks authority on every call and enforces the budget.
   - It returns one schema-checked finding.
   - The program and its call journal are stored for review and deterministic replay.
   - One interpreter of our own, modelled on OpenCode's codemode design, runs on both hosts. On Cloudflare it runs inside a Worker Loader isolate with no outbound access. On self-host it runs in a separate Bun process with an OS memory cap. See the OpenCode section below.
   - Good programs graduate into deterministic checks.

## Avoid

- Approvals tied to a live process, or held in memory.
- Session-wide grants, "always allow" and automatic approve modes.
- Hooks, prompts or containers as the permission boundary.
- An automatic model reviewer standing in for a person. It may pre-screen only.
- Loops that run until the model stops or hit a step cap. A run ends on checks.
- Transcript forking or snapshot revert. These conflict with immutable posted history.
- Hosted code execution where tool results leave Drastic.

## Yielded Agent

[Yielded Agent](https://yielded.dev/agent/) (MIT, `@yielded/agent` 0.1.0-beta.167, peer `effect ^4.0.0`) is an agent harness built on Effect and Effect AI. It has already implemented most of the "Borrow" list:

- canonical records with fenced writes and a run continuation;
- `UnknownToolOutcome` for an effect that may have happened, which is reconciled, never replayed;
- pending approvals as canonical records that survive restarts, plus a nonexecution proof when an approval was recorded before dispatch;
- budgets on turns, tool calls, duration, tokens and cost;
- code mode through Worker Loader, where each inner call passes `RunToolAuthorization` and tools that need approval fail closed;
- an optional host on Effect's `WorkflowEngine`.

Fit for Drastic:

- **Not the run engine.** A Yielded run is an LLM loop bounded by turns. A Drastic run is a typed playbook that ends on checks.
- **Storage is still moving.** It is beta, "stored data may change before 1.0", and the current record format has no converter. Its durable classes cover Node with SQLite and Cloudflare Durable Objects, while PostgreSQL durability is unconfirmed. Drastic history must not live in its store.
- **A good fit for the inner loop of Phase 12 nodes.** Investigation is read-only, so it is replay-safe. The in-memory class is enough there, because our engine records the node's intent, effect and outcome around it. It is evaluated against a plain Effect AI loop behind the same port.
- **It does not solve self-host code mode.** Its code mode needs Worker Loader, so it covers Cloudflare only.
- **It is reference reading for Phases 4 and 5.** Its recovery table and uncertainty rules are worth reading before the arena.

## Decision

Owner decision, 2026-10-10. Drastic builds its own run engine, inner LLM loop and code-mode executor, and borrows anything worth borrowing. No agent harness or workflow framework becomes a runtime dependency. Effect AI is the model client, behind a Drastic port.

Owner decision, 2026-10-10. We build from scratch and copy no code. Implementers work from the phase specifications, not side by side with another project's source. Patterns and architecture are design references, and the ledger below keeps them as references for engineers. If code is ever copied after all, its license notice must be kept and checked against `LICENSING.md`.

## Borrow ledger

| Pattern | Source | Lands in |
| --- | --- | --- |
| Pure decider. One transaction writes events, projection, receipt and outbox, then a worker performs the effect | T3 Code orchestration v2 | Phases 4 and 5 |
| Run, attempt, node, with only the root completing | T3 Code | Phase 4 |
| Finalisation before completion | T3 Code | Phase 4 |
| Intent, effect, outcome per node, with replay declarations | pi-durable | Phase 5 |
| Uncertain outcomes reconciled, never replayed (`UnknownToolOutcome`) | Yielded Agent, Prime Agent | Phase 5 |
| Nonexecution proof when an approval is recorded before dispatch | Yielded Agent | Phase 4 |
| Durable approvals as canonical records that survive restarts | Yielded Agent. Our own addition is binding to record digests | Phase 4 |
| Approval event order: started, requested, resolved, completed | Codex app-server | Phases 4 and 13 |
| Durable inbox with caller ids, consumed at boundaries | OpenCode V2 | Phase 4 |
| Typed tools that decode input and validate output with Effect Schema | OpenCode V2, Effect AI | Phase 12 |
| Permission rules evaluated in trusted code | OpenCode | Phase 12 |
| Context epochs, the exact model context per step | OpenCode V2 | Phase 12 |
| Budgets on turns, tool calls, duration, tokens, cost and output bytes | Yielded Agent | Phase 12 |
| An authorization check on every inner call, with approval-needing tools failing closed in code mode | Yielded Agent | Phase 12 |
| Code mode with a fixed program and tool reachability per tool | Cloudflare Code Mode, Pi, OpenCode codemode | Phase 12 |
| Interpreter design (Acorn parse, tree-walking evaluation on Effect, no `eval`, JSON boundary), reimplemented from scratch with determinism built in | OpenCode codemode at `5caf1f9`, as a design reference | Phase 12 |
| A full call journal, deterministic replay, row and byte budgets, and an as-of snapshot | None of the sources. This is Drastic's own work | Phase 12 |
| A delegated credential that only narrows | T3 Code | Phase 4 |
| Recovery table per last committed boundary | Yielded Agent durability docs | Phase 5 |

### T3 Code orchestrator v2, read at `8c777fb` (MIT, Effect 4.0.2, SQLite)

| Look at | What it shows |
| --- | --- |
| `apps/server/src/orchestration-v2/EventSink.ts:527-593` | `commitCommand`. Reserve the receipt, append events, apply projections, enqueue the outbox, upsert the receipt, then notify after commit |
| `EffectOutbox.ts:123-141, 490-559, 583-665` | Classifying replay-safe against process-bound effects, the claim, and settlement fenced on the lease owner |
| `EventSink.ts:396-510` | Compare-and-set writes on run status and active attempt |
| `RunExecutionService.ts:639-792`, `CheckpointCaptureService.ts:90-238` | Completion as an outbox effect with a deterministic command id |
| `ProjectionMaintenance.ts:69-196` | Verify, then rebuild projections through the same reducer |
| `testkit/OrchestratorReplayRecovery.integration.test.ts:199-295`, `FoundationPersistence.test.ts:1412-1483, 2051`, `EffectWorker.test.ts:374-441` | Restart, single-claim, retry and fault-injection tests |

Not copied:

- approvals waiting on an in-memory deferred, which expire on restart (`Adapters/CodexAdapterV2.ts:1855-1857`, `ProviderRuntimeRecoveryService.ts:301-318`);
- a process-local lock as the only fence;
- no lease reclaim during runtime;
- uncertain effects cancelled instead of reconciled;
- receipts without a payload digest;
- a timestamp inside a recovery command id;
- event compaction.

### OpenCode codemode, read at `5caf1f9` (MIT)

`packages/opencode` was removed on 2026-07-21. The tool now lives in `packages/core/src/codemode/tool.ts`. The interpreter is `packages/codemode/`.

| Look at | What it shows |
| --- | --- |
| `src/interpreter/execute.ts:109-117`, `interpreter.ts:379-480` | Acorn parse, then a tree-walking evaluation on Effect. Unsupported syntax is refused |
| `src/interpreter/globals.ts:29-58` | The `Function` constructor throws, so there is no `eval` |
| `data.ts:37-118` | Values are copied across the boundary as JSON, and `__proto__` is dropped |
| `tool-schema.ts:295-303`, `tool-runtime.ts:55-81, 399-441` | Effect Schema decode on input and output, and before and after hooks that can deny a call |
| `codemode.ts:22-35`, `limits.ts:7-13` | Time, call and output limits, all unlimited by default. There is no memory cap |

Gaps that Phase 12 must close:

- The interpreter is not deterministic. It has live random, crypto and dates, and concurrent call order depends on latency.
- The audit list holds tool names only.
- Host regular expressions and sorts cannot be interrupted.
- An oversized result is truncated but still reports success.
- The npm release pins an Effect release candidate. This no longer matters, because we build our own.

Compared with Yielded (Worker Loader isolates, broker authorization, Cloudflare only) and Pi (QuickJS WebAssembly, `eval` allowed, no schema validation), OpenCode's interpreter is the only one that combines a fixed program, Effect Schema contracts, and pure JavaScript that runs on both Bun and workerd.

## Frameworks considered

Checked on 2026-10-10.

- **Durable execution.**
  - Keep our own run engine on PostgreSQL and effect-mq, as ADR 0009 chose.
  - Effect's durable workflows (`effect/unstable/workflow`) are Phase 4 candidate E. They are unstable.
  - DBOS shows the same pattern as a Postgres library: checkpointed steps and approval waits. It is a reference, not a dependency.
  - Cloudflare Workflows and the Agents SDK run only on Cloudflare.
- **LLM client.** Effect's `LanguageModel` and `Toolkit` (`effect/unstable/ai`) sit behind a Drastic port. The Vercel AI SDK stays in the verification tooling, where `e2e.config.ts` uses it. TanStack AI is React-first and was at 0.16 with experimental workflows. It may serve a chat surface later, but not the engine.
- **MCP.** Effect's `McpServer` composes resources, prompts and a toolkit. It is the alternative to extending `transport/mcp.ts` in Phase 13.
- **LLM hosting.** Claude on Amazon Bedrock through an EU geographic inference profile is the leading candidate for AUT-00. Stockholm appears as a routing destination, but not as an in-region option for every model. Check each model card.

## Sources

Read by the research agents:

- [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- [openai/codex](https://github.com/openai/codex) and the [app-server docs](https://learn.chatgpt.com/docs/app-server)
- [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent)
- [anomalyco/opencode](https://github.com/anomalyco/opencode), including [specs/v2](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md) and [codemode](https://github.com/anomalyco/opencode/blob/dev/packages/codemode/README.md)
- [earendil-works/pi](https://github.com/earendil-works/pi), including the [durable spec](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)
- [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/) and [Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/)
- [workerd README](https://github.com/cloudflare/workerd/blob/main/README.md)
- [Anthropic, Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) and [programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- [CodeAct](https://arxiv.org/abs/2402.01030)
- [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- [Effect v4 Activity](https://effect.website/docs/v4/api/effect/unstable/workflow/Activity) and [ClusterWorkflowEngine](https://effect.website/docs/v4/api/effect/unstable/cluster/ClusterWorkflowEngine)
- [TanStack AI docs](https://tanstack.com/ai/v0/docs) and [orchestration post](https://old.tanstack.com/blog/tanstack-ai-orchestration)
- [Cloudflare Agents SDK and Workflows changelog](https://developers.cloudflare.com/changelog/2026-02-03-agents-workflows-integration)
- [DBOS AI quickstart](https://docs.dbos.dev/ai/ai-quickstart)
- [Yielded Agent](https://yielded.dev/agent/), [durability](https://yielded.dev/agent/concepts/durability/), [code mode](https://yielded.dev/agent/guide/code-mode/) and [yielded-dev/agent](https://github.com/yielded-dev/agent)
- [Bedrock model card, Claude Sonnet 4](https://docs.aws.eu/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4.html) and [Opus 4.5](https://docs.aws.eu/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-5.html)

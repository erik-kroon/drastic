import * as C from "@open-erp/contracts/decision-jobs";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as A from "@open-erp/contracts/accounting";
import * as D from "@open-erp/domain/decisions";
import * as Effect from "effect/Effect";
import * as Db from "../../db/decision-jobs";
import { Database } from "../../db/connection";
import { openAiEgress } from "../ai-egress";
import { AiFinancialFact } from "../../adapters/ai-egress";
import * as Schema from "effect/Schema";
import { withTransaction, type Transaction } from "../../db/transaction";
import { hashToken } from "../../db/human-actor";
import { RequestEnvironment } from "../../runtime/environment";
import { configuredDecisionModel } from "../../runtime/decision-model";
import { withBook, decode, toJsonObject } from "../commerce/support";
import { digest, newId } from "../posting";
import { failure } from "../failures";
import { authorize } from "../authority";
import { admitRunnerActor } from "../preparation-jobs";
import { readFirmMemory } from "./firm-memory";
import type { DecisionOutcome } from "../../adapters/decision-models/systemone";

type Scope = typeof A.Scope.Type;

type Frozen = typeof C.FrozenDecisionRequest.Type;

type Policy = typeof C.DecisionPolicy.Type;

type Input = typeof C.AdmitDecisionRequest.Type;

const requestView = Effect.fn("decisionJobs.view")(function* (row: Db.RequestRow) {
  return yield* decode(
    C.DecisionRequestView,
    yield* toJsonObject({
      ...row.body,
      status: row.status,
      reason: row.reason,
      result: row.result,
    }),
  );
});

const currentPolicy = Effect.fn("decisionJobs.policy")(function* (tx: Transaction, scope: Scope) {
  const row = (yield* Db.readPolicy(tx, scope.bookId, "document_kind"))[0];

  return row ? yield* decode(C.DecisionPolicy, row.body) : undefined;
});

const freeze = Effect.fn("decisionJobs.freeze")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  policy: Policy,
) {
  const retained = (yield* Db.readSubject(tx, scope.bookId, input.subject.id))[0];

  if (!retained) return yield* failure("NotFound");
  const draft = yield* decode(Drafts.SupplierInvoiceDraftRevision, retained.body);

  if (draft.revision !== input.subject.revision || draft.digest !== input.subject.digest)
    return yield* failure("StaleDependency");
  const source = (yield* Db.readEvidence(tx, scope.bookId, draft.content.sourceEvidenceId))[0];

  if (!source) return { skipped: "missing_input" } as const;
  const content = draft.content;

  if (content.counterpartyId === null) return { skipped: "missing_counterparty" } as const;

  const memory = yield* readFirmMemory(tx, {
    bookId: scope.bookId,
    counterpartyId: content.counterpartyId,
    documentKind: "supplier_invoice",
    currency: content.currency,
    currencyScale: content.currencyScale,
    description: content.lines.map((line) => line.description).join(" | "),
    amountMinor: content.sourceTotalMinor,
    excludeRelatedIds: [`draft:${draft.id}`, `evidence:${content.sourceEvidenceId}`],
  });

  const cutoffRows = yield* Db.readBookCutoff(tx, scope.bookId);
  const cutoff = cutoffRows[0]?.cutoff;

  if (cutoff === undefined) return yield* failure("InternalError");
  const definition = D.structuredDocumentKindDefinition;

  const state = yield* Schema.decodeUnknownEffect(Schema.Array(AiFinancialFact))([
    { kind: "date", value: content.documentDate },
    ...(content.supplyDate === null ? [] : [{ kind: "date", value: content.supplyDate }]),
    { kind: "amount", value: content.sourceTotalMinor },
    ...content.lines.flatMap((line) =>
      [line.baseMinor, line.taxMinor, line.sourceGrossMinor].flatMap((value) =>
        value === null ? [] : [{ kind: "amount", value }],
      ),
    ),
    ...memory.precedents.flatMap((precedent) =>
      precedent.amountMinor === null ? [] : [{ kind: "amount", value: precedent.amountMinor }],
    ),
  ]).pipe(Effect.mapError(() => failure("InvalidRequest")));

  if (state.length === 0) return { skipped: "missing_structured_input" } as const;

  const wire = {
    model: policy.requestedModel,
    state,
    questions: { document_kind: definition.question },
  };

  const admitted = D.parseRequest(wire);

  if (admitted.status !== "ready")
    return {
      skipped: admitted.status === "skipped" ? admitted.reason : "input_limit_or_invalid",
    } as const;

  const body = {
    id: newId("decision_request"),
    scope,
    subject: input.subject,
    question: { id: definition.id, version: definition.version, digest: yield* digest(definition) },
    builders: {
      state: definition.stateBuilder.version,
      options: definition.optionBuilder.version,
      precedent: memory.algorithmVersion,
    },
    originalCommitCutoff: cutoff,
    evidence: {
      sourceEvidenceId: content.sourceEvidenceId,
      sourceDigest: yield* digest(source),
      precedentHistoryDigest: memory.historyDigest,
      precedentDecisionIds: [
        ...new Set(memory.precedents.flatMap((precedent) => precedent.sourceDecisionIds)),
      ],
    },
    inputDigest: yield* digest(state),
    optionSetDigest: yield* digest({
      type: definition.question.type,
      criteria:
        definition.question.type === "noul"
          ? (definition.question.criteria ?? null)
          : definition.question.criteria,
    }),
    policy,
    input: admitted.request,
  };

  return {
    request: yield* decode(
      C.FrozenDecisionRequest,
      yield* toJsonObject({ ...body, digest: yield* digest(body) }),
    ),
  };
});

export const admitDecisionRequest = Effect.fn("decisionJobs.admit")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Input },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const policy = yield* currentPolicy(tx, command.scope);
      const existing = (yield* Db.readKey(tx, command.scope.bookId, command.idempotencyKey))[0];
      const admissionDigest = yield* digest({ actorId: principal.actorId, input: command.input });

      if (existing) {
        if (existing.admissionDigest !== admissionDigest)
          return yield* failure("IdempotencyConflict");
        const current = (yield* Db.readRequest(tx, command.scope.bookId, existing.id))[0];

        if (!current) return yield* failure("InternalError");

        return yield* decode(
          C.DecisionAdmission,
          yield* toJsonObject({
            status: "admitted",
            reason: null,
            request: yield* requestView(current),
          }),
        );
      }

      if (!policy || policy.mode === "off")
        return yield* decode(C.DecisionAdmission, { status: "off", reason: null, request: null });
      const frozen = yield* freeze(tx, command.scope, command.input, policy);

      if (frozen.skipped !== undefined)
        return yield* decode(C.DecisionAdmission, {
          status: "skipped",
          reason: frozen.skipped,
          request: null,
        });
      const body = frozen.request;
      yield* Db.insertRequest(tx, {
        bookId: command.scope.bookId,
        id: body.id,
        key: command.idempotencyKey,
        admissionDigest,
        actorId: principal.actorId,
        credentialHash: principal.kind === "apiCredential" ? principal.credentialHash : null,
        sessionId: principal.kind === "betterAuthSession" ? principal.sessionId : null,
        policyId: policy.id,
        body: yield* toJsonObject(body),
      });
      yield* Db.insertControl(tx, command.scope.bookId, body.id);
      const row = (yield* Db.readRequest(tx, command.scope.bookId, body.id))[0];

      if (!row) return yield* failure("InternalError");

      return yield* decode(
        C.DecisionAdmission,
        yield* toJsonObject({ status: "admitted", reason: null, request: yield* requestView(row) }),
      );
    },
    "update",
  );
});

export const getDecisionRequest = Effect.fn("decisionJobs.get")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const row = (yield* Db.readRequest(tx, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* requestView(row);
  });
});

const requireRunner = Effect.fn("decisionJobs.runner")(function* (token: string) {
  const { bindings } = yield* RequestEnvironment;
  const configured = bindings.OPENERP_DECISION_RUNNER_CREDENTIAL_HASH;

  if (!configured) return yield* failure("Unavailable");

  if (!/^[a-f0-9]{64}$/.test(configured)) return yield* failure("ConfigurationError");

  if ((yield* hashToken(token)) !== configured) return yield* failure("Forbidden");

  return bindings;
});

const staleReason = Effect.fn("decisionJobs.freshness")(function* (
  tx: Transaction,
  scope: Scope,
  row: Db.RequestRow,
  frozen: Frozen,
) {
  yield* Db.lockRequester(tx, scope.bookId, row);
  yield* Db.lockRequesterAdmission(tx, row);

  if (row.credentialHash !== null) yield* Db.lockRequesterCredential(tx, row);
  else yield* Db.lockRequesterSession(tx, row);

  if ((yield* Db.readRequester(tx, scope.bookId, row))[0]?.live !== true)
    return "requester_authority_changed";
  const policy = yield* currentPolicy(tx, scope);

  if (!policy || policy.mode !== "shadow" || policy.id !== frozen.policy.id)
    return "policy_changed";
  const retained = (yield* Db.readSubject(tx, scope.bookId, frozen.subject.id))[0];

  if (!retained) return "subject_changed";
  const draft = yield* decode(Drafts.SupplierInvoiceDraftRevision, retained.body);

  return draft.revision !== frozen.subject.revision || draft.digest !== frozen.subject.digest
    ? "subject_changed"
    : null;
});

const terminal = Effect.fn("decisionJobs.terminal")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  generation: number,
  status: string,
  reason: string | null,
  disclosed: boolean,
  reportedUsage?: typeof D.SystemOneResponse.Type.usage,
) {
  yield* Db.appendAttempt(tx, scope.bookId, id, generation, "terminal", {
    status,
    reason,
    usageStatus: reportedUsage ? "provider_reported" : disclosed ? "unknown" : "not_disclosed",
    usage: reportedUsage ?? null,
  });
  yield* Db.finish(tx, scope.bookId, id, generation, status, reason);
  const current = (yield* Db.readRequest(tx, scope.bookId, id))[0];

  if (!current) return yield* failure("InternalError");

  return yield* requestView(current);
});

type Claim = { request: Frozen; generation: number } | { view: typeof C.DecisionRequestView.Type };

const claim = Effect.fn("decisionJobs.claim")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* authorize(principal, "run_decision_request");
    const row = (yield* Db.readRequest(tx, command.scope.bookId, command.id, true))[0];

    if (!row) return yield* failure("NotFound");
    const frozen = yield* decode(C.FrozenDecisionRequest, row.body);

    if (row.status !== "ready" && row.status !== "running")
      return { view: yield* requestView(row) };

    if (row.status === "running" && !row.leaseExpired) return { view: yield* requestView(row) };

    if (row.disclosed)
      return {
        view: yield* terminal(
          tx,
          command.scope,
          command.id,
          row.generation,
          "uncertain",
          "disclosure_outcome_unknown",
          true,
        ),
      };
    const stale = yield* staleReason(tx, command.scope, row, frozen);

    if (stale !== null)
      return {
        view: yield* terminal(tx, command.scope, command.id, row.generation, "stale", stale, false),
      };

    const generation = (yield* Db.startAttempt(tx, command.scope.bookId, command.id))[0]
      ?.generation;

    if (generation === undefined) return yield* failure("InternalError");
    yield* Db.appendAttempt(tx, command.scope.bookId, command.id, generation, "claimed", {
      requestDigest: frozen.digest,
      policyId: frozen.policy.id,
    });

    return { request: frozen, generation };
  });
});

const saveValidatedResult = Effect.fn("decisionJobs.result")(function* (
  tx: Transaction,
  scope: Scope,
  request: Frozen,
  outcome: Extract<DecisionOutcome, { status: "validated" }>,
  generation: number,
) {
  const answer = outcome.response.answers.document_kind;
  const statistics = outcome.statistics.document_kind;

  if (!answer || answer.type !== "choice" || !statistics) return yield* failure("InternalError");

  const body = {
    id: newId("decision_result"),
    scope,
    subject: {
      owner: request.subject.owner,
      id: request.subject.id,
      revision: request.subject.revision,
    },
    question: request.question,
    inputDigest: request.inputDigest,
    optionSetDigest: request.optionSetDigest,
    modelRelease: outcome.identity.configuredRelease,
    requestedModel: outcome.identity.requestedModel,
    reportedModel: outcome.identity.reportedModel,
    inputTokenLimit: outcome.identity.inputTokenLimit,
    usage: outcome.response.usage,
    releaseQualification: outcome.identity.releaseQualification,
    status: "unreviewed_source_claim",
    answer,
    fullDistribution: answer.probabilities,
    statistics,
    wireEvidence: outcome.wireEvidence,
    requestDigest: request.digest,
  };

  const result = yield* decode(
    C.StoredDecisionResult,
    yield* toJsonObject({ ...body, digest: yield* digest(body) }),
  );

  return (
    (yield* Db.insertResult(
      tx,
      scope.bookId,
      request.id,
      result.id,
      yield* toJsonObject(result),
      generation,
    )).length === 1
  );
});

const finalize = Effect.fn("decisionJobs.finalize")(function* (
  token: string,
  command: { scope: Scope; id: string },
  claimed: Extract<Claim, { request: Frozen }>,
  outcome: DecisionOutcome,
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* authorize(principal, "publish_decision_result");
    const row = (yield* Db.readRequest(tx, command.scope.bookId, command.id, true))[0];

    if (!row) return yield* failure("NotFound");

    if (row.generation !== claimed.generation || row.status !== "running")
      return yield* requestView(row);

    if (row.leaseExpired)
      return yield* terminal(
        tx,
        command.scope,
        command.id,
        row.generation,
        row.disclosed ? "uncertain" : "stale",
        row.disclosed ? "lease_expired_after_dispatch_intent" : "lease_expired_before_dispatch",
        row.disclosed,
      );
    const stale = yield* staleReason(tx, command.scope, row, claimed.request);
    const refreshed = (yield* Db.readRequest(tx, command.scope.bookId, command.id))[0];

    if (!refreshed || refreshed.leaseExpired)
      return yield* terminal(
        tx,
        command.scope,
        command.id,
        row.generation,
        row.disclosed ? "uncertain" : "stale",
        row.disclosed ? "lease_expired_after_dispatch_intent" : "lease_expired_before_dispatch",
        row.disclosed,
      );

    if (stale !== null)
      return yield* terminal(
        tx,
        command.scope,
        command.id,
        row.generation,
        "stale",
        stale,
        row.disclosed,
      );

    if (outcome.status !== "validated")
      return yield* terminal(
        tx,
        command.scope,
        command.id,
        row.generation,
        row.disclosed &&
          ["timeout", "aborted", "network_error", "binding_error"].includes(outcome.code)
          ? "uncertain"
          : "failed",
        outcome.code,
        row.disclosed,
      );

    if (
      outcome.identity.configuredRelease !== claimed.request.policy.modelRelease ||
      outcome.identity.inputTokenLimit !== claimed.request.policy.inputTokenLimit ||
      outcome.identity.requestedModel !== claimed.request.policy.requestedModel ||
      outcome.identity.reportedModel !== claimed.request.policy.expectedReportedModel
    )
      return yield* terminal(
        tx,
        command.scope,
        command.id,
        row.generation,
        "failed",
        "model_identity_changed",
        row.disclosed,
      );

    const saved = yield* saveValidatedResult(
      tx,
      command.scope,
      claimed.request,
      outcome,
      claimed.generation,
    );

    if (!saved)
      return yield* terminal(
        tx,
        command.scope,
        command.id,
        row.generation,
        row.disclosed ? "uncertain" : "stale",
        row.disclosed ? "lease_expired_after_dispatch_intent" : "lease_expired_before_dispatch",
        row.disclosed,
      );

    return yield* terminal(
      tx,
      command.scope,
      command.id,
      row.generation,
      "validated",
      null,
      row.disclosed,
      outcome.response.usage,
    );
  });
});

const markDispatch = Effect.fn("decisionJobs.dispatchIntent")(function* (
  token: string,
  command: { scope: Scope; id: string },
  claimed: Extract<Claim, { request: Frozen }>,
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* authorize(principal, "run_decision_request");
    const row = (yield* Db.readRequest(tx, command.scope.bookId, command.id, true))[0];

    if (!row || row.generation !== claimed.generation || row.status !== "running" || row.disclosed)
      return yield* failure("StaleDependency");
    const stale = yield* staleReason(tx, command.scope, row, claimed.request);
    const refreshed = (yield* Db.readRequest(tx, command.scope.bookId, command.id))[0];

    if (stale !== null || !refreshed || refreshed.leaseExpired)
      return yield* failure("StaleDependency");

    const marked = yield* Db.markDisclosure(
      tx,
      command.scope.bookId,
      command.id,
      claimed.generation,
    );

    if (marked.length !== 1) return yield* failure("StaleDependency");
    yield* Db.appendAttempt(tx, command.scope.bookId, command.id, claimed.generation, "disclosed", {
      requestDigest: claimed.request.digest,
      dispatchIntent: true,
      transportConfirmed: false,
      usageStatus: "unknown",
      usage: null,
    });
  });
});

export const processDecisionRequest = Effect.fn("decisionJobs.process")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  const bindings = yield* requireRunner(token);

  const model =
    bindings.DECISION_FIXTURE_MODEL ??
    (bindings.OPENERP_DECISION_MODEL === "local-systemone-fixture"
      ? (bindings.DECISION_MODEL ?? configuredDecisionModel(bindings))
      : undefined);

  if (!model) return yield* failure("Unavailable");
  const claimed: Claim = yield* claim(token, command);

  if ("view" in claimed) return claimed.view;

  if (
    model.identity.configuredRelease !== claimed.request.policy.modelRelease ||
    model.identity.inputTokenLimit !== claimed.request.policy.inputTokenLimit ||
    model.identity.requestedModel !== claimed.request.policy.requestedModel ||
    model.identity.expectedReportedModel !== claimed.request.policy.expectedReportedModel
  )
    return yield* finalize(token, command, claimed, {
      status: "failed",
      code: "model_mismatch",
      diagnostic: null,
    });

  const db = yield* Database;
  const environment = yield* RequestEnvironment;
  const egress = yield* openAiEgress(token, command.scope, "decision");

  const outcome = yield* Effect.tryPromise({
    try: (signal) =>
      model.decide(claimed.request.input, egress, signal, () =>
        Effect.runPromise(
          markDispatch(token, command, claimed).pipe(
            Effect.provideService(Database, db),
            Effect.provideService(RequestEnvironment, environment),
          ),
        ),
      ),
    catch: () => failure("Unavailable"),
  }).pipe(
    Effect.catch(() =>
      Effect.succeed({ status: "failed", code: "network_error", diagnostic: null } as const),
    ),
  );

  return yield* finalize(token, command, claimed, outcome);
});

export const pendingDecisionRequests = Effect.fn("decisionJobs.pending")(function* (token: string) {
  yield* requireRunner(token);

  return yield* withTransaction((tx) =>
    Effect.gen(function* () {
      const actorId = yield* admitRunnerActor(tx, token);

      return yield* Db.pending(tx, actorId);
    }),
  );
});

export const stopFailedDecisionRequest = Effect.fn("decisionJobs.stopDelivery")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  yield* requireRunner(token);

  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* authorize(principal, "publish_decision_result");
    const row = (yield* Db.readRequest(tx, command.scope.bookId, command.id, true))[0];

    if (!row) return yield* failure("NotFound");

    if (row.status !== "ready" && row.status !== "running") return yield* requestView(row);

    if (row.status === "running" && !row.leaseExpired) return yield* requestView(row);

    return yield* terminal(
      tx,
      command.scope,
      command.id,
      row.generation,
      row.disclosed ? "uncertain" : "failed",
      "queue_delivery_failed",
      row.disclosed,
    );
  });
});

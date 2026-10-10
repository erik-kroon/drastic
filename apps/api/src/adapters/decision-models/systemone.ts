import * as D from "@open-erp/domain/decisions";
import { assertBoundedJsonValue, BoundedJsonError, readBoundedJson } from "../bounded-json";
import * as Schema from "effect/Schema";
import {
  AiEgressError,
  AiState,
  requireAiEgress,
  type AiEgress,
  type AiProvider,
  type IdentityRegistry,
} from "../ai-egress";

export type WorkersAiSelector = "@cf/cloudflare/clef" | "@cf/cloudflare/clef-flash";

export interface WorkersAi {
  run(selector: WorkersAiSelector, input: D.SystemOneRequest): Promise<unknown>;
}

export interface DecisionIdentity {
  readonly provider: "http-systemone" | "workers-ai";
  readonly configuredRelease: string;
  readonly inputTokenLimit: number;
  readonly requestedModel: string;
  readonly expectedReportedModel: string;
  readonly workersAiSelector: WorkersAiSelector | null;
  readonly releaseQualification: "unsubstantiated";
  readonly egressPolicy: AiProvider;
}

type FailureCode =
  | "timeout"
  | "aborted"
  | "rate_limited"
  | "http_error"
  | "response_size"
  | "response_json"
  | "model_mismatch"
  | "invalid_response"
  | "invalid_request"
  | "network_error"
  | "binding_error"
  | "egress_refused"
  | "state_limit";

export type DecisionOutcome =
  | {
      readonly status: "validated";
      readonly claimStatus: "unreviewed_source_claim";
      readonly identity: DecisionIdentity & { readonly reportedModel: string };
      readonly response: D.SystemOneResponse;
      readonly tokens: IdentityRegistry;
      readonly statistics: Readonly<Record<string, D.Statistics>>;
      readonly wireEvidence: "bounded_utf8_unique_keys" | "already_parsed_object";
    }
  | { readonly status: "failed"; readonly code: FailureCode; readonly diagnostic: string | null };

export interface DecisionModel {
  readonly identity: DecisionIdentity;
  decide(
    request: D.SystemOneRequest,
    egress: AiEgress,
    signal?: AbortSignal,
    beforeDispatch?: () => Promise<void>,
  ): Promise<DecisionOutcome>;
}

class DecisionAdapterError extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

type Transport =
  | { readonly kind: "http"; readonly endpoint: URL; readonly key?: string }
  | { readonly kind: "binding"; readonly binding: WorkersAi; readonly selector: WorkersAiSelector };

async function dispatch(transport: Transport, request: D.SystemOneRequest, signal: AbortSignal) {
  if (transport.kind === "binding") {
    const raw = await transport.binding.run(transport.selector, request);
    assertBoundedJsonValue(raw);

    return raw;
  }

  const headers = new Headers({ "content-type": "application/json" });

  if (transport.key) headers.set("authorization", `Bearer ${transport.key}`);

  const response = await fetch(transport.endpoint, {
    method: "POST",
    redirect: "error",
    signal,
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    await response.body?.cancel();

    throw new DecisionAdapterError(response.status === 429 ? "rate_limited" : "http_error");
  }

  return readBoundedJson(response);
}

export function systemOneModel(
  identity: DecisionIdentity,
  transport: Transport,
  timeoutMs: number,
): DecisionModel {
  if (!Number.isSafeInteger(identity.inputTokenLimit) || identity.inputTokenLimit < 1)
    throw new Error("Decision model input token limit must be a positive safe integer.");

  if (
    identity.egressPolicy.modelRelease !== identity.configuredRelease ||
    identity.egressPolicy.provider !== identity.provider ||
    identity.egressPolicy.destination !==
      (transport.kind === "http" ? transport.endpoint.origin : transport.selector) ||
    (identity.egressPolicy.policy === "local-fixture" &&
      !(
        transport.kind === "http" &&
        transport.endpoint.protocol === "http:" &&
        transport.endpoint.hostname === "127.0.0.1"
      ))
  )
    throw new AiEgressError();

  return {
    identity,
    async decide(request, egress, callerSignal, beforeDispatch) {
      const admitted = D.parseRequest({
        ...request,
        state: Schema.is(AiState)(request.state) ? JSON.stringify(request.state) : request.state,
      });

      if (admitted.status !== "ready" || request.model !== identity.requestedModel)
        return { status: "failed", code: "invalid_request", diagnostic: null };

      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > identity.inputTokenLimit)
        return { status: "failed", code: "state_limit", diagnostic: null };

      if (callerSignal?.aborted) return { status: "failed", code: "aborted", diagnostic: null };

      const controller = new AbortController();
      const callerAbort = () => controller.abort("caller");
      callerSignal?.addEventListener("abort", callerAbort, { once: true });
      const timer = setTimeout(() => controller.abort("deadline"), timeoutMs);
      let abortListener: () => void = () => {};

      const stopped = new Promise<never>((_, reject) => {
        abortListener = () =>
          reject(
            new DecisionAdapterError(
              controller.signal.reason === "deadline" ? "timeout" : "aborted",
            ),
          );
        controller.signal.addEventListener("abort", abortListener, { once: true });
      });

      try {
        const boundary = requireAiEgress(egress);

        const invoke = async () => {
          const captured = await boundary.structured(
            identity.egressPolicy,
            Schema.decodeUnknownSync(Schema.Json)(request),
            Schema.is(AiState)(request.state) && request.state.some((part) => part.kind !== "text")
              ? ["free_text", "financial_facts"]
              : ["free_text"],
          );

          const outgoing = D.parseRequest(captured.payload);

          if (outgoing.status !== "ready" || outgoing.request.model !== identity.requestedModel)
            throw new AiEgressError();

          if (
            new TextEncoder().encode(JSON.stringify(outgoing.request)).byteLength >
            identity.inputTokenLimit
          )
            throw new DecisionAdapterError("state_limit");

          if (controller.signal.aborted)
            throw new DecisionAdapterError(
              controller.signal.reason === "deadline" ? "timeout" : "aborted",
            );

          await beforeDispatch?.();

          if (controller.signal.aborted)
            throw new DecisionAdapterError(
              controller.signal.reason === "deadline" ? "timeout" : "aborted",
            );
          const raw = await dispatch(transport, outgoing.request, controller.signal);
          captured.registry.assertOutput(Schema.decodeUnknownSync(Schema.Json)(raw));

          return { raw, request: outgoing.request, tokens: captured.registry };
        };

        const completed = await Promise.race([invoke(), stopped]);

        const validated = D.validateResponse(
          completed.request,
          completed.raw,
          identity.expectedReportedModel,
        );

        if (validated.status === "refused") {
          return {
            status: "failed",
            code: validated.reason === "model_identity" ? "model_mismatch" : "invalid_response",
            diagnostic: validated.reason,
          };
        }

        if (validated.response.usage.input_tokens >= identity.inputTokenLimit)
          return { status: "failed", code: "state_limit", diagnostic: null };

        return {
          status: "validated",
          claimStatus: "unreviewed_source_claim",
          identity: { ...identity, reportedModel: validated.response.model },
          response: validated.response,
          tokens: completed.tokens,
          statistics: validated.statistics,
          wireEvidence:
            transport.kind === "http" ? "bounded_utf8_unique_keys" : "already_parsed_object",
        };
      } catch (error) {
        if (error instanceof AiEgressError)
          return { status: "failed", code: "egress_refused", diagnostic: null };

        if (error instanceof DecisionAdapterError)
          return { status: "failed", code: error.code, diagnostic: null };

        if (error instanceof BoundedJsonError)
          return {
            status: "failed",
            code: error.kind === "size" ? "response_size" : "response_json",
            diagnostic: null,
          };

        return {
          status: "failed",
          code: transport.kind === "http" ? "network_error" : "binding_error",
          diagnostic: null,
        };
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", callerAbort);
        controller.signal.removeEventListener("abort", abortListener);
      }
    },
  };
}

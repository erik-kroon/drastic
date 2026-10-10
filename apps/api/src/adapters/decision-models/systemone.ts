import * as D from "@open-erp/domain/decisions";
import { assertBoundedJsonValue, BoundedJsonError, readBoundedJson } from "../bounded-json";

export type WorkersAiSelector = "@cf/cloudflare/clef" | "@cf/cloudflare/clef-flash";

export interface WorkersAi {
  run(selector: WorkersAiSelector, input: D.SystemOneRequest): Promise<unknown>;
}

export interface DecisionIdentity {
  readonly provider: "http-systemone" | "workers-ai";
  readonly configuredRelease: string;
  readonly requestedModel: string;
  readonly expectedReportedModel: string;
  readonly workersAiSelector: WorkersAiSelector | null;
  readonly releaseQualification: "unsubstantiated";
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
  | "binding_error";

export type DecisionOutcome =
  | {
      readonly status: "validated";
      readonly claimStatus: "unreviewed_source_claim";
      readonly identity: DecisionIdentity & { readonly reportedModel: string };
      readonly response: D.SystemOneResponse;
      readonly statistics: Readonly<Record<string, D.Statistics>>;
      readonly wireEvidence: "bounded_utf8_unique_keys" | "already_parsed_object";
    }
  | { readonly status: "failed"; readonly code: FailureCode; readonly diagnostic: string | null };

export interface DecisionModel {
  readonly identity: DecisionIdentity;
  decide(request: D.SystemOneRequest, signal?: AbortSignal): Promise<DecisionOutcome>;
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
  return {
    identity,
    async decide(request, callerSignal) {
      const admitted = D.parseRequest(request);

      if (admitted.status !== "ready" || request.model !== identity.requestedModel)
        return { status: "failed", code: "invalid_request", diagnostic: null };

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
        const raw = await Promise.race([
          dispatch(transport, admitted.request, controller.signal),
          stopped,
        ]);

        const validated = D.validateResponse(admitted.request, raw, identity.expectedReportedModel);

        if (validated.status === "refused") {
          return {
            status: "failed",
            code: validated.reason === "model_identity" ? "model_mismatch" : "invalid_response",
            diagnostic: validated.reason,
          };
        }

        return {
          status: "validated",
          claimStatus: "unreviewed_source_claim",
          identity: { ...identity, reportedModel: validated.response.model },
          response: validated.response,
          statistics: validated.statistics,
          wireEvidence:
            transport.kind === "http" ? "bounded_utf8_unique_keys" : "already_parsed_object",
        };
      } catch (error) {
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

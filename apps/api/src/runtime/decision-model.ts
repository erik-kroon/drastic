import {
  systemOneModel,
  type DecisionModel,
  type WorkersAi,
  type DecisionIdentity,
} from "../adapters/decision-models/systemone";

export interface DecisionModelConfiguration {
  readonly OPENERP_DECISION_MODEL?: string;
  readonly OPENERP_DECISION_MODEL_RELEASE?: string;
  readonly OPENERP_DECISION_MODEL_SELECTOR?: string;
  readonly OPENERP_DECISION_MODEL_REPORTED_MODEL?: string;
  readonly OPENERP_DECISION_MODEL_ENDPOINT?: string;
  readonly OPENERP_DECISION_MODEL_KEY?: string;
  readonly OPENERP_DECISION_MODEL_TIMEOUT_MS?: string;
}

type Configuration = DecisionModelConfiguration | Readonly<Record<string, string | undefined>>;

export function configuredDecisionModel(
  config: Configuration,
  binding?: WorkersAi,
): DecisionModel | undefined {
  const mode = config.OPENERP_DECISION_MODEL ?? "disabled";

  if (mode === "disabled") return undefined;

  if (
    !["local-systemone-fixture", "typesafe-jev", "self-hosted-clef", "workers-ai-clef"].includes(
      mode,
    )
  )
    throw new Error("Unsupported decision model configuration.");

  const configuredRelease = config.OPENERP_DECISION_MODEL_RELEASE?.trim();

  if (!configuredRelease) throw new Error("An explicit decision model release is required.");

  const timeoutMs = Number(config.OPENERP_DECISION_MODEL_TIMEOUT_MS ?? "15000");

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new Error("Decision model deadline must be 1–60000 milliseconds.");

  const requestedModel =
    config.OPENERP_DECISION_MODEL_SELECTOR?.trim() ??
    (mode === "workers-ai-clef" ? "clef-flash" : configuredRelease);

  const expectedReportedModel =
    config.OPENERP_DECISION_MODEL_REPORTED_MODEL?.trim() ?? requestedModel;

  if (!requestedModel || !expectedReportedModel)
    throw new Error("Decision model identities cannot be empty.");

  if (mode === "workers-ai-clef") {
    if (!binding) throw new Error("Workers AI decision mode requires an injected AI binding.");

    if (requestedModel !== "clef" && requestedModel !== "clef-flash")
      throw new Error("Workers AI decision mode requires a documented Clef selector.");

    const selector = `@cf/cloudflare/${requestedModel}` as const;

    return systemOneModel(
      {
        provider: "workers-ai",
        configuredRelease,
        requestedModel,
        expectedReportedModel,
        workersAiSelector: selector,
        releaseQualification: "unsubstantiated",
      },
      { kind: "binding", binding, selector },
      timeoutMs,
    );
  }

  const transport = configuredHttpTransport(config, mode);

  const identity: DecisionIdentity = {
    provider: "http-systemone",
    configuredRelease,
    requestedModel,
    expectedReportedModel,
    workersAiSelector: null,
    releaseQualification: "unsubstantiated",
  };

  return systemOneModel(identity, transport, timeoutMs);
}

function configuredHttpTransport(config: Configuration, mode: string) {
  const endpoint =
    config.OPENERP_DECISION_MODEL_ENDPOINT ??
    (mode === "typesafe-jev" ? "https://api.typesafe.ai/v1/systemone" : undefined);

  if (!endpoint) throw new Error("Decision model endpoint is required.");

  const url = new URL(endpoint);

  if (url.username || url.password || url.search || url.hash)
    throw new Error("Decision endpoints cannot carry credentials, query parameters or fragments.");

  const key = config.OPENERP_DECISION_MODEL_KEY?.trim();

  if (mode === "local-systemone-fixture") {
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
      throw new Error("The decision fixture must use HTTP on IPv4 loopback.");
  } else if (url.protocol !== "https:" || !key) {
    throw new Error("Live decision models require HTTPS and a configured credential.");
  }

  return {
    kind: "http" as const,
    endpoint: url,
    key: mode === "local-systemone-fixture" ? undefined : key,
  };
}

import type { AiProvider } from "../adapters/ai-egress";

export interface AiEgressConfiguration {
  readonly OPENERP_AI_EGRESS_POLICY?: string;
  readonly OPENERP_AI_EGRESS_APPROVAL?: string;
}

export function configuredAiProvider(
  config: AiEgressConfiguration,
  provider: string,
  modelRelease: string,
  local: boolean,
  destination: string,
): AiProvider {
  if (local)
    return {
      provider,
      destination,
      modelRelease,
      policy: "local-fixture",
      approval: "synthetic-only",
    };

  const policy = config.OPENERP_AI_EGRESS_POLICY;
  const approval = config.OPENERP_AI_EGRESS_APPROVAL?.trim();

  if (
    (policy !== "eu-no-training-no-retention" && policy !== "self-hosted") ||
    !approval ||
    approval.length > 200
  )
    throw new Error("Live AI requires an explicit data policy and its approval reference.");

  return { provider, destination, modelRelease, policy, approval };
}

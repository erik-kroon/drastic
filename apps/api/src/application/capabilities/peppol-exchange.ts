import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../commerce/peppol-exchange";

export const peppolExchangeCapabilities = {
  commerce_register_peppol_binding: effectCapability(
    Capabilities.commerce_register_peppol_binding,
    Owner.registerPeppolBinding,
  ),
  commerce_get_peppol_binding: effectCapability(
    Capabilities.commerce_get_peppol_binding,
    (token, command) => Owner.getPeppolBinding(token, command.scope, command.id),
  ),
  commerce_prepare_peppol_artifact: effectCapability(
    Capabilities.commerce_prepare_peppol_artifact,
    Owner.preparePeppolArtifact,
  ),
  commerce_get_peppol_artifact: effectCapability(
    Capabilities.commerce_get_peppol_artifact,
    (token, command) => Owner.getPeppolArtifact(token, command.scope, command.id),
  ),
  commerce_approve_peppol_exchange: effectCapability(
    Capabilities.commerce_approve_peppol_exchange,
    Owner.approvePeppolExchange,
  ),
  commerce_dispatch_peppol_exchange: effectCapability(
    Capabilities.commerce_dispatch_peppol_exchange,
    Owner.dispatchPeppolExchange,
  ),
  commerce_get_peppol_attempt: effectCapability(
    Capabilities.commerce_get_peppol_attempt,
    (token, command) => Owner.getPeppolAttempt(token, command.scope, command.id),
  ),
  commerce_collect_peppol_outcome: effectCapability(
    Capabilities.commerce_collect_peppol_outcome,
    Owner.collectPeppolOutcome,
  ),
  commerce_receive_peppol_envelope: effectCapability(
    Capabilities.commerce_receive_peppol_envelope,
    Owner.receivePeppolEnvelope,
  ),
  commerce_get_peppol_inbound: effectCapability(
    Capabilities.commerce_get_peppol_inbound,
    (token, command) => Owner.getPeppolInbound(token, command.scope, command.id),
  ),
};

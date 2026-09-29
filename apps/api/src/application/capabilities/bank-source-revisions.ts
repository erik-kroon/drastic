import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { readProviderObservation } from "../banking/source-revisions";

// Read-only agent surface for provider revisions. An agent may ask what one
// provider transaction identity resolves to, which observation it was
// admitted as, and which cases are open. It may not interpret a revision or
// admit an observation: interpreting one commits the interpretation of exact
// money from retained provider bytes, and admitting one records that two
// retained records are the same economic event, which is a reviewed human
// decision with cited evidence.
export const bankingSourceRevisionCapabilities = {
  banking_read_provider_observation: effectCapability(
    Capabilities.banking_read_provider_observation,
    (token, input) =>
      readProviderObservation(token, {
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
      }),
  ),
};

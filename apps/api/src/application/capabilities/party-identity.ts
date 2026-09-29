import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { readDirectoryBalances } from "../commerce/party-identity";

// Read-only agent surface for NEXT-27 balance views. An agent may ask how
// retained open obligations group under a saved resolution, and may reach
// every obligation and its control account. It may not prepare a resolution:
// recording that two parties are the same legal entity is a reviewed human
// decision with cited evidence, not an agent inference from similar names.
export const partyIdentityCapabilities = {
  directory_read_balances: effectCapability(Capabilities.directory_read_balances, (token, input) =>
    readDirectoryBalances(token, input),
  ),
};

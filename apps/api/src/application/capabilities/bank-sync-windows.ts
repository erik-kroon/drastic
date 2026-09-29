import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { readSyncWindow } from "../banking/sync-windows";

// Read-only agent surface for the connector sync window. An agent may ask what
// a stream has actually published, whether a window is resumable and from
// which cursor, and whether the staged changes are canonical. It may not
// claim a window, stage a page or publish a generation: those three are the
// claims that decide what becomes a reviewed bank observation, and a lease is
// not something a second agent process may take.
export const bankingSyncCapabilities = {
  banking_read_sync_window: effectCapability(
    Capabilities.banking_read_sync_window,
    (token, input) =>
      readSyncWindow(token, {
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
      }),
  ),
};

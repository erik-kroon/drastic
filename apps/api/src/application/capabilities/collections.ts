import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  readHistoryPage as readCollectionHistoryPage,
  readStatementExport,
  readWorklist,
} from "../commerce/collections";

import { prepareReminder, readReminder } from "../commerce/reminders";

export const collectionsCapabilities = {
  collections_prepare_reminder: effectCapability(
    Capabilities.collections_prepare_reminder,
    (token, input) =>
      prepareReminder(token, {
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        input: { issueId: input.issueId, recipient: input.recipient },
      }),
  ),
  collections_read_reminder: effectCapability(
    Capabilities.collections_read_reminder,
    (token, input) => readReminder(token, { scope: input.scope, id: input.reminderId }),
  ),
  collections_worklist: effectCapability(Capabilities.collections_worklist, (token, input) =>
    readWorklist(token, { scope: input.scope, page: input.page ?? "1" }),
  ),
  collections_statement_export: effectCapability(
    Capabilities.collections_statement_export,
    (token, input) => readStatementExport(token, { scope: input.scope, id: input.statementId }),
  ),
  collections_history: effectCapability(Capabilities.collections_history, (token, input) =>
    readCollectionHistoryPage(token, {
      scope: input.scope,
      id: input.customerId,
      after: input.after ?? "",
    }),
  ),
};

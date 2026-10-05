import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../banking/processor-clearing";

export const processorClearingCapabilities = {
  banking_register_processor_native_credit: effectCapability(
    Capabilities.banking_register_processor_native_credit,
    Owner.registerProcessorNativeCredit,
  ),
  banking_register_processor_account: effectCapability(
    Capabilities.banking_register_processor_account,
    Owner.registerProcessorAccount,
  ),
  banking_fetch_processor_observations: effectCapability(
    Capabilities.banking_fetch_processor_observations,
    Owner.fetchProcessorObservations,
  ),
  banking_prepare_processor_clearing: effectCapability(
    Capabilities.banking_prepare_processor_clearing,
    Owner.prepareProcessorClearing,
  ),
  banking_approve_processor_clearing: effectCapability(
    Capabilities.banking_approve_processor_clearing,
    Owner.approveProcessorClearing,
  ),
  banking_execute_processor_clearing: effectCapability(
    Capabilities.banking_execute_processor_clearing,
    Owner.executeProcessorClearing,
  ),
  banking_get_processor_account: effectCapability(
    Capabilities.banking_get_processor_account,
    (token, command) => Owner.getProcessorAccount(token, command.scope, command.accountId),
  ),
  banking_get_processor_review: effectCapability(
    Capabilities.banking_get_processor_review,
    (token, command) => Owner.getProcessorReview(token, command.scope, command.reviewId),
  ),
  banking_get_processor_fetch: effectCapability(
    Capabilities.banking_get_processor_fetch,
    (token, command) => Owner.getProcessorFetch(token, command.scope, command.fetchId),
  ),
  banking_reconcile_processor_clearing: effectCapability(
    Capabilities.banking_reconcile_processor_clearing,
    (token, command) =>
      Owner.reconcileProcessorClearing(token, command.scope, command.accountId, command.fetchId),
  ),
};

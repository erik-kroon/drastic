import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  compareDrafts,
  getAmendment,
  getDraft,
  getFact,
  listAmendments,
  listDrafts,
  recoverReclassification,
  returnBasis,
} from "../vat/returns";
import { getReclassification, listReclassifications } from "../vat/reclassification";
import {
  getActualReturn,
  listActualReturns,
  prepareActualReturn,
} from "../vat/actual-return";
import { prepareVatDraft } from "../vat-returns";
import {
  getSnapshot,
  getSource,
  inventory,
  listSnapshots,
  prepareSnapshot,
  recordSource,
} from "../vat/expense-tax";

export const vatCapabilities = {
  vat_return_get_reclassification: effectCapability(
    Capabilities.vat_return_get_reclassification,
    (token, input) => getReclassification(token, { scope: input.scope, id: input.reviewId }),
  ),
  vat_return_list_reclassifications: effectCapability(
    Capabilities.vat_return_list_reclassifications,
    listReclassifications,
  ),
  vat_return_recover_reclassification: effectCapability(
    Capabilities.vat_return_recover_reclassification,
    recoverReclassification,
  ),
  vat_return_compare_drafts: effectCapability(
    Capabilities.vat_return_compare_drafts,
    compareDrafts,
  ),
  vat_return_get_amendment: effectCapability(
    Capabilities.vat_return_get_amendment,
    (token, input) => getAmendment(token, { scope: input.scope, id: input.amendmentId }),
  ),
  vat_return_list_amendments: effectCapability(
    Capabilities.vat_return_list_amendments,
    listAmendments,
  ),
  vat_return_basis: effectCapability(Capabilities.vat_return_basis, returnBasis),
  vat_return_get_fact: effectCapability(Capabilities.vat_return_get_fact, (token, input) =>
    getFact(token, { scope: input.scope, id: input.factId }),
  ),
  vat_return_prepare_draft: effectCapability(
    Capabilities.vat_return_prepare_draft,
    prepareVatDraft,
  ),
  vat_return_get_draft: effectCapability(Capabilities.vat_return_get_draft, (token, input) =>
    getDraft(token, { scope: input.scope, id: input.draftId }),
  ),
  vat_return_list_drafts: effectCapability(Capabilities.vat_return_list_drafts, listDrafts),
  vat_return_prepare_actual: effectCapability(
    Capabilities.vat_return_prepare_actual,
    prepareActualReturn,
  ),
  vat_return_get_actual: effectCapability(Capabilities.vat_return_get_actual, (token, input) =>
    getActualReturn(token, { scope: input.scope, id: input.returnId }),
  ),
  vat_return_list_actuals: effectCapability(Capabilities.vat_return_list_actuals, listActualReturns),
  expense_tax_record_source: effectCapability(Capabilities.expense_tax_record_source, recordSource),
  expense_tax_inventory: effectCapability(Capabilities.expense_tax_inventory, inventory),
  expense_tax_get_source: effectCapability(Capabilities.expense_tax_get_source, (token, input) =>
    getSource(token, { scope: input.scope, id: input.sourceId }),
  ),
  expense_tax_prepare_snapshot: effectCapability(
    Capabilities.expense_tax_prepare_snapshot,
    prepareSnapshot,
  ),
  expense_tax_get_snapshot: effectCapability(
    Capabilities.expense_tax_get_snapshot,
    (token, input) => getSnapshot(token, { scope: input.scope, id: input.snapshotId }),
  ),
  expense_tax_list_snapshots: effectCapability(
    Capabilities.expense_tax_list_snapshots,
    listSnapshots,
  ),
};

import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  createEvidence,
  executeChange,
  getChange,
  getEvidence,
  getReceipt,
  getVoucher,
  ledgerSnapshot,
  listVouchers,
  prepareCorrection,
  prepareJournal,
  validateChange,
} from "../posting";
import {
  executeCorrectionBundle,
  getCorrectionBundle,
  getCorrectionBundleForVoucher,
  getCorrectionChain,
  getCorrectionImpact,
  listCorrectionBundles,
  prepareCorrectionBundle,
  prepareCorrectionImpact,
  recoverCorrectionRequest,
} from "../posting-corrections";
import {
  getPostingRecovery,
  getSavedPostingRequest,
  listPostingRecovery,
  listSavedPostingRequests,
  recoverPostingRequest,
  runPostingRequest,
  savePostingRequest,
} from "../posting-recovery";

export const ledgerCapabilities = {
  posting_save_request: effectCapability(Capabilities.posting_save_request, savePostingRequest),
  posting_run_request: effectCapability(Capabilities.posting_run_request, runPostingRequest),
  posting_get_saved_request: effectCapability(
    Capabilities.posting_get_saved_request,
    getSavedPostingRequest,
  ),
  posting_list_saved_requests: effectCapability(
    Capabilities.posting_list_saved_requests,
    listSavedPostingRequests,
  ),
  corrections_review_impact: effectCapability(
    Capabilities.corrections_review_impact,
    prepareCorrectionImpact,
  ),
  corrections_get_impact: effectCapability(
    Capabilities.corrections_get_impact,
    getCorrectionImpact,
  ),
  corrections_chain: effectCapability(Capabilities.corrections_chain, getCorrectionChain),
  corrections_list: effectCapability(Capabilities.corrections_list, listCorrectionBundles),
  corrections_recover_request: effectCapability(
    Capabilities.corrections_recover_request,
    recoverCorrectionRequest,
  ),
  corrections_prepare: effectCapability(Capabilities.corrections_prepare, prepareCorrectionBundle),
  corrections_get: effectCapability(Capabilities.corrections_get, getCorrectionBundle),
  corrections_for_voucher: effectCapability(
    Capabilities.corrections_for_voucher,
    getCorrectionBundleForVoucher,
  ),
  corrections_execute: effectCapability(Capabilities.corrections_execute, executeCorrectionBundle),
  posting_list_recovery: effectCapability(Capabilities.posting_list_recovery, listPostingRecovery),
  posting_get_recovery: effectCapability(Capabilities.posting_get_recovery, getPostingRecovery),
  posting_recover_request: effectCapability(
    Capabilities.posting_recover_request,
    recoverPostingRequest,
  ),
  evidence_create: effectCapability(Capabilities.evidence_create, createEvidence),
  evidence_get: effectCapability(Capabilities.evidence_get, getEvidence),
  ledger_prepare_journal: effectCapability(Capabilities.ledger_prepare_journal, prepareJournal),
  changes_get: effectCapability(Capabilities.changes_get, getChange),
  changes_validate: effectCapability(Capabilities.changes_validate, validateChange),
  changes_execute: effectCapability(Capabilities.changes_execute, executeChange),
  ledger_prepare_correction: effectCapability(
    Capabilities.ledger_prepare_correction,
    prepareCorrection,
  ),
  ledger_get_voucher: effectCapability(Capabilities.ledger_get_voucher, getVoucher),
  ledger_list: effectCapability(Capabilities.ledger_list, listVouchers),
  ledger_snapshot: effectCapability(Capabilities.ledger_snapshot, ledgerSnapshot),
  receipts_get: effectCapability(Capabilities.receipts_get, getReceipt),
};

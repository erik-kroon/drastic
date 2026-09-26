import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  getBasis as getSubledgerBasis,
  listBases as listSubledgerBases,
  listControls as listSubledgerControls,
  createControl as createSubledgerControl,
  getControl as getSubledgerControl,
} from "../subledger/controls";
import {
  createSchedule as createSubledgerSchedule,
  getSchedule as getSubledgerSchedule,
  listSchedules as listSubledgerSchedules,
  prepareScheduleOccurrence as prepareSubledgerOccurrence,
  reviseSchedule as reviseSubledgerSchedule,
} from "../subledger/schedules";
import {
  applyAllocation as applyOwnerAllocation,
  attachPostedLine as attachOwnerPostedLine,
  attachProposal as attachOwnerProposal,
  createOwner as createOwnerIdentity,
  createRecord as createOwnerRecord,
  getAllocation as getOwnerAllocation,
  getControl as getOwnerControl,
  getOwner as getOwnerIdentity,
  getRecord as getOwnerRecord,
  listOwners as listOwnerIdentities,
  listRecords as listOwnerRecords,
  prepareAllocation as prepareOwnerAllocation,
  prepareControl as prepareOwnerControl,
  recordHistory as ownerRecordHistory,
  recoverCommand as recoverOwnerCommand,
  reviseRecord as reviseOwnerRecord,
} from "../subledger/owners";

export const subledgerOwnerCapabilities = {
  subledger_get_basis: effectCapability(Capabilities.subledger_get_basis, getSubledgerBasis),
  subledger_list_bases: effectCapability(Capabilities.subledger_list_bases, listSubledgerBases),
  subledger_create_control: effectCapability(
    Capabilities.subledger_create_control,
    createSubledgerControl,
  ),
  subledger_get_control: effectCapability(Capabilities.subledger_get_control, getSubledgerControl),
  subledger_list_controls: effectCapability(
    Capabilities.subledger_list_controls,
    listSubledgerControls,
  ),
  schedules_create: effectCapability(Capabilities.schedules_create, createSubledgerSchedule),
  schedules_list: effectCapability(Capabilities.schedules_list, listSubledgerSchedules),
  schedules_get: effectCapability(Capabilities.schedules_get, (token, input) =>
    getSubledgerSchedule(token, { scope: input.scope, scheduleId: input.scheduleId }),
  ),
  schedules_revise: effectCapability(Capabilities.schedules_revise, (token, input) =>
    reviseSubledgerSchedule(token, {
      scope: input.scope,
      scheduleId: input.scheduleId,
      idempotencyKey: input.idempotencyKey,
      input: input.input,
    }),
  ),
  schedules_prepare: effectCapability(Capabilities.schedules_prepare, (token, input) =>
    prepareSubledgerOccurrence(token, {
      scope: input.scope,
      scheduleId: input.scheduleId,
      idempotencyKey: input.idempotencyKey,
      input: input.input,
    }),
  ),
  owners_create_owner: effectCapability(Capabilities.owners_create_owner, createOwnerIdentity),
  owners_get_owner: effectCapability(Capabilities.owners_get_owner, (token, input) =>
    getOwnerIdentity(token, { scope: input.scope, id: input.id }),
  ),
  owners_list_owners: effectCapability(Capabilities.owners_list_owners, listOwnerIdentities),
  owners_create_record: effectCapability(Capabilities.owners_create_record, createOwnerRecord),
  owners_revise_record: effectCapability(Capabilities.owners_revise_record, (token, input) =>
    reviseOwnerRecord(token, {
      scope: input.scope,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      input: input.input,
    }),
  ),
  owners_get_record: effectCapability(Capabilities.owners_get_record, (token, input) =>
    getOwnerRecord(token, { scope: input.scope, id: input.id }),
  ),
  owners_list_records: effectCapability(Capabilities.owners_list_records, listOwnerRecords),
  owners_record_history: effectCapability(Capabilities.owners_record_history, (token, input) =>
    ownerRecordHistory(token, { scope: input.scope, id: input.id, after: input.after }),
  ),
  owners_attach_proposal: effectCapability(Capabilities.owners_attach_proposal, (token, input) =>
    attachOwnerProposal(token, {
      scope: input.scope,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      input: input.input,
    }),
  ),
  owners_attach_posted_line: effectCapability(
    Capabilities.owners_attach_posted_line,
    (token, input) =>
      attachOwnerPostedLine(token, {
        scope: input.scope,
        id: input.id,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
      }),
  ),
  owners_prepare_allocation: effectCapability(
    Capabilities.owners_prepare_allocation,
    prepareOwnerAllocation,
  ),
  owners_get_allocation: effectCapability(Capabilities.owners_get_allocation, (token, input) =>
    getOwnerAllocation(token, { scope: input.scope, id: input.id }),
  ),
  owners_apply_allocation: effectCapability(Capabilities.owners_apply_allocation, (token, input) =>
    applyOwnerAllocation(token, {
      scope: input.scope,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      input: input.input,
    }),
  ),
  owners_prepare_control: effectCapability(
    Capabilities.owners_prepare_control,
    prepareOwnerControl,
  ),
  owners_get_control: effectCapability(Capabilities.owners_get_control, (token, input) =>
    getOwnerControl(token, { scope: input.scope, id: input.id }),
  ),
  owners_recover_command: effectCapability(Capabilities.owners_recover_command, (token, input) =>
    recoverOwnerCommand(token, { scope: input.scope, key: input.key }),
  ),
};

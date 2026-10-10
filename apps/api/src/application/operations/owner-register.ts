import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Owners from "../subledger/owners";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const OwnerRegisterOperations = {
  ownersRecoverCommand: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersRecoverCommand,
    capabilities.owners_recover_command,
    ({ params }) => ({
      scope: scopeFromPath(params),
      key: params.key,
    }),
  ),
  ownersGetControl: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersGetControl,
    capabilities.owners_get_control,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  ownersPrepareControl: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersPrepareControl,
    capabilities.owners_prepare_control,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersApplyAllocation: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersApplyAllocation,
    capabilities.owners_apply_allocation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersApproveAllocation: defineHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersApproveAllocation,
    (token, { params, headers, payload }) =>
      Owners.approveAllocation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  ownersGetAllocation: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersGetAllocation,
    capabilities.owners_get_allocation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  ownersPrepareAllocation: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersPrepareAllocation,
    capabilities.owners_prepare_allocation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersAttachPostedLine: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersAttachPostedLine,
    capabilities.owners_attach_posted_line,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersAttachProposal: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersAttachProposal,
    capabilities.owners_attach_proposal,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersReviewRecord: defineHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersReviewRecord,
    (token, { params, headers, payload }) =>
      Owners.reviewRecord(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  ownersRecordHistory: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersRecordHistory,
    capabilities.owners_record_history,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      after: search.after,
    }),
  ),
  ownersListRecords: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersListRecords,
    capabilities.owners_list_records,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      after: search.after,
    }),
  ),
  ownersGetRecord: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersGetRecord,
    capabilities.owners_get_record,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  ownersReviseRecord: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersReviseRecord,
    capabilities.owners_revise_record,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersCreateRecord: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersCreateRecord,
    capabilities.owners_create_record,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersListOwners: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersListOwners,
    capabilities.owners_list_owners,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      after: search.after,
    }),
  ),
  ownersGetOwner: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersGetOwner,
    capabilities.owners_get_owner,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  ownersCreateOwner: bindHttpOperation(
    Api.groups.ownerRegister.endpoints.ownersCreateOwner,
    capabilities.owners_create_owner,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};

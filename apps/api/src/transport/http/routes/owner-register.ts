import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Owners from "../../../application/subledger/owners";

export const OwnerRegisterHandlers = HttpApiBuilder.group(Api, "ownerRegister", (handlers) =>
  handlers
    .handle("ownersCreateOwner", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_create_owner.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersGetOwner", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_get_owner.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("ownersListOwners", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_list_owners.execute(token, {
          scope: scopeFromPath(params),
          after: search.after,
        }),
      ),
    )
    .handle("ownersCreateRecord", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_create_record.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersReviseRecord", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_revise_record.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersGetRecord", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_get_record.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("ownersListRecords", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_list_records.execute(token, {
          scope: scopeFromPath(params),
          after: search.after,
        }),
      ),
    )
    .handle("ownersRecordHistory", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_record_history.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          after: search.after,
        }),
      ),
    )
    .handle("ownersReviewRecord", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owners.reviewRecord(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersAttachProposal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_attach_proposal.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersAttachPostedLine", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_attach_posted_line.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersPrepareAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_prepare_allocation.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersGetAllocation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_get_allocation.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("ownersApproveAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owners.approveAllocation(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersApplyAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_apply_allocation.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersPrepareControl", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_prepare_control.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersGetControl", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_get_control.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("ownersRecoverCommand", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_recover_command.execute(token, {
          scope: scopeFromPath(params),
          key: params.key,
        }),
      ),
    ),
);

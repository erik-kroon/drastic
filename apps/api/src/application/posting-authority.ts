import * as Effect from "effect/Effect";
import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Schema from "effect/Schema";
import { recheckPrincipal, type VerifiedPrincipal } from "../db/identity";
import * as Db from "../db/posting";
import type { Transaction } from "../db/transaction";
import { requireBookResponsibility, readBookResponsibility } from "./book-responsibility";
import { failure } from "./failures";

type Scope = typeof Accounting.Scope.Type;

type Permission = "approve_change" | "execute_change";

type ResponsibilityRequirement = "bookkeeping_approver" | "informational";

export function collectPostingActorBasis(
  transaction: Transaction,
  scope: Scope,
  actorId: string,
  permission: Permission,
  responsibilityRequirement: ResponsibilityRequirement = permission === "approve_change"
    ? "bookkeeping_approver"
    : "informational",
) {
  return Effect.gen(function* () {
    const membership = (yield* Db.readPostingMembership(transaction, scope.bookId, actorId))[0];
    const admission = (yield* Db.readActorAdmission(transaction, actorId))[0];

    if (
      membership === undefined ||
      (permission === "approve_change" && membership.role !== "operator") ||
      admission?.enabled === false
    ) {
      return yield* failure("ApprovalRequired");
    }

    const responsibility =
      responsibilityRequirement === "bookkeeping_approver"
        ? yield* requireBookResponsibility(transaction, scope, actorId, "bookkeepingApproverId")
        : yield* readBookResponsibility(transaction, scope);

    const now = yield* Db.readDatabaseTime(transaction);

    const admissionBasis: Schema.JsonObject =
      admission === undefined
        ? { kind: "synthetic_without_admission" }
        : {
            kind: "provisioned",
            providerId: admission.providerId,
            subject: admission.subject,
            enabled: admission.enabled,
          };

    const responsibilityBasis: Schema.JsonObject =
      responsibility === undefined
        ? { kind: "unconfigured" }
        : {
            kind: "configured",
            id: responsibility.id,
            revision: responsibility.revision,
            role: "bookkeepingApproverId",
            actorId: responsibility.assignments.bookkeepingApproverId,
          };

    return {
      version: 1 as const,
      policy: "generic-posting-authority-v1" as const,
      scope,
      actorId,
      permission,
      membershipRole: membership.role,
      checkedAt: now.now,
      admission: admissionBasis,
      responsibility: responsibilityBasis,
      responsibilityRequired: responsibilityRequirement === "bookkeeping_approver",
    } satisfies Schema.JsonObject;
  });
}

export function collectPostingPrincipalBasis(
  transaction: Transaction,
  scope: Scope,
  principal: VerifiedPrincipal,
  permission: Permission,
  responsibilityRequirement: ResponsibilityRequirement = permission === "approve_change"
    ? "bookkeeping_approver"
    : "informational",
) {
  return Effect.gen(function* () {
    const authenticated = yield* recheckPrincipal(
      transaction,
      principal,
      scope,
      { operatorOnly: permission === "approve_change" },
      "share",
    );

    const authority = yield* collectPostingActorBasis(
      transaction,
      scope,
      authenticated.actorId,
      permission,
      responsibilityRequirement,
    );

    const authentication: Schema.JsonObject =
      authenticated.kind !== "betterAuthSession"
        ? {
            kind: authenticated.kind,
            credentialHash: authenticated.credentialHash,
            expiresAt: authenticated.expiresAt,
          }
        : {
            kind: authenticated.kind,
            sessionId: authenticated.sessionId,
            expiresAt: authenticated.expiresAt,
          };

    return { ...authority, authentication } satisfies Schema.JsonObject;
  });
}

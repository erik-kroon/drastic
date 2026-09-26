import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import {
  admitPrincipal,
  recheckPrincipal,
  type AccessCredential,
  type AuthorityLockMode,
  type AuthorityRequirement,
  type VerifiedPrincipal,
} from "../db/identity";
import { withTransaction, type Transaction } from "../db/transaction";
import { type Database } from "../db/connection";

export type {
  AccessCredential,
  AuthorityLockMode,
  AuthorityRequirement,
  VerifiedPrincipal,
} from "../db/identity";

export function withAdmittedPrincipal<A, R>(
  access: AccessCredential,
  scope: typeof Accounting.Scope.Type,
  requirement: AuthorityRequirement,
  operation: (
    transaction: Transaction,
    principal: VerifiedPrincipal,
  ) => Effect.Effect<A, Accounting.AccountingError, R>,
  lockMode: AuthorityLockMode = "share",
): Effect.Effect<A, Accounting.AccountingError, R | Database> {
  return withTransaction((transaction) =>
    Effect.gen(function* () {
      const principal = yield* admitPrincipal(transaction, access, scope, requirement, lockMode);
      return yield* operation(transaction, principal);
    }),
  );
}

export function withVerifiedPrincipal<A, R>(
  principal: VerifiedPrincipal,
  scope: typeof Accounting.Scope.Type,
  requirement: AuthorityRequirement,
  operation: (
    transaction: Transaction,
    verifiedPrincipal: VerifiedPrincipal,
  ) => Effect.Effect<A, Accounting.AccountingError, R>,
  lockMode: AuthorityLockMode = "share",
): Effect.Effect<A, Accounting.AccountingError, R | Database> {
  return withTransaction((transaction) =>
    Effect.gen(function* () {
      const verifiedPrincipal = yield* recheckPrincipal(
        transaction,
        principal,
        scope,
        requirement,
        lockMode,
      );
      return yield* operation(transaction, verifiedPrincipal);
    }),
  );
}

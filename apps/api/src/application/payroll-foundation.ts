import * as Accounting from "@open-erp/contracts/accounting";
import * as Payroll from "@open-erp/contracts/payroll-foundation";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { withAdmittedPrincipal, type VerifiedPrincipal } from "./identity";
import { newId, replay, saveCommand } from "./posting";
import * as Db from "../db/posting";
import * as PayrollDb from "../db/payroll-foundation";
import { databaseFailure, type Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;
type Principal = VerifiedPrincipal;
type JsonObject = Schema.JsonObject;
type CaptureInput = typeof Payroll.CapturePayrollRevision.Type;
type RevisionKind = typeof Payroll.PayrollRevision.Type.kind;

const RevisionReceipt = Schema.Struct({
  ...Payroll.PayrollRevision.fields,
  body: Schema.JsonObject,
});
const EmployeePage = Payroll.PayrollEmployeePage;
const AccessResult = Payroll.PayrollAccessResult;
const History = Payroll.PayrollHistory;

const bodyByteLimit = 65536;

const requiredBodyKeys = {
  employment: ["jurisdiction", "payTerms", "personRef", "residency", "taxFacts", "workSchedule"],
  opening: ["asOf", "balanceMinor", "obligation"],
  work: ["inputs", "periodEnd", "periodStart"],
} as const satisfies { readonly [K in RevisionKind]: ReadonlyArray<string> };

function decode<A>(schema: Schema.Decoder<A>, value: unknown) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function payrollFacts(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InvalidJournal")),
  );
}

function withPayrollBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown>,
) {
  return withAdmittedPrincipal({ token }, scope, { operatorOnly }, (transaction, principal) =>
    operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
  );
}

function requireTableGrants(transaction: Transaction, write: boolean) {
  return PayrollDb.readTableGrants(transaction, write).pipe(
    Effect.flatMap((grants) =>
      grants.every((grant) => grant.allowed) ? Effect.void : failure("UnsupportedProfile"),
    ),
  );
}

function requirePayrollGrant(transaction: Transaction, scope: Scope, principal: Principal) {
  return PayrollDb.readPayrollAccess(transaction, scope.bookId, principal.actorId).pipe(
    Effect.flatMap((rows) => (rows.length === 0 ? failure("Forbidden") : Effect.void)),
  );
}

function dateValue(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? failure("InvalidJournal")
    : Effect.succeed(value);
}

function hasExactKeys(present: ReadonlyArray<string>, required: ReadonlyArray<string>) {
  return present.length === required.length && required.every((key) => present.includes(key));
}

function revisionFacts(input: CaptureInput) {
  const exact = hasExactKeys(Object.keys(input.body), requiredBodyKeys[input.kind]);
  if (!exact) return failure("InvalidJournal");
  if (
    input.kind === "work" &&
    (input.body.inputs.length < 1 || input.body.periodStart > input.body.periodEnd)
  ) {
    return failure("InvalidJournal");
  }
  if (input.kind === "opening" && input.body.asOf !== input.effectiveOn) {
    return failure("InvalidJournal");
  }
  return Effect.void;
}

function boundedFacts(body: JsonObject) {
  return new TextEncoder().encode(JSON.stringify(body)).length > bodyByteLimit
    ? failure("InvalidJournal")
    : Effect.void;
}

export const listEmployees = Effect.fn("payroll.listEmployees")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withPayrollBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTableGrants(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      yield* requirePayrollGrant(transaction, command.scope, principal);
      const rows = yield* PayrollDb.listEmployees(
        transaction,
        command.scope.bookId,
        command.after ?? "",
      );
      const page = rows.slice(0, 50);
      return yield* decode(EmployeePage, {
        scope: command.scope,
        items: page.map((row) => ({
          scope: command.scope,
          employeeId: row.id,
          createdAt: row.createdAt,
        })),
        nextCursor: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
      });
    }),
  );
});

export const setAccess = Effect.fn("payroll.setAccess")(function* (
  token: string,
  command: { scope: Scope; input: typeof Payroll.PayrollAccess.Type },
) {
  return yield* withPayrollBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTableGrants(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const members = yield* PayrollDb.readBookMember(
        transaction,
        command.scope.bookId,
        command.input.actorId,
      );
      if (members.length === 0) return yield* failure("NotFound");
      if (command.input.allowed) {
        yield* PayrollDb.grantPayrollAccess(transaction, {
          bookId: command.scope.bookId,
          actorId: command.input.actorId,
          grantedBy: principal.actorId,
        });
      } else {
        yield* PayrollDb.revokePayrollAccess(
          transaction,
          command.scope.bookId,
          command.input.actorId,
        );
      }
      return yield* decode(AccessResult, {
        scope: command.scope,
        actorId: command.input.actorId,
        allowed: command.input.allowed,
      });
    }),
  );
});

export const captureRevision = Effect.fn("payroll.captureRevision")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CaptureInput },
) {
  const input = command.input;
  const fingerprint = yield* payrollFacts(input);
  return yield* withPayrollBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTableGrants(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      yield* requirePayrollGrant(transaction, command.scope, principal);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "capture_payroll_revision",
        principal.actorId,
        fingerprint,
        RevisionReceipt,
      );
      if (request.previous) return request.previous;
      const effectiveOn = yield* dateValue(input.effectiveOn);
      yield* revisionFacts(input);
      const body = yield* payrollFacts(input.body);
      yield* boundedFacts(body);
      if (
        (yield* Db.readEvidence(transaction, command.scope.bookId, input.evidenceId)).length === 0
      ) {
        return yield* failure("MissingEvidence");
      }
      const head = yield* PayrollDb.readCurrentRevision(
        transaction,
        command.scope.bookId,
        input.employeeId,
        input.kind,
        effectiveOn,
      );
      if (input.supersedes !== (head[0]?.revisionId ?? null)) {
        return yield* failure("StaleDependency");
      }
      yield* PayrollDb.insertEmployee(transaction, command.scope.bookId, input.employeeId);
      const current = {
        bookId: command.scope.bookId,
        employeeId: input.employeeId,
        kind: input.kind,
        effectiveOn,
        revisionId: newId("payrev"),
      };
      yield* PayrollDb.insertRevision(transaction, {
        ...current,
        id: current.revisionId,
        commandKey: command.idempotencyKey,
        supersedes: input.supersedes,
        evidenceId: input.evidenceId,
        body,
        createdBy: principal.actorId,
      });
      if (head[0]) {
        yield* PayrollDb.replaceCurrentRevision(transaction, current);
      } else {
        yield* PayrollDb.insertCurrentRevision(transaction, current);
      }
      const result = yield* decode(RevisionReceipt, {
        ...current,
        id: current.revisionId,
        scope: command.scope,
        supersedes: input.supersedes,
        evidenceId: input.evidenceId,
        body,
        createdBy: principal.actorId,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "capture_payroll_revision",
        principal.actorId,
        result,
      );
      return result;
    }),
  );
});

export const listRevisions = Effect.fn("payroll.listRevisions")(function* (
  token: string,
  command: { scope: Scope; employeeId: string },
) {
  return yield* withPayrollBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTableGrants(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      yield* requirePayrollGrant(transaction, command.scope, principal);
      const rows = yield* PayrollDb.listRevisions(
        transaction,
        command.scope.bookId,
        command.employeeId,
      );
      return yield* decode(History, {
        scope: command.scope,
        employeeId: command.employeeId,
        items: rows.map((row) => ({
          id: row.id,
          employeeId: row.employeeId,
          kind: row.kind,
          effectiveOn: row.effectiveOn,
          supersedes: row.supersedes,
          evidenceId: row.evidenceId,
          body: row.body,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
          isCurrent: row.isCurrent,
        })),
      });
    }),
  );
});

import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Effect from "effect/Effect";
import {
  readExecutionApprovalInTransaction,
  isoNow,
  newId,
  replay,
  saveCommand,
  versionedDigest,
} from "./posting";
import { failure } from "./failures";
import { readTableAccess } from "../db/commerce/access";
import {
  decode,
  requireRetainedEvidence,
  toJsonObject,
  withBook,
  type JsonObject,
  type Scope,
} from "./commerce/support";
import {
  decodeRelease,
  families,
  familyGap,
  familySelector,
  ownerBoundFamily,
  selectWitness,
  selectorDate,
  type Dates,
  type RecordClass,
  type Release,
  type Witness,
} from "./company-profile-basis";
import * as ArLegal from "../db/commerce/ar-legal";
import * as Db from "../db/company-profiles";
import * as Ledger from "../db/posting";
import type { Transaction } from "../db/transaction";

type Plan = typeof Profiles.CompanyActivationPlan.Type;

const accountState = (rows: ReadonlyArray<{ id: string; active: boolean; version: bigint }>) =>
  new Map(rows.map((row) => [row.id, { active: row.active, version: row.version }]));

function requireProfileTables(transaction: Transaction, write: boolean) {
  const names = [...Db.companyProfileTables];

  return readTableAccess(transaction, names).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== names.length) return failure("UnsupportedProfile");

      if (rows.some((row) => !row.canSelect)) return failure("UnsupportedProfile");

      return write && rows.some((row) => !row.canInsert)
        ? failure("UnsupportedProfile")
        : Effect.void;
    }),
  );
}

function dateRange(dates: Dates) {
  const requested = Object.values(dates)
    .flatMap((value) => (typeof value === "string" ? [value] : []))
    .sort();

  return { earliest: requested[0] ?? null, latest: requested[requested.length - 1] ?? null };
}

export const resolveCompanyProfileInTransaction = Effect.fn("companyProfiles.resolveInTransaction")(
  function* (transaction: Transaction, scope: Scope, recordClass: RecordClass, dates: Dates) {
    const book = (yield* Ledger.readBook(transaction, scope))[0];

    if (!book) return yield* failure("Forbidden");

    const today = (yield* isoNow(transaction)).slice(0, 10);
    const { earliest, latest } = dateRange(dates);

    if (earliest === null || latest === null) {
      return {
        scope,
        recordClass,
        families: families.map((family) => ({
          family,
          recordClass,
          dates,
          selectorDate: null,
          status: "incomplete" as const,
          witness: null,
          gaps: [familyGap("unknown_fact", familySelector[family], family)],
        })),
        ownerBoundFamilies: [yield* ownerBound(transaction, scope, today)],
        checkedAt: yield* isoNow(transaction),
      };
    }

    const facts = yield* Db.readFactRevisions(transaction, book.entityId, earliest, latest);

    const reviews = yield* Db.readFactReviews(
      transaction,
      book.entityId,
      facts.map((row) => row.id),
    );

    const bindings = yield* Db.readRoleBindings(transaction, scope.bookId, earliest, latest);

    const accounts = accountState(
      yield* Ledger.readAccounts(
        transaction,
        scope.bookId,
        bindings.map((row) => row.accountId),
      ),
    );

    const resolved: Array<typeof Profiles.ProfileResolution.Type> = [];

    for (const family of families) {
      const date = selectorDate(family, dates);

      if (date === null) {
        resolved.push({
          family,
          recordClass,
          dates,
          selectorDate: null,
          status: "incomplete",
          witness: null,
          gaps: [familyGap("unknown_fact", familySelector[family], family)],
        });
        continue;
      }

      const releases: Array<Release> = [];

      for (const row of yield* Db.readRuleReleases(transaction, family)) {
        const release = decodeRelease(row);

        if (release !== null) releases.push({ row, release });
      }

      const selection = selectWitness({
        family,
        recordClass,
        dates,
        date,
        facts,
        reviews,
        releases,
        bindings,
        activations: yield* Db.readActivations(transaction, scope.bookId, family, date, date),
        accounts,
      });

      resolved.push({
        family,
        recordClass,
        dates,
        selectorDate: date,
        status: selection.witness === null ? "incomplete" : "resolved",
        witness: selection.witness,
        gaps: [...selection.gaps],
      });
    }

    return {
      scope,
      recordClass,
      families: resolved,
      ownerBoundFamilies: [yield* ownerBound(transaction, scope, latest)],
      checkedAt: yield* isoNow(transaction),
    };
  },
);

function ownerBound(transaction: Transaction, scope: Scope, latestDate: string) {
  return ArLegal.readBookArLegalAccountingProfile(transaction, scope.bookId, latestDate).pipe(
    Effect.map((rows) => ({ ...ownerBoundFamily, admitted: rows.length > 0 })),
  );
}

export const getCompanyProfile = Effect.fn("companyProfiles.get")(function* (
  token: string,
  command: { scope: Scope; recordClass: RecordClass; dates: Dates },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireProfileTables(transaction, false);

    const resolved = yield* resolveCompanyProfileInTransaction(
      transaction,
      command.scope,
      command.recordClass,
      command.dates,
    );

    return yield* decode(Profiles.CompanyProfile, yield* toJsonObject(resolved));
  });
});

export const recordCompanyFact = Effect.fn("companyProfiles.recordFact")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Profiles.RecordFactRevision.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "record_company_fact",
        principal.actorId,
        input,
        Profiles.FactRevision,
      );

      if (request.previous) return request.previous;
      yield* requireProfileTables(transaction, true);

      const decoded = yield* decode(Profiles.RecordFactRevision, input);
      const book = (yield* Ledger.readBook(transaction, command.scope))[0];

      if (!book) return yield* failure("Forbidden");

      for (const reference of decoded.evidence) {
        yield* requireRetainedEvidence(transaction, command.scope.bookId, reference);
      }

      const priorId = decoded.supersedesId;

      const superseded =
        priorId === null
          ? null
          : ((yield* entityRevisions(transaction, book.entityId)).find(
              (row) => row.id === priorId,
            ) ?? null);

      if (priorId !== null && superseded === null) return yield* failure("NotFound");

      if (superseded !== null && superseded.factKind !== decoded.factKind) {
        return yield* failure("InvalidJournal");
      }

      const body = yield* toJsonObject({
        id: newId("fact"),
        entityId: book.entityId,
        ...decoded,
        recordedBy: principal.actorId,
        recordedAt: yield* isoNow(transaction),
        receipt: commandReceipt(command.idempotencyKey, "record_company_fact", principal.actorId),
      });

      const sealed = yield* versionedDigest(body);
      const result = yield* decode(Profiles.FactRevision, { ...body, digest: sealed });
      const row = yield* toJsonObject(result);

      yield* Db.insertFactRevision(transaction, {
        entityId: book.entityId,
        id: result.id,
        factKind: result.factKind,
        effectiveFrom: result.effectiveFrom,
        effectiveTo: result.effectiveTo,
        supersedesId: result.supersedesId,
        recordedBy: principal.actorId,
        recordedAt: result.recordedAt,
        digest: sealed,
        body: row,
      });

      if (superseded !== null) {
        yield* recordImpacts(transaction, command.scope, {
          factRevisionId: result.id,
          supersededRevisionId: superseded.id,
        });
      }

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "record_company_fact",
        principal.actorId,
        row,
      );

      return result;
    },
    "update",
  );
});

// A retroactive correction never rewrites a committed activation. It records the
// activations that had already selected the superseded revision.
function recordImpacts(
  transaction: Transaction,
  scope: Scope,
  supersession: { readonly factRevisionId: string; readonly supersededRevisionId: string },
) {
  return Effect.gen(function* () {
    const today = (yield* isoNow(transaction)).slice(0, 10);

    const selected = yield* Db.readActivationsSelecting(transaction, scope.bookId, [
      supersession.supersededRevisionId,
    ]);

    for (const activation of selected) {
      const body = yield* toJsonObject({
        id: newId("activation_impact"),
        scope,
        factRevisionId: supersession.factRevisionId,
        supersededRevisionId: supersession.supersededRevisionId,
        activationId: activation.id,
        alreadyInForce: activation.effectiveFrom <= today,
        recordedAt: today,
      });

      const sealed = yield* versionedDigest(body);
      const impact = yield* decode(Profiles.CompanyActivationImpact, { ...body, digest: sealed });

      yield* Db.insertActivationImpact(transaction, {
        bookId: scope.bookId,
        id: impact.id,
        factRevisionId: impact.factRevisionId,
        supersededRevisionId: impact.supersededRevisionId,
        activationId: impact.activationId,
        alreadyInForce: impact.alreadyInForce,
        recordedAt: impact.recordedAt,
        digest: sealed,
        body: yield* toJsonObject(impact),
      });
    }
  });
}

function commandReceipt(key: string, operation: string, actorId: string) {
  return { key, operation, actorId } satisfies JsonObject;
}

function entityRevisions(transaction: Transaction, entityId: string) {
  return Db.readFactRevisions(transaction, entityId, "0001-01-01", "9999-12-31");
}

export const reviewCompanyFact = Effect.fn("companyProfiles.reviewFact")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Profiles.ReviewFactRevision.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);
      const decoded = yield* decode(Profiles.ReviewFactRevision, input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "review_company_fact",
        principal.actorId,
        { factRevisionId: decoded.factRevisionId, input },
        Profiles.FactReview,
      );

      if (request.previous) return request.previous;
      yield* requireProfileTables(transaction, true);
      const book = (yield* Ledger.readBook(transaction, command.scope))[0];

      if (!book) return yield* failure("Forbidden");

      const revision = (yield* entityRevisions(transaction, book.entityId)).find(
        (row) => row.id === decoded.factRevisionId,
      );

      if (!revision) return yield* failure("NotFound");

      if (revision.digest !== decoded.expectedDigest) return yield* failure("StaleDependency");

      if (revision.recordedBy === principal.actorId) return yield* failure("ApprovalRequired");

      // One immutable review per revision. A changed view needs a new revision.
      if ((yield* Db.readFactReview(transaction, book.entityId, revision.id)).length > 0) {
        return yield* failure("IdempotencyConflict");
      }

      const body = yield* toJsonObject({
        factRevisionId: revision.id,
        entityId: book.entityId,
        revisionDigest: revision.digest,
        reviewer: principal.actorId,
        result: decoded.result,
        rationale: decoded.rationale,
        reviewedAt: yield* isoNow(transaction),
        receipt: commandReceipt(command.idempotencyKey, "review_company_fact", principal.actorId),
      });

      const sealed = yield* versionedDigest(body);
      const result = yield* decode(Profiles.FactReview, { ...body, digest: sealed });
      const row = yield* toJsonObject(result);

      yield* Db.insertFactReview(transaction, {
        entityId: book.entityId,
        factRevisionId: revision.id,
        reviewer: principal.actorId,
        result: result.result,
        reviewedAt: result.reviewedAt,
        digest: sealed,
        body: row,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "review_company_fact",
        principal.actorId,
        row,
      );

      return result;
    },
    "update",
  );
});

export const recordCompanyRoleBinding = Effect.fn("companyProfiles.recordRoleBinding")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Profiles.RecordRoleBinding.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "record_company_role_binding",
        principal.actorId,
        input,
        Profiles.RoleBinding,
      );

      if (request.previous) return request.previous;
      yield* requireProfileTables(transaction, true);

      const decoded = yield* decode(Profiles.RecordRoleBinding, input);

      const accounts = yield* Ledger.readAccounts(transaction, command.scope.bookId, [
        decoded.accountId,
      ]);

      if (accounts.length !== 1) return yield* failure("NotFound");

      if (decoded.reviewer === principal.actorId) return yield* failure("ApprovalRequired");

      for (const reference of decoded.evidence) {
        yield* requireRetainedEvidence(transaction, command.scope.bookId, reference);
      }

      if (
        decoded.supersedesId !== null &&
        (yield* Db.readRoleBinding(transaction, command.scope.bookId, decoded.supersedesId))
          .length === 0
      ) {
        return yield* failure("NotFound");
      }

      const body = yield* toJsonObject({
        id: newId("role"),
        scope: command.scope,
        ...decoded,
        accountVersion: (accounts[0]?.version ?? 0n).toString(),
        recordedBy: principal.actorId,
        recordedAt: yield* isoNow(transaction),
        receipt: commandReceipt(
          command.idempotencyKey,
          "record_company_role_binding",
          principal.actorId,
        ),
      });

      const sealed = yield* versionedDigest(body);
      const result = yield* decode(Profiles.RoleBinding, { ...body, digest: sealed });
      const row = yield* toJsonObject(result);

      yield* Db.insertRoleBinding(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        roleKind: result.roleKind,
        accountId: result.accountId,
        accountVersion: BigInt(result.accountVersion),
        effectiveFrom: result.effectiveFrom,
        effectiveTo: result.effectiveTo,
        supersedesId: result.supersedesId,
        reviewer: result.reviewer,
        recordedBy: principal.actorId,
        recordedAt: result.recordedAt,
        digest: sealed,
        body: row,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "record_company_role_binding",
        principal.actorId,
        row,
      );

      return result;
    },
    "update",
  );
});

function activationDependencies(witness: Witness, epoch: bigint) {
  return [
    ...witness.factRevisionIds.map((id) => ({
      kind: "fact_revision" as const,
      resourceId: id,
      version: id,
      reason: "Exact reviewed company fact revision",
    })),
    {
      kind: "rule_release" as const,
      resourceId: witness.ruleReleaseId,
      version: witness.ruleReleaseChecksum,
      reason: "Reviewed family rule release",
    },
    ...witness.roleBindingIds.map((id) => ({
      kind: "role_binding" as const,
      resourceId: id,
      version: id,
      reason: "Exact reviewed account role binding",
    })),
    {
      kind: "family_membership" as const,
      resourceId: witness.family,
      version: epoch.toString(),
      reason: "Family admission epoch",
    },
  ];
}

export const prepareCompanyActivation = Effect.fn("companyProfiles.prepareActivation")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Profiles.PrepareCompanyActivation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_company_activation",
        principal.actorId,
        input,
        Profiles.CompanyActivationPlan,
      );

      if (request.previous) return request.previous;
      yield* requireProfileTables(transaction, true);

      const prepared = yield* decode(Profiles.PrepareCompanyActivation, input);
      const date = selectorDate(prepared.family, prepared.dates);

      if (date === null) return yield* failure("InvalidJournal");

      if (prepared.effectiveTo !== null && prepared.effectiveTo < prepared.effectiveFrom) {
        return yield* failure("InvalidJournal");
      }

      const resolved = yield* resolveCompanyProfileInTransaction(
        transaction,
        command.scope,
        prepared.recordClass,
        prepared.dates,
      );

      const resolution = resolved.families.find((entry) => entry.family === prepared.family);

      if (!resolution || resolution.witness === null) return yield* failure("UnsupportedProfile");

      if (resolution.witness.activationId !== null) return yield* failure("IdempotencyConflict");

      yield* Db.insertFamilyMembership(transaction, command.scope.bookId, prepared.family);

      const epoch =
        (yield* Db.readFamilyMembership(
          transaction,
          command.scope.bookId,
          prepared.family,
          "share",
        ))[0]?.membershipEpoch ?? 1n;

      const body = yield* toJsonObject({
        schemaVersion: 1,
        canonicalization: "openerp-c14n-v1",
        owner: "company_activation",
        id: newId("activation_plan"),
        scope: command.scope,
        version: 1,
        input: prepared,
        witness: resolution.witness,
        dependencies: activationDependencies(resolution.witness, epoch),
      });

      const sealed = yield* versionedDigest(body);
      const result = yield* decode(Profiles.CompanyActivationPlan, { ...body, digest: sealed });
      const row = yield* toJsonObject(result);

      yield* Ledger.insertPlan(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        plan: row,
        digest: sealed,
        createdBy: principal.actorId,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_company_activation",
        principal.actorId,
        row,
      );

      return result;
    },
    "update",
  );
});

function readActivationPlan(transaction: Transaction, scope: Scope, planId: string) {
  return Ledger.readPlan(transaction, scope.bookId, planId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      return row ? decode(Profiles.CompanyActivationPlan, row.plan) : failure("NotFound");
    }),
  );
}

// The sealed proposal serializes its own execution. Its row is immutable, so
// this takes a lock and never rewrites the proposal.
function lockActivationPlan(transaction: Transaction, scope: Scope, planId: string) {
  return Db.lockActivationPlan(transaction, scope.bookId, planId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      return row ? decode(Profiles.CompanyActivationPlan, row.plan) : failure("NotFound");
    }),
  );
}

export const approveCompanyActivation = Effect.fn("companyProfiles.approveActivation")(function* (
  token: string,
  command: {
    scope: Scope;
    planId: string;
    idempotencyKey: string;
    input: typeof Profiles.ApproveCompanyActivation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const { scope, planId, idempotencyKey, input } = command;

      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        "approve_company_activation",
        principal.actorId,
        { id: planId, input },
        Profiles.CompanyActivationApproval,
      );

      if (request.previous) return request.previous;

      const plan = yield* readActivationPlan(transaction, scope, planId);

      if (plan.digest !== input.planDigest) return yield* failure("StaleDependency");

      const now = yield* isoNow(transaction);

      const approval = yield* Ledger.insertApproval(transaction, {
        bookId: scope.bookId,
        id: newId("activation_approval"),
        changeSetId: plan.id,
        digest: plan.digest,
        actorId: principal.actorId,
        expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
      }).pipe(
        Effect.flatMap((rows) => (rows[0] ? Effect.succeed(rows[0]) : failure("InternalError"))),
      );

      const result = yield* decode(Profiles.CompanyActivationApproval, {
        id: approval.id,
        planId: plan.id,
        planDigest: approval.digest,
        scope,
        actorId: approval.actorId,
        expiresAt: approval.expiresAt,
        createdAt: now,
        receipt: commandReceipt(idempotencyKey, "approve_company_activation", principal.actorId),
      });

      const row = yield* toJsonObject(result);

      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        "approve_company_activation",
        principal.actorId,
        row,
      );

      return result;
    },
    "update",
  );
});

function equalLists(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function plannedEpoch(plan: Plan) {
  return plan.dependencies.find(
    (dependency) =>
      dependency.kind === "family_membership" && dependency.resourceId === plan.witness.family,
  )?.version;
}

export const executeCompanyActivation = Effect.fn("companyProfiles.executeActivation")(function* (
  token: string,
  command: {
    scope: Scope;
    planId: string;
    idempotencyKey: string;
    input: typeof Profiles.ExecuteCompanyActivation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const { scope, planId, idempotencyKey, input } = command;

      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        "execute_company_activation",
        principal.actorId,
        { id: planId, input },
        Profiles.CompanyActivationReceipt,
      );

      if (request.previous) return request.previous;

      const plan = yield* readActivationPlan(transaction, scope, planId);

      if (plan.digest !== input.planDigest) return yield* failure("StaleDependency");

      // Account state is re-resolved under the book writer lock before the plan
      // row is taken, matching the reviewed account-then-resource order.
      const resolved = yield* resolveCompanyProfileInTransaction(
        transaction,
        scope,
        plan.witness.recordClass,
        plan.witness.dates,
      );

      const current = resolved.families.find((entry) => entry.family === plan.witness.family);

      if (
        current?.witness === null ||
        current?.witness === undefined ||
        current.witness.ruleReleaseId !== plan.witness.ruleReleaseId ||
        !equalLists(current.witness.factRevisionIds, plan.witness.factRevisionIds) ||
        !equalLists(current.witness.factReviewIds, plan.witness.factReviewIds) ||
        !equalLists(current.witness.roleBindingIds, plan.witness.roleBindingIds) ||
        current.witness.activationId !== null
      ) {
        return yield* failure("StaleDependency");
      }

      const locked = yield* lockActivationPlan(transaction, scope, planId);

      if (locked.digest !== plan.digest) return yield* failure("StaleDependency");

      if ((yield* Db.readActivationByChangeSet(transaction, scope.bookId, plan.id)).length > 0) {
        return yield* failure("IdempotencyConflict");
      }

      yield* Db.insertFamilyMembership(transaction, scope.bookId, plan.witness.family);

      const membership = yield* Db.readFamilyMembership(
        transaction,
        scope.bookId,
        plan.witness.family,
        "update",
      );

      const epoch = membership[0]?.membershipEpoch;

      if (epoch === undefined || epoch.toString() !== plannedEpoch(plan)) {
        return yield* failure("StaleDependency");
      }

      const approval = yield* readExecutionApprovalInTransaction(
        transaction,
        scope,
        { id: plan.id, planDigest: plan.digest },
        input.approvalId,
      );

      if (approval.actorId === principal.actorId) return yield* failure("ApprovalRequired");

      const committedAt = yield* isoNow(transaction);
      const activationId = newId("activation");
      const groupId = newId("activation_group");

      const body = yield* toJsonObject({
        id: activationId,
        scope,
        family: plan.witness.family,
        ruleReleaseId: plan.witness.ruleReleaseId,
        factRevisionIds: plan.witness.factRevisionIds,
        factReviewIds: plan.witness.factReviewIds,
        roleBindingIds: plan.witness.roleBindingIds,
        applicabilityScope: scope,
        effectiveFrom: plan.input.effectiveFrom,
        effectiveTo: plan.input.effectiveTo,
        changeSetId: plan.id,
        approvedDigest: plan.digest,
        activatedBy: principal.actorId,
        activatedAt: committedAt,
      });

      const sealed = yield* versionedDigest(body);
      const activation = yield* decode(Profiles.CompanyActivation, { ...body, digest: sealed });

      const receipt = yield* decode(Profiles.CompanyActivationReceipt, {
        id: newId("activation_receipt"),
        scope,
        changeSetId: plan.id,
        groupId,
        planDigest: plan.digest,
        activationId,
        approvalId: approval.id,
        journalIds: [],
        noFinancialEffect: true,
        committedAt,
        receipt: commandReceipt(idempotencyKey, "execute_company_activation", principal.actorId),
      });

      const groupReceipt = yield* toJsonObject({
        id: receipt.id,
        changeSetId: plan.id,
        groupId,
        planDigest: plan.digest,
        noFinancialEffect: true,
        activationId,
        approvalId: approval.id,
        journalIds: [],
        committedAt,
      });

      yield* Db.insertActivation(transaction, {
        bookId: scope.bookId,
        id: activationId,
        family: activation.family,
        ruleReleaseId: activation.ruleReleaseId,
        changeSetId: plan.id,
        effectiveFrom: activation.effectiveFrom,
        effectiveTo: activation.effectiveTo,
        activatedBy: principal.actorId,
        activatedAt: committedAt,
        digest: sealed,
        body: yield* toJsonObject(activation),
      });
      yield* Db.bumpFamilyMembership(transaction, scope.bookId, plan.witness.family, committedAt);
      yield* Ledger.insertGroupReceipt(transaction, {
        bookId: scope.bookId,
        id: receipt.id,
        changeSetId: plan.id,
        groupId,
        planDigest: plan.digest,
        body: groupReceipt,
        committedAt,
      });
      yield* Ledger.insertApprovalConsumption(transaction, {
        bookId: scope.bookId,
        approvalId: approval.id,
        changeSetId: plan.id,
        groupId,
        planDigest: plan.digest,
        receiptId: receipt.id,
        approverId: approval.actorId,
        consumedById: principal.actorId,
        consumedAt: committedAt,
      });

      if (
        (yield* Ledger.consumeApproval(transaction, scope.bookId, approval.id, committedAt))
          .length !== 1
      ) {
        return yield* failure("InternalError");
      }

      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        "execute_company_activation",
        principal.actorId,
        yield* toJsonObject(receipt),
      );

      return receipt;
    },
    "update",
  );
});

export const getCompanyActivation = Effect.fn("companyProfiles.getActivation")(function* (
  token: string,
  command: { scope: Scope; activationId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireProfileTables(transaction, false);

    const row = (yield* Db.readActivation(
      transaction,
      command.scope.bookId,
      command.activationId,
    ))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Profiles.CompanyActivation, row.body);
  });
});

import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  changeSets,
  companyActivations,
  companyActivationImpacts,
  companyFactRevisions,
  companyFactReviews,
  companyFamilyMemberships,
  companyRoleBindings,
  ruleReleases,
} from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const companyProfileTables = [
  "rule_releases",
  "company_fact_revisions",
  "company_fact_reviews",
  "company_role_bindings",
  "company_family_memberships",
  "company_activations",
  "company_activation_impacts",
] as const;

export type FactRevisionRow = {
  readonly id: string;
  readonly entityId: string;
  readonly factKind: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly supersedesId: string | null;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly digest: string;
  readonly body: JsonObject;
};

export type FactReviewRow = {
  readonly factRevisionId: string;
  readonly reviewer: string;
  readonly result: string;
  readonly digest: string;
  readonly body: JsonObject;
};

export type RuleReleaseRow = {
  readonly id: string;
  readonly jurisdiction: string;
  readonly family: string;
  readonly version: number;
  readonly checksum: string;
  readonly body: JsonObject;
};

export type RoleBindingRow = {
  readonly id: string;
  readonly roleKind: string;
  readonly accountId: string;
  readonly accountVersion: bigint;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly supersedesId: string | null;
  readonly digest: string;
  readonly body: JsonObject;
};

export type ActivationRow = {
  readonly id: string;
  readonly family: string;
  readonly ruleReleaseId: string;
  readonly changeSetId: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly digest: string;
  readonly body: JsonObject;
};

export type FamilyMembershipRow = {
  readonly family: string;
  readonly membershipEpoch: bigint;
};

export type ActivationSelectionRow = {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly body: JsonObject;
};

const noFactReviews: ReadonlyArray<FactReviewRow> = [];

const noSelections: ReadonlyArray<ActivationSelectionRow> = [];

// One set-based load over the widest interval the selection can ask about, so a
// per-kind or per-date lookup never runs a separate statement.
export function readFactRevisions(
  transaction: Transaction,
  entityId: string,
  earliestDate: string,
  latestDate: string,
) {
  return transaction
    .select({
      id: companyFactRevisions.id,
      entityId: companyFactRevisions.entityId,
      factKind: companyFactRevisions.factKind,
      effectiveFrom: companyFactRevisions.effectiveFrom,
      effectiveTo: companyFactRevisions.effectiveTo,
      supersedesId: companyFactRevisions.supersedesId,
      recordedBy: companyFactRevisions.recordedBy,
      recordedAt: companyFactRevisions.recordedAt,
      digest: companyFactRevisions.digest,
      body: companyFactRevisions.body,
    })
    .from(companyFactRevisions)
    .where(
      and(
        eq(companyFactRevisions.entityId, entityId),
        lte(companyFactRevisions.effectiveFrom, latestDate),
        or(
          isNull(companyFactRevisions.effectiveTo),
          gte(companyFactRevisions.effectiveTo, earliestDate),
        ),
      ),
    )
    .orderBy(
      companyFactRevisions.factKind,
      companyFactRevisions.effectiveFrom,
      companyFactRevisions.id,
    );
}

export function readFactReviews(transaction: Transaction, entityId: string, revisionIds: string[]) {
  if (revisionIds.length === 0) return Effect.succeed(noFactReviews);

  return transaction
    .select({
      factRevisionId: companyFactReviews.factRevisionId,
      reviewer: companyFactReviews.reviewer,
      result: companyFactReviews.result,
      digest: companyFactReviews.digest,
      body: companyFactReviews.body,
    })
    .from(companyFactReviews)
    .where(
      and(
        eq(companyFactReviews.entityId, entityId),
        inArray(companyFactReviews.factRevisionId, revisionIds),
      ),
    );
}

export function readFactReview(transaction: Transaction, entityId: string, revisionId: string) {
  return transaction
    .select({ factRevisionId: companyFactReviews.factRevisionId })
    .from(companyFactReviews)
    .where(
      and(
        eq(companyFactReviews.entityId, entityId),
        eq(companyFactReviews.factRevisionId, revisionId),
      ),
    );
}

export function readRuleReleases(transaction: Transaction, family: string) {
  return transaction
    .select({
      id: ruleReleases.id,
      jurisdiction: ruleReleases.jurisdiction,
      family: ruleReleases.family,
      version: ruleReleases.version,
      checksum: ruleReleases.checksum,
      body: ruleReleases.body,
    })
    .from(ruleReleases)
    .where(eq(ruleReleases.family, family))
    .orderBy(ruleReleases.jurisdiction, ruleReleases.version);
}

export function readRoleBindings(
  transaction: Transaction,
  bookId: string,
  earliestDate: string,
  latestDate: string,
) {
  return transaction
    .select({
      id: companyRoleBindings.id,
      roleKind: companyRoleBindings.roleKind,
      accountId: companyRoleBindings.accountId,
      accountVersion: companyRoleBindings.accountVersion,
      effectiveFrom: companyRoleBindings.effectiveFrom,
      effectiveTo: companyRoleBindings.effectiveTo,
      supersedesId: companyRoleBindings.supersedesId,
      digest: companyRoleBindings.digest,
      body: companyRoleBindings.body,
    })
    .from(companyRoleBindings)
    .where(
      and(
        eq(companyRoleBindings.bookId, bookId),
        lte(companyRoleBindings.effectiveFrom, latestDate),
        or(
          isNull(companyRoleBindings.effectiveTo),
          gte(companyRoleBindings.effectiveTo, earliestDate),
        ),
      ),
    )
    .orderBy(
      companyRoleBindings.roleKind,
      companyRoleBindings.effectiveFrom,
      companyRoleBindings.id,
    );
}

export function readRoleBinding(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({ id: companyRoleBindings.id, digest: companyRoleBindings.digest })
    .from(companyRoleBindings)
    .where(and(eq(companyRoleBindings.bookId, bookId), eq(companyRoleBindings.id, id)));
}

// The sealed activation proposal serializes its own execution. The row is
// immutable, so this is a lock and never a rewrite.
export function lockActivationPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction
    .select({ id: changeSets.id, plan: changeSets.plan })
    .from(changeSets)
    .where(and(eq(changeSets.bookId, bookId), eq(changeSets.id, planId)))
    .for("update");
}

export function readFamilyMembership(
  transaction: Transaction,
  bookId: string,
  family: string,
  lock: "share" | "update" = "share",
) {
  const query = transaction
    .select({
      family: companyFamilyMemberships.family,
      membershipEpoch: companyFamilyMemberships.membershipEpoch,
    })
    .from(companyFamilyMemberships)
    .where(
      and(eq(companyFamilyMemberships.bookId, bookId), eq(companyFamilyMemberships.family, family)),
    );

  return lock === "update" ? query.for("update") : query;
}

export function insertFamilyMembership(transaction: Transaction, bookId: string, family: string) {
  return transaction
    .insert(companyFamilyMemberships)
    .values({ bookId, family, membershipEpoch: 1n, updatedAt: sql`clock_timestamp()` })
    .onConflictDoNothing();
}

export function bumpFamilyMembership(
  transaction: Transaction,
  bookId: string,
  family: string,
  updatedAt: string,
) {
  return transaction
    .update(companyFamilyMemberships)
    .set({ membershipEpoch: sql`${companyFamilyMemberships.membershipEpoch} + 1`, updatedAt })
    .where(
      and(eq(companyFamilyMemberships.bookId, bookId), eq(companyFamilyMemberships.family, family)),
    )
    .returning({ membershipEpoch: companyFamilyMemberships.membershipEpoch });
}

export function readActivations(
  transaction: Transaction,
  bookId: string,
  family: string,
  earliestDate: string,
  latestDate: string,
) {
  return transaction
    .select({
      id: companyActivations.id,
      family: companyActivations.family,
      ruleReleaseId: companyActivations.ruleReleaseId,
      changeSetId: companyActivations.changeSetId,
      effectiveFrom: companyActivations.effectiveFrom,
      effectiveTo: companyActivations.effectiveTo,
      digest: companyActivations.digest,
      body: companyActivations.body,
    })
    .from(companyActivations)
    .where(
      and(
        eq(companyActivations.bookId, bookId),
        eq(companyActivations.family, family),
        lte(companyActivations.effectiveFrom, latestDate),
        or(
          isNull(companyActivations.effectiveTo),
          gte(companyActivations.effectiveTo, earliestDate),
        ),
      ),
    )
    .orderBy(companyActivations.effectiveFrom, companyActivations.id);
}

export function readActivation(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({
      id: companyActivations.id,
      family: companyActivations.family,
      ruleReleaseId: companyActivations.ruleReleaseId,
      changeSetId: companyActivations.changeSetId,
      effectiveFrom: companyActivations.effectiveFrom,
      effectiveTo: companyActivations.effectiveTo,
      digest: companyActivations.digest,
      body: companyActivations.body,
    })
    .from(companyActivations)
    .where(and(eq(companyActivations.bookId, bookId), eq(companyActivations.id, id)));
}

export function readActivationByChangeSet(
  transaction: Transaction,
  bookId: string,
  changeSetId: string,
) {
  return transaction
    .select({ id: companyActivations.id })
    .from(companyActivations)
    .where(
      and(eq(companyActivations.bookId, bookId), eq(companyActivations.changeSetId, changeSetId)),
    );
}

export function readActivationsSelecting(
  transaction: Transaction,
  bookId: string,
  revisionIds: string[],
) {
  if (revisionIds.length === 0) return Effect.succeed(noSelections);

  return transaction
    .select({
      id: companyActivations.id,
      effectiveFrom: companyActivations.effectiveFrom,
      body: companyActivations.body,
    })
    .from(companyActivations)
    .where(
      and(
        eq(companyActivations.bookId, bookId),
        sql`${companyActivations.body} -> 'factRevisionIds' ?| array[${sql.join(
          revisionIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[]`,
      ),
    );
}

export function insertFactRevision(
  transaction: Transaction,
  row: {
    readonly entityId: string;
    readonly id: string;
    readonly factKind: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly supersedesId: string | null;
    readonly recordedBy: string;
    readonly recordedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(companyFactRevisions).values([row]);
}

export function insertFactReview(
  transaction: Transaction,
  row: {
    readonly entityId: string;
    readonly factRevisionId: string;
    readonly reviewer: string;
    readonly result: string;
    readonly reviewedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(companyFactReviews).values([row]);
}

export function insertRoleBinding(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly roleKind: string;
    readonly accountId: string;
    readonly accountVersion: bigint;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly supersedesId: string | null;
    readonly reviewer: string;
    readonly recordedBy: string;
    readonly recordedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(companyRoleBindings).values([row]);
}

export function insertActivation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly family: string;
    readonly ruleReleaseId: string;
    readonly changeSetId: string | null;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly activatedBy: string;
    readonly activatedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(companyActivations).values([row]);
}

export function insertActivationImpact(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly factRevisionId: string;
    readonly supersededRevisionId: string;
    readonly activationId: string;
    readonly alreadyInForce: boolean;
    readonly recordedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(companyActivationImpacts).values([row]);
}

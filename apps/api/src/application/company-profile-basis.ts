import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { JsonObject } from "./commerce/support";
import type * as Db from "../db/company-profiles";

export type Family = typeof Profiles.Family.Type;

export type RecordClass = typeof Profiles.RecordClass.Type;

export type Dates = typeof Profiles.ProfileDates.Type;

export type Gap = typeof Profiles.ProfileGap.Type;

export type Witness = typeof Profiles.ProfileWitness.Type;

export type Release = {
  readonly row: Db.RuleReleaseRow;
  readonly release: typeof Profiles.RuleRelease.Type;
};

export type Selection = { readonly witness: Witness | null; readonly gaps: ReadonlyArray<Gap> };

// Every input the pure selection reads. The activated and the global route share
// it so a change to what selection may read happens in one place.
export type WitnessInput = {
  readonly family: Family;
  readonly recordClass: RecordClass;
  readonly dates: Dates;
  readonly date: string;
  readonly facts: ReadonlyArray<Db.FactRevisionRow>;
  readonly reviews: ReadonlyArray<Db.FactReviewRow>;
  readonly releases: ReadonlyArray<Release>;
  readonly bindings: ReadonlyArray<Db.RoleBindingRow>;
  readonly activations: ReadonlyArray<Db.ActivationRow>;
  readonly accounts: ReadonlyMap<string, { readonly active: boolean; readonly version: bigint }>;
};

// Each family reads the configuration its own operation uses, on the date that
// operation uses. An annual rule is never selected by today's date.
export const familySelector = {
  posting_eligibility: "postingOn",
  vat: "taxPointOn",
  payroll: "paymentOn",
  statements: "reportOn",
  corporate_tax: "taxPeriodOn",
} as const;

export const families: ReadonlyArray<Family> = [
  "posting_eligibility",
  "vat",
  "payroll",
  "statements",
  "corporate_tax",
];

// The legal AR family keeps its named activation owner. Reporting reads that
// owner's record instead of keeping a second activation authority for the family.
export const ownerBoundFamily = {
  family: "legal_ar",
  activationOwner: "commerce.legalProfile.activate",
  effect: "Activate through the named legal AR owner. This admission owner does not write it.",
} as const;

// Which operations a fact gates, so an incomplete family reports what it blocks
// instead of a bare false.
const factOperations = new Map<string, ReadonlyArray<Family>>([
  ["jurisdiction", families],
  ["legal_form", ["posting_eligibility", "vat", "corporate_tax"]],
  ["organization_number", ["posting_eligibility", "statements", "corporate_tax"]],
  ["accounting_method", ["posting_eligibility", "vat"]],
  ["vat_registration", ["vat"]],
  ["vat_period", ["vat"]],
  ["fiscal_year", ["statements"]],
  ["payroll_registration", ["payroll"]],
  ["reporting_framework", ["statements", "corporate_tax"]],
  ["base_currency", families],
  ["payroll_applicability", ["payroll"]],
]);

// A family whose selector date was never supplied has no selector. Normalising a
// missing date to null is what keeps the corporate_tax family unavailable to a
// caller that named no fiscal tax period, while a family with a real selector date
// still selects on that date and never on today's.
export function selectorDate(family: Family, dates: Dates) {
  return dates[familySelector[family]] ?? null;
}

export function familyGap(
  state: Gap["state"],
  subject: string,
  family: Family,
  extra: ReadonlyArray<string> = [],
) {
  return {
    state,
    subject,
    affectedOperations: [`company_get_profile:${family}`, ...extra],
  } satisfies Gap;
}

export function factGap(state: Gap["state"], kind: string, family: Family) {
  const affected = factOperations.get(kind) ?? [family];

  return {
    state,
    subject: kind,
    affectedOperations: affected.map((name) => `company_get_profile:${name}`),
  } satisfies Gap;
}

// A release body is decoded once into its owned schema. Persisted bytes that no
// longer match their contract are not silently reinterpreted.
export function decodeRelease(row: Db.RuleReleaseRow) {
  return Option.getOrNull(Schema.decodeUnknownOption(Profiles.RuleRelease)(row.body));
}

// A release may narrow the companies it applies to. An empty list constrains
// nothing, so a missing fact never silently narrows a release into scope.
export function applicabilityHolds(
  applicability: typeof Profiles.ReleaseApplicability.Type,
  facts: ReadonlyArray<{ kind: string; value: string }>,
) {
  const value = (kind: string) => facts.find((entry) => entry.kind === kind)?.value ?? null;

  const allowed = (candidates: ReadonlyArray<string>, actual: string | null) =>
    candidates.length === 0 || (actual !== null && candidates.includes(actual));

  return (
    allowed(applicability.legalForms, value("legal_form")) &&
    allowed(applicability.accountingMethods, value("accounting_method")) &&
    allowed(applicability.vatRegistrations, value("vat_registration")) &&
    allowed(applicability.payrollRegistrations, value("payroll_registration")) &&
    allowed(applicability.reportingFrameworks ?? [], value("reporting_framework")) &&
    allowed(applicability.baseCurrencies ?? [], value("base_currency"))
  );
}

function covers(row: { effectiveFrom: string; effectiveTo: string | null }, date: string) {
  return row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date);
}

function isJsonObject(value: Schema.Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfirmed(row: Db.FactReviewRow | undefined) {
  return row?.result === "confirmed";
}

function knownValue(revision: Db.FactRevisionRow) {
  const value = isJsonObject(revision.body.value) ? revision.body.value : {};

  return value.state === "known" && typeof value.value === "string" ? value.value : null;
}

function isEstablished(revision: Db.FactRevisionRow) {
  const value = isJsonObject(revision.body.value) ? revision.body.value : {};

  return value.state === "known";
}

// The pure part of admission: given captured rows, which reviewed release, facts
// and role bindings apply to one family on that family's own date. It reads no
// database and starts no runtime.
export function selectWitness(input: WitnessInput): Selection {
  const jurisdictions = input.facts
    .filter((row) => row.factKind === "jurisdiction" && covers(row, input.date))
    .filter((row) => isConfirmed(input.reviews.find((entry) => entry.factRevisionId === row.id)))
    .filter(isEstablished)
    .flatMap(knownValue);

  if (jurisdictions.length !== 1) {
    return {
      witness: null,
      gaps: [
        factGap(
          jurisdictions.length === 0 ? "unknown_fact" : "ambiguous_fact",
          "jurisdiction",
          input.family,
        ),
      ],
    };
  }

  const jurisdiction = jurisdictions[0] ?? "";

  // Book-aware selection comes first: an effectively activated book keeps its
  // exact qualified release even when other overlapping qualified profiles are
  // published globally. Global uniqueness is only the fallback for unactivated
  // preparation, where ambiguity remains a refusal.
  const effectiveActivations = input.activations.filter((row) => covers(row, input.date));
  const effectiveReleaseIds = [...new Set(effectiveActivations.map((row) => row.ruleReleaseId))];

  if (effectiveReleaseIds.length > 1) {
    return {
      witness: null,
      gaps: [
        familyGap(
          "overlapping_activation",
          `${input.family}:${jurisdiction}:activations=${effectiveReleaseIds.join(",")}`,
          input.family,
          [`company_execute_activation:${input.family}`],
        ),
      ],
    };
  }

  const pinnedReleaseId = effectiveReleaseIds[0];

  if (pinnedReleaseId !== undefined) {
    const pinned = input.releases.find((entry) => entry.row.id === pinnedReleaseId);

    if (pinned === undefined) {
      return {
        witness: null,
        gaps: [familyGap("missing_rule_release", pinnedReleaseId, input.family)],
      };
    }

    if (!qualifies(pinned, input, jurisdiction)) {
      return {
        witness: null,
        gaps: [
          familyGap(
            "inapplicable_release",
            `${pinned.row.id}:${jurisdiction}:${input.date}`,
            input.family,
          ),
        ],
      };
    }

    return sealSelection(input, jurisdiction, pinned, {
      live: effectiveActivations.filter((row) => row.ruleReleaseId === pinned.row.id),
      // A pinned release reached through its own activation names that
      // activation, never another book's or another release's.
      activationFallback: effectiveActivations[0]?.id ?? null,
    });
  }

  const candidates = input.releases.filter((entry) => qualifies(entry, input, jurisdiction));

  if (candidates.length !== 1) {
    return {
      witness: null,
      gaps: [
        familyGap(
          candidates.length === 0 ? "missing_rule_release" : "ambiguous_rule_release",
          candidates.length === 0
            ? `${input.family}:${jurisdiction}`
            : `${input.family}:${jurisdiction}:candidates=${candidates.map((entry) => entry.row.id).join(",")}`,
          input.family,
          [`company_prepare_activation:${input.family}`],
        ),
      ],
    };
  }

  const candidate = candidates[0];

  if (candidate === undefined) {
    return { witness: null, gaps: [familyGap("missing_rule_release", input.family, input.family)] };
  }

  return sealSelection(input, jurisdiction, candidate, {
    live: input.activations.filter(
      (row) => covers(row, input.date) && row.ruleReleaseId === candidate.row.id,
    ),
    // An unactivated preparation has no activation of its own to name.
    activationFallback: null,
  });
}

// One reviewed release, on one family's own date, for one record class. Nothing
// else makes a release eligible: a qualified release for another jurisdiction,
// family, record class or validity window is not a candidate.
function qualifies(entry: Release, input: WitnessInput, jurisdiction: string) {
  return (
    entry.row.jurisdiction === jurisdiction &&
    entry.row.family === input.family &&
    entry.release.qualificationStatus === "reviewed" &&
    entry.release.recordClasses.includes(input.recordClass) &&
    (input.recordClass !== "actual_company" || entry.release.qualification !== undefined) &&
    entry.release.validFrom <= input.date &&
    input.date <= entry.release.validTo
  );
}

// The shared selection tail. Both routes have already chosen their release;
// they differ only in which activations count as live, so confirming the
// required facts and role bindings and sealing the witness happens exactly once
// here rather than once per route.
function sealSelection(
  input: WitnessInput,
  jurisdiction: string,
  candidate: Release,
  activation: {
    readonly live: ReadonlyArray<Db.ActivationRow>;
    readonly activationFallback: string | null;
  },
): Selection {
  const gaps: Array<Gap> = [];
  const facts = confirmFacts(input, candidate, gaps);
  const roleBindingIds = activeRoleBindings(input, candidate, gaps);

  if (!applicabilityHolds(candidate.release.applicability, facts.known)) {
    gaps.push(familyGap("inapplicable_release", candidate.row.id, input.family));
  }

  if (activation.live.length > 1) {
    gaps.push(
      familyGap("overlapping_activation", input.family, input.family, [
        `company_execute_activation:${input.family}`,
      ]),
    );
  }

  if (gaps.length > 0) return { witness: null, gaps };

  return {
    witness: {
      family: input.family,
      recordClass: input.recordClass,
      dates: input.dates,
      selectorDate: input.date,
      jurisdiction,
      ruleReleaseId: candidate.row.id,
      ruleReleaseChecksum: candidate.row.checksum,
      factRevisionIds: facts.revisionIds.sort(),
      factReviewIds: facts.reviewIds.sort(),
      roleBindingIds: roleBindingIds.sort(),
      activationId: activation.live[0]?.id ?? activation.activationFallback,
    },
    gaps,
  };
}

// One review exists per revision, so the selected review identities are the
// selected revision identities. A kind that is missing, unreviewed, ambiguous or
// unestablished is a named gap and never a silent omission.
function confirmFacts(input: WitnessInput, candidate: Release, gaps: Array<Gap>) {
  const revisionIds: Array<string> = [];
  const reviewIds: Array<string> = [];
  const known: Array<{ kind: string; value: string }> = [];

  for (const kind of new Set(["jurisdiction", ...candidate.release.requiredFactKinds])) {
    const matching = input.facts.filter((row) => row.factKind === kind && covers(row, input.date));

    const confirmed = matching.filter((row) =>
      isConfirmed(input.reviews.find((entry) => entry.factRevisionId === row.id)),
    );

    if (confirmed.length !== 1) {
      gaps.push(
        factGap(
          confirmed.length === 0 && matching.length === 0
            ? "unknown_fact"
            : confirmed.length === 0
              ? "unreviewed_fact"
              : "ambiguous_fact",
          kind,
          input.family,
        ),
      );
      continue;
    }

    const row = confirmed[0];

    if (row === undefined) continue;

    if (!isEstablished(row)) {
      gaps.push(factGap("unknown_fact", kind, input.family));
      continue;
    }

    const value = knownValue(row);

    revisionIds.push(row.id);
    reviewIds.push(row.id);

    if (value !== null) known.push({ kind, value });
  }

  return { revisionIds, reviewIds, known };
}

// A role binding is live only when exactly one binding of that kind covers the
// date, its account is active, and the binding still names the account version
// it was reviewed against.
function activeRoleBindings(input: WitnessInput, candidate: Release, gaps: Array<Gap>) {
  const roleBindingIds: Array<string> = [];

  for (const kind of candidate.release.requiredRoleKinds) {
    const matching = input.bindings.filter(
      (row) => row.roleKind === kind && covers(row, input.date),
    );

    if (matching.length !== 1) {
      gaps.push(
        familyGap(
          matching.length === 0 ? "missing_role_binding" : "ambiguous_role_binding",
          kind,
          input.family,
          [`company_prepare_activation:${input.family}`],
        ),
      );
      continue;
    }

    const row = matching[0];
    const account = row === undefined ? undefined : input.accounts.get(row.accountId);

    if (row === undefined) continue;

    if (account === undefined || !account.active) {
      gaps.push(familyGap("inactive_account", row.accountId, input.family));
      continue;
    }

    if (account.version !== row.accountVersion) {
      gaps.push(familyGap("stale_role_binding", row.id, input.family));
      continue;
    }

    roleBindingIds.push(row.id);
  }

  return roleBindingIds;
}

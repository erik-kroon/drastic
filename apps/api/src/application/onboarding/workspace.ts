import { runBookCommand } from "../book-commands";
import { qualifyAttachedControlInTransaction } from "./controls";
import { readOnboardingLifecycleInTransaction } from "./lifecycle";
import * as Effect from "effect/Effect";
import * as Onboarding from "@open-erp/contracts/onboarding";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Profiles from "@open-erp/contracts/company-profiles";
import type * as A from "@open-erp/contracts/accounting";
import * as Db from "../../db/onboarding";
import * as Ledger from "../../db/posting";
import * as ProfileDb from "../../db/company-profiles";
import type { Transaction } from "../../db/transaction";
import { decode, requireTableAccess, withBook } from "../commerce/support";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import { failure } from "../failures";

type Scope = typeof A.Scope.Type;

type Case = typeof Onboarding.OnboardingCase.Type;

type Task = typeof Onboarding.OnboardingTask.Type;

const unknownDates = {
  historyStartsOn: null,
  historyEndsOn: null,
  detailStartsOn: null,
  openingOn: null,
  acceptanceStartsOn: null,
  acceptanceEndsOn: null,
  candidateLiveOn: null,
  provingPeriodEndsOn: null,
};

function currentCase(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const row = (yield* Db.readCurrent(transaction, scope.bookId))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Onboarding.OnboardingCase, row.body);
  });
}

function retainRevision(transaction: Transaction, row: Omit<Case, "digest">) {
  return Effect.gen(function* () {
    const result = yield* decode(Onboarding.OnboardingCase, { ...row, digest: yield* digest(row) });
    yield* Db.insertRevision(transaction, {
      bookId: row.scope.bookId,
      caseId: row.id,
      revision: row.revision,
      body: result,
    });

    return result;
  });
}

export const startOnboarding = Effect.fn("onboarding.start")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Onboarding.StartOnboarding.Type },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* requireTableAccess(transaction, Db.onboardingTables, true);
    yield* Ledger.lockBookForUpdate(transaction, command.scope);
    const operation = "onboarding_start";

    return yield* runBookCommand(
      transaction,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: operation,
        actorId: principal.actorId,
        input: command.input,
      },
      Onboarding.OnboardingCase,
      Effect.gen(function* () {
        if ((yield* Db.readCurrent(transaction, command.scope.bookId)).length > 0)
          return yield* failure("StaleDependency");
        const id = newId("onboarding");
        const recordClass = command.input.path === "demo" ? "synthetic" : "actual_company";
        yield* Db.insertCase(transaction, {
          bookId: command.scope.bookId,
          id,
          path: command.input.path,
          recordClass,
          recordedBy: principal.actorId,
        });

        const result = yield* retainRevision(transaction, {
          id,
          scope: command.scope,
          revision: 1,
          path: command.input.path,
          recordClass,
          configuration: { migrationDepth: null, incumbentSystem: null, dates: unknownDates },
          recordedBy: principal.actorId,
          recordedAt: yield* isoNow(transaction),
        });

        return result;
      }),
    );
  });
});

export const saveOnboarding = Effect.fn("onboarding.save")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Onboarding.SaveOnboarding.Type },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* requireTableAccess(transaction, Db.onboardingTables, true);
    yield* Ledger.lockBookForUpdate(transaction, command.scope);
    const operation = "onboarding_save";

    return yield* runBookCommand(
      transaction,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: operation,
        actorId: principal.actorId,
        input: command.input,
      },
      Onboarding.OnboardingCase,
      Effect.gen(function* () {
        const current = yield* currentCase(transaction, command.scope);

        if (current.revision !== command.input.expectedRevision || current.revision >= 2147483646)
          return yield* failure("StaleDependency");

        const result = yield* retainRevision(transaction, {
          id: current.id,
          scope: command.scope,
          revision: current.revision + 1,
          path: current.path,
          recordClass: current.recordClass,
          configuration: command.input.configuration,
          recordedBy: principal.actorId,
          recordedAt: yield* isoNow(transaction),
        });

        return result;
      }),
    );
  });
});

export const attachOnboardingSource = Effect.fn("onboarding.attachSource")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Onboarding.AttachOnboardingSource.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* requireTableAccess(transaction, Db.onboardingTables, true);
    yield* Ledger.lockBookForUpdate(transaction, command.scope);
    const operation = "onboarding_attach_source";

    return yield* runBookCommand(
      transaction,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: operation,
        actorId: principal.actorId,
        input: command.input,
      },
      Onboarding.OnboardingSource,
      Effect.gen(function* () {
        const current = yield* currentCase(transaction, command.scope);

        const existing = (yield* Db.readLinkedSource(
          transaction,
          command.scope.bookId,
          command.input,
        ))[0];

        let result: typeof Onboarding.OnboardingSource.Type;

        if (existing) {
          result = yield* decode(Onboarding.OnboardingSource, existing.body);
        } else {
          const retained = (yield* Db.readOccurrence(
            transaction,
            command.scope.bookId,
            command.input.occurrenceId,
          ))[0];

          if (!retained) return yield* failure("NotFound");
          const occurrence = yield* decode(Intake.SourceOccurrence, retained.body);
          result = yield* decode(Onboarding.OnboardingSource, {
            id: newId("onboardingsource"),
            caseId: current.id,
            scope: command.scope,
            category: command.input.category,
            occurrence,
            linkedBy: principal.actorId,
            linkedAt: yield* isoNow(transaction),
          });
          yield* Db.insertSource(transaction, {
            bookId: command.scope.bookId,
            caseId: current.id,
            id: result.id,
            occurrenceId: occurrence.id,
            category: result.category,
            body: result,
          });
        }

        yield* qualifyAttachedControlInTransaction(
          transaction,
          command.scope,
          principal.actorId,
          result.occurrence.id,
        );

        return result;
      }),
    );
  });
});

function qualifyProfile(
  transaction: Transaction,
  profile: typeof Profiles.CompanyProfile.Type,
  recordClass: Case["recordClass"],
  payrollHandoff: typeof Onboarding.OnboardingPayrollHandoff.Type | undefined,
) {
  return Effect.gen(function* () {
    const qualification: Array<typeof Onboarding.OnboardingQualification.Type> = [];

    for (const family of profile.families) {
      const additionalGaps: Array<typeof Profiles.ProfileGap.Type> = [];

      if (recordClass === "actual_company" && family.witness !== null) {
        const row = (yield* ProfileDb.readRuleReleases(transaction, family.family)).find(
          (release) => release.id === family.witness?.ruleReleaseId,
        );

        if (row) {
          const release = yield* decode(Profiles.RuleRelease, row.body);

          const required = [
            "base_currency",
            ...(family.family === "statements" ? ["reporting_framework"] : []),
          ];

          if (
            required.some((kind) => !release.requiredFactKinds.some((fact) => fact === kind)) ||
            (release.applicability.baseCurrencies?.length ?? 0) === 0 ||
            (family.family === "statements" &&
              (release.applicability.reportingFrameworks?.length ?? 0) === 0)
          ) {
            additionalGaps.push({
              state: "missing_rule_release",
              subject: "explicit_currency_and_framework_support_required",
              affectedOperations: [`onboarding:${family.family}`],
            });
          }
        }
      }

      const gaps = [...family.gaps, ...additionalGaps];
      qualification.push({
        family: family.family,
        state:
          family.family === "payroll"
            ? payrollHandoff
              ? "supported_with_handoff"
              : "not_supported"
            : family.status === "resolved" && additionalGaps.length === 0
              ? "supported"
              : family.gaps.some((gap) => gap.state === "inapplicable_release")
                ? "not_supported"
                : "needs_information",
        scope: "dated_profile_witness_only",
        witness: family.witness,
        gaps,
        reason:
          family.family === "payroll"
            ? payrollHandoff
              ? `Tidigare löneperioder ligger kvar i ${payrollHandoff.incumbentSystem} till och med ${payrollHandoff.retainedThrough}.`
              : "Tidigare löneperioder behöver en kvalificerad överlämning."
            : family.status === "resolved" && additionalGaps.length === 0
              ? "The existing owner resolved this dated profile. Complete workflow qualification and external outcomes remain separate."
              : "Reviewed company facts, rule releases or activation are missing for this date.",
      });
    }

    return qualification;
  });
}

export const getOnboardingHistory = Effect.fn("onboarding.history")(function* (
  token: string,
  command: { scope: Scope; before?: number },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, Db.onboardingTables, false);
    yield* Ledger.lockBookForShare(transaction, command.scope);
    yield* currentCase(transaction, command.scope);

    const rows = yield* Db.readHistory(
      transaction,
      command.scope.bookId,
      command.before ?? 2147483647,
    );

    const items: Case[] = [];

    for (const row of rows.slice(0, 50))
      items.push(yield* decode(Onboarding.OnboardingCase, row.body));

    return {
      scope: command.scope,
      items,
      nextBeforeRevision: rows.length > 50 ? (items.at(-1)?.revision ?? null) : null,
    };
  });
});

function tasks(
  profileComplete: boolean,
  scopeComplete: boolean,
  hasSources: boolean,
  hasOperators: boolean,
): Task[] {
  return [
    {
      id: "company",
      state: profileComplete ? "in_progress" : "needs_information",
      owner: "companyProfile",
      blockers: ["complete_company_fact_inventory_required"],
    },
    {
      id: "compatibility",
      state: "in_progress",
      owner: "companyProfile",
      blockers: ["full_capability_matrix_not_qualified"],
    },
    {
      id: "sources",
      state: hasSources ? "in_progress" : "needs_information",
      owner: "sourceIntake",
      blockers: ["source_coverage_not_established"],
    },
    {
      id: "import",
      state: scopeComplete && hasSources ? "in_progress" : "needs_information",
      owner: "historicalMigration",
      blockers: ["historical_import_acceptance_required"],
    },
    {
      id: "opening",
      state: "needs_information",
      owner: "historicalMigration",
      blockers: ["authoritative_opening_control_required"],
    },
    {
      id: "reconciliation",
      state: "needs_information",
      owner: "bankInventorySignoff",
      blockers: ["independent_book_zero_controls_required"],
    },
    {
      id: "responsibilities",
      state: hasOperators ? "in_progress" : "needs_information",
      owner: "identity",
      blockers: ["capability_responsibility_policy_required"],
    },
    {
      id: "final_delta",
      state: "blocked",
      owner: "historicalMigration",
      blockers: ["accepted_book_zero_and_final_delta_required"],
    },
    {
      id: "cutover",
      state: "blocked",
      owner: "operations",
      blockers: ["restore_and_single_writer_proof_required"],
    },
    {
      id: "go_live",
      state: "blocked",
      owner: "operations",
      blockers: ["authorized_writer_promotion_required"],
    },
    {
      id: "proving_period",
      state: "blocked",
      owner: "closing",
      blockers: ["authoritative_live_boundary_required"],
    },
  ];
}

function completedLifecycleTasks(lifecycle: typeof Onboarding.OnboardingLifecycle.Type) {
  const accepted = (purpose: typeof Onboarding.OnboardingPurpose.Type) =>
    lifecycle.snapshots.some(
      (view) =>
        view.current &&
        view.snapshot.purpose === purpose &&
        lifecycle.decisions.some(
          (decision) =>
            decision.snapshotId === view.snapshot.id &&
            decision.decision.kind === `accept_${purpose}`,
        ) &&
        !lifecycle.decisions.some(
          (decision) =>
            decision.snapshotId === view.snapshot.id && decision.decision.kind === "reject",
        ),
    );

  const completeTasks = new Set<Task["id"]>();

  if (accepted("opening")) completeTasks.add("opening");

  if (accepted("book_zero")) completeTasks.add("reconciliation");

  if (accepted("final_delta")) completeTasks.add("final_delta");

  if (lifecycle.responsibilities !== null) completeTasks.add("responsibilities");

  if (lifecycle.activation !== null) {
    completeTasks.add("cutover");
    completeTasks.add("go_live");
  }

  if (lifecycle.completion?.current === true) completeTasks.add("proving_period");

  return completeTasks;
}

export const getOnboarding = Effect.fn("onboarding.get")(function* (
  token: string,
  command: { scope: Scope; sourceAfter?: string; importAfter?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireTableAccess(transaction, Db.onboardingTables, false);
    yield* Ledger.lockBookForShare(transaction, command.scope);
    const current = yield* currentCase(transaction, command.scope);
    const dates = current.configuration.dates;

    const profile = yield* resolveCompanyProfileInTransaction(
      transaction,
      command.scope,
      current.recordClass,
      {
        postingOn: dates.acceptanceEndsOn,
        taxPointOn: dates.acceptanceEndsOn,
        paymentOn: null,
        reportOn: dates.acceptanceEndsOn,
        taxPeriodOn: null,
      },
    );

    const sourceRows = yield* Db.readSources(
      transaction,
      command.scope.bookId,
      command.sourceAfter ?? "",
    );

    const sources: Array<typeof Onboarding.OnboardingSource.Type> = [];

    for (const row of sourceRows.slice(0, 50))
      sources.push(yield* decode(Onboarding.OnboardingSource, row.body));
    const sourceCount = (yield* Db.sourceCount(transaction, command.scope.bookId))[0]?.count ?? "0";

    const importRows = yield* Db.readImports(
      transaction,
      command.scope.bookId,
      command.importAfter ?? "",
    );

    const hasOperators =
      BigInt((yield* Db.readOperatorCount(transaction, command.scope.bookId))[0]?.count ?? "0") >
      0n;

    const scopeComplete =
      current.configuration.migrationDepth !== null &&
      dates.historyStartsOn !== null &&
      dates.historyEndsOn !== null &&
      (current.configuration.migrationDepth === "opening_only" || dates.detailStartsOn !== null) &&
      dates.openingOn !== null &&
      dates.acceptanceStartsOn !== null &&
      dates.acceptanceEndsOn !== null &&
      dates.candidateLiveOn !== null;

    const profileComplete =
      profile.families.find((family) => family.family === "posting_eligibility")?.status ===
      "resolved";

    const lifecycle = yield* readOnboardingLifecycleInTransaction(
      transaction,
      command.scope,
      principal.actorId,
    );

    const payrollHandoff = lifecycle.controls.find(
      (control) =>
        control.kind === "historical_payroll_handoff" &&
        control.payrollHandoff?.incumbentSystem === current.configuration.incumbentSystem &&
        control.payrollHandoff.historyStartsOn === dates.historyStartsOn &&
        control.payrollHandoff.retainedThrough === dates.historyEndsOn,
    )?.payrollHandoff;

    const qualification = yield* qualifyProfile(
      transaction,
      profile,
      current.recordClass,
      payrollHandoff,
    );

    const completeTasks = completedLifecycleTasks(lifecycle);

    const work = tasks(profileComplete, scopeComplete, BigInt(sourceCount) > 0n, hasOperators).map(
      (task) =>
        completeTasks.has(task.id) ? { ...task, state: "complete" as const, blockers: [] } : task,
    );

    return yield* decode(Onboarding.OnboardingWorkspace, {
      case: current,
      checkedAt: yield* isoNow(transaction),
      profile,
      qualification,
      sources,
      nextSourceCursor: sourceRows.length > 50 ? (sources.at(-1)?.id ?? null) : null,
      sourceCount,
      sourceCoverage: "not_established",
      imports: importRows.slice(0, 50),
      nextImportCursor: importRows.length > 50 ? (importRows[49]?.sourceRunId ?? null) : null,
      tasks: work,
      cutover: {
        ready: false,
        authority: lifecycle.activation !== null ? "native" : "not_established",
        candidateLiveOn: dates.candidateLiveOn,
        blockers: [...new Set(work.flatMap((task) => task.blockers))],
      },
    });
  });
});

export {
  qualifyOnboardingControl,
  saveOnboardingResponsibilities,
  captureOnboardingSnapshot,
  decideOnboardingSnapshot,
  requestOnboardingActivation,
  completeOnboardingFirstPeriod,
  getOnboardingLifecycle,
  executeOnboardingActivationInTransaction,
} from "./lifecycle";

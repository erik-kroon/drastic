import {
  type Plan,
  type Action,
  VoucherSchema,
  ActionSchema,
  manualJournalContext,
  type ManualContext,
  decode,
  voucherFromRow,
  readVoucher,
  readBook,
  readPeriod,
  isCompanyManualAction,
  readManualAdmission,
  validateActionWithContext,
  validatePlanWithContext,
} from "./posting-validation";
import { type Scope, executionApproval } from "./posting-approval";
import { runBookCommand } from "./book-commands";
import { admitOAuthRead, McpReadResource } from "../db/oauth-admission";
import { collectPostingActorBasis, collectPostingPrincipalBasis } from "./posting-authority";
import { requireBookResponsibility } from "./book-responsibility";
import * as OnboardingCaseDb from "../db/onboarding";
import * as OnboardingLifecycleDb from "../db/onboarding-lifecycle";
import * as SupplierSettlementDb from "../db/purchases/supplier-settlements";
import * as SupplierAcceptanceDb from "../db/purchases/acceptance";
import { equalJson } from "@open-erp/domain/canonicalization";
import { swedishBusinessDate } from "@open-erp/domain/values";
import {
  admitPosting,
  admitPayrollRun,
  admitTreasuryLoan,
  admitPayrollInput,
  admitForeignCash,
  admitAssetProceeds,
  admitProcessor,
  admitPayrollSettlement,
  admitScheduleEvent,
  type PostingOwner,
} from "./posting-admission";
import { recordHistoricalOpening } from "../db/posting-admission";
import {
  applyOriginalAssignmentsInTransaction,
  resolveAssignmentsInTransaction,
} from "./dimensions/assignments";
import * as Accounting from "@open-erp/contracts/accounting";

import { versionedDigest } from "./json";
import { resolveCompanyProfileInTransaction } from "./company-profiles";

import { replay, saveCommand, isoNow } from "./command-receipts";
import { newId } from "./identifiers";
import { sha256Hex } from "./hashing";

import { ExecutionReceipt as DomainExecutionReceipt } from "@open-erp/domain/ledger";
import { orderPostingGroups, reversedLines } from "@open-erp/domain/posting";
import { assertPeriodWorkFence } from "./period-work-fence";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "./identity";
import * as Db from "../db/posting";
import { readLiveCredential } from "../db/preparation-jobs";
import { admitHumanActor, hashToken } from "../db/human-actor";
import * as CorrectionDb from "../db/posting-corrections";
import { databaseFailure, withTransaction, type Transaction } from "../db/transaction";

type ExecutionReceipt = typeof Accounting.ExecutionReceipt.Type;

type Principal = VerifiedPrincipal;

type PrepareJournalCommand =
  typeof import("@open-erp/contracts/capabilities").Capabilities.ledger_prepare_journal.input.Type;

const PlanSchema = Accounting.ChangeSet;

const ApprovalSchema = Accounting.Approval;

const ValidationSchema = Accounting.ValidationReport;

const ReceiptSchema = Accounting.ExecutionReceipt;

const GroupReceiptSchema = Accounting.GroupReceipt;

const BookSetupSchema = Accounting.BookSetup;

const BookStatusSchema = Accounting.BookStatus;

const BookDirectorySchema = Schema.Array(Accounting.Book);

// Only an owning legal application operation may present these purposes. Every other
// posting purpose stays synthetic and manual.

// Only the financial-close application operation may present this purpose. It
// moves the sealed transfer delta and nothing else; the statement owner
// recognizes its vouchers as owned transfers through the retained purpose.

const EvidenceSchema = Accounting.Evidence;

const EvidenceContentSchema = Accounting.EvidenceContent;

function withBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  lockMode: AuthorityLockMode,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown>,
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function readPlan(transaction: Transaction, scope: Scope, changeSetId: string) {
  return Db.readPlan(transaction, scope.bookId, changeSetId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      if (!row) return failure("NotFound");

      return decode(PlanSchema, row.plan);
    }),
  );
}

function isAssetProceedsOwner(owner: PostingOwner | undefined) {
  return owner?.kind === "asset_proceeds_disposal";
}

const admitRetainedPlanOwnership = Effect.fn("posting.admitRetainedPlanOwnership")(function* (
  transaction: Transaction,
  command: { scope: Scope; changeSetId: string; owner?: PostingOwner },
) {
  const plan = yield* readPlan(transaction, command.scope, command.changeSetId);

  for (const group of plan.groups) {
    for (const action of group.actions) {
      yield* admitScheduleEvent(transaction, command.scope, action.eventId);
      yield* admitPayrollInput(
        transaction,
        command.scope,
        command.changeSetId,
        command.owner,
        action,
      );
      yield* admitForeignCash(transaction, command.scope, command.owner, action);
      yield* admitProcessor(transaction, command.scope, command.changeSetId, command.owner, action);
      yield* admitAssetProceeds(
        transaction,
        command.scope,
        command.changeSetId,
        command.owner,
        action,
      );
      yield* admitPayrollSettlement(
        transaction,
        command.scope,
        command.changeSetId,
        command.owner,
        action,
      );
      yield* admitTreasuryLoan(
        transaction,
        command.scope,
        command.changeSetId,
        command.owner,
        action,
      );
      yield* admitPayrollRun(
        transaction,
        command.scope,
        command.changeSetId,
        command.owner,
        action,
      );
    }
  }
});

function lockPlan(transaction: Transaction, scope: Scope, changeSetId: string) {
  return Db.lockPlan(transaction, scope.bookId, changeSetId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      if (!row) return failure("NotFound");

      return decode(PlanSchema, row.plan);
    }),
  );
}

const retainedManualContext = Effect.fn("posting.retainedManualContext")(function* (
  transaction: Transaction,
  scope: Scope,
  plan: Plan,
  owner?: PostingOwner,
  allowCorrectionChild = false,
) {
  const attached = plan.groups.some((group) =>
    group.actions.some((action) => action.manualCompanyAdmission !== undefined),
  );

  if (!attached) return undefined;

  const action = plan.groups[0]?.actions[0];

  if (
    owner !== undefined ||
    allowCorrectionChild ||
    !equalJson(plan.scope, scope) ||
    plan.groups.length !== 1 ||
    plan.groups[0]?.actions.length !== 1 ||
    !action ||
    !isCompanyManualAction(action)
  )
    return yield* failure("UnsupportedProfile");

  const receipts = yield* Db.readManualPreparation(transaction, scope.bookId, plan.id);

  if (!receipts.some((receipt) => equalJson(receipt.result, plan)))
    return yield* failure("UnsupportedProfile");

  return manualJournalContext;
});

export function validateAction(
  transaction: Transaction,
  scope: Scope,
  book: { currency: string; profile: string; authority: string },
  action: Action,
  allowLegal = false,
  allowTransfer = false,
  allowAsset = false,
) {
  return validateActionWithContext(
    transaction,
    scope,
    book,
    action,
    allowLegal,
    allowTransfer,
    allowAsset,
  );
}

export const validateManualJournalPlanInTransaction = Effect.fn(
  "posting.validateManualJournalPlanInTransaction",
)(function* (transaction: Transaction, scope: Scope, plan: Plan) {
  const manualContext = yield* retainedManualContext(transaction, scope, plan);

  return yield* validatePlanWithContext(
    transaction,
    scope,
    plan,
    false,
    false,
    false,
    manualContext,
  );
});

export const createEvidenceInTransaction = Effect.fn("posting.createEvidenceInTransaction")(
  function* (
    transaction: Transaction,
    principal: Principal,
    command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Accounting.CreateEvidence.Type;
    },
  ) {
    return yield* Effect.gen(function* () {
      return yield* runBookCommand(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "create_evidence",
          actorId: principal.actorId,
          input: command.input,
        },
        EvidenceSchema,
        Effect.gen(function* () {
          if (command.input.mediaType === "application/json") {
            yield* Effect.try({
              try: () => JSON.parse(command.input.content),
              catch: () => failure("MissingEvidence"),
            });
          }

          const sha256 = yield* sha256Hex(command.input.content);
          const createdAt = yield* isoNow(transaction);
          const existing = yield* Db.readEvidenceBySha(transaction, command.scope.bookId, sha256);

          const row =
            existing[0] ??
            (yield* Db.insertEvidence(transaction, {
              bookId: command.scope.bookId,
              id: newId("evidence"),
              title: command.input.title,
              content: command.input.content,
              mediaType: command.input.mediaType,
              origin: command.input.origin,
              sha256,
              createdBy: principal.actorId,
              createdAt,
            }))[0];

          if (!row) return yield* failure("InternalError");

          const result = yield* decode(EvidenceSchema, {
            id: row.id,
            title: row.title,
            sha256: row.sha256,
            mediaType: row.mediaType,
            origin: row.origin,
            createdAt: row.createdAt,
          });

          return result;
        }),
      );
    });
  },
);

export const createEvidence = Effect.fn("posting.createEvidence")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Accounting.CreateEvidence.Type;
  },
) {
  return yield* withBook(token, command.scope, false, "update", (transaction, principal) =>
    createEvidenceInTransaction(transaction, principal, command),
  );
});

export const getEvidence = Effect.fn("posting.getEvidence")(function* (
  token: string,
  command: { scope: Scope; evidenceId: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      const row = (yield* Db.readEvidence(
        transaction,
        command.scope.bookId,
        command.evidenceId,
      ))[0];

      if (!row) return yield* failure("NotFound");

      return yield* decode(EvidenceContentSchema, row);
    }),
  );
});

function admitBookDirectoryActor(transaction: Transaction, token: string) {
  return Effect.gen(function* () {
    if (token.length < 32 || token.length > 512) return yield* failure("Unauthorized");
    const credentialHash = yield* hashToken(token);
    const credential = (yield* readLiveCredential(transaction, credentialHash))[0];

    if (credential) return credential.actorId;

    return (yield* admitHumanActor(transaction, token).pipe(
      Effect.catchTag("AccountingError", (error) =>
        error.code === "Forbidden" ? failure("Unauthorized") : Effect.fail(error),
      ),
    )).actorId;
  });
}

export const listBooks = Effect.fn("posting.listBooks")(function* (token: string) {
  return yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      const oauth =
        (yield* McpReadResource) === null
          ? null
          : yield* admitOAuthRead(transaction, yield* hashToken(token));

      const actorId = oauth?.actorId ?? (yield* admitBookDirectoryActor(transaction, token));
      const admission = yield* Db.readActorAdmission(transaction, actorId);

      if (admission[0]?.enabled === false) return yield* failure("Unauthorized");
      const rows = yield* Db.readBooksForActor(transaction, actorId);

      return yield* Schema.decodeEffect(BookDirectorySchema)(
        rows
          .filter((row) => oauth === null || row.id === oauth.bookId)
          .map((row) => ({
            entityId: row.entityId,
            id: row.id,
            name: row.name,
            currency: row.currency,
            profile: row.profile,
            role: row.role,
            sequence: row.sequence.toString(),
          })),
      ).pipe(Effect.mapError((cause) => failure("InternalError", cause)));
    }),
  );
});

export const bookSetup = Effect.fn("posting.bookSetup")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const book = yield* readBook(transaction, command.scope);
      const accountRows = yield* Db.readAllAccounts(transaction, command.scope.bookId);
      const periodRows = yield* Db.readAllPeriods(transaction, command.scope.bookId);
      const now = yield* DateTime.now;

      return yield* decode(BookSetupSchema, {
        today: swedishBusinessDate(DateTime.toDateUtc(now)),
        accounts: accountRows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          active: row.active,
        })),
        periods: periodRows.map((row) => ({
          id: row.id,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          locked: row.locked,
        })),
        blockers:
          (book.profile === "synthetic-core-v1" || book.profile === "company-setup-v1") &&
          book.authority === "native"
            ? []
            : ["The book profile or writer authority is not supported."],
        warnings: [
          "Company manual journals require an activated dated manual-journal release. Other operations have their own company-profile requirements.",
          "This book has not been verified for live company accounting. Source completeness, archive recovery and statutory outcomes require separate evidence.",
        ],
      });
    }),
  );
});

export const bookStatus = Effect.fn("posting.bookStatus")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const book = yield* readBook(transaction, command.scope);
      const today = swedishBusinessDate(new Date(yield* isoNow(transaction)));

      const admission = yield* resolveCompanyProfileInTransaction(
        transaction,
        command.scope,
        "actual_company",
        {
          postingOn: today,
          taxPointOn: today,
          paymentOn: today,
          reportOn: today,
        },
      );

      const companyManualAvailable =
        book.profile === "company-setup-v1" && book.authority === "native"
          ? yield* readManualAdmission(
              transaction,
              command.scope,
              book,
              today,
              "UnsupportedProfile",
            ).pipe(
              Effect.as(true),
              Effect.catchIf(
                (error) =>
                  error instanceof Accounting.AccountingError &&
                  error.code === "UnsupportedProfile",
                () => Effect.succeed(false),
              ),
            )
          : false;

      return yield* decode(BookStatusSchema, {
        scope: command.scope,
        profile: book.profile,
        writerAuthority: book.authority,
        sequence: book.committedSequence.toString(),
        productionReady: false,
        verification: "not_verified",
        features: [
          {
            id: "journals",
            installed: true,
            available:
              (book.profile === "synthetic-core-v1" && book.authority === "native") ||
              companyManualAvailable,
            limitation:
              "Exact manual journals only. Company journals require a dated activated manual release; execution requires operator approval. Source completeness and statutory outcomes remain separate.",
          },
          ...admission.families.map((family) => ({
            id: `company_profile:${family.family}`,
            installed: true,
            available: family.status === "resolved",
            limitation:
              family.status === "resolved"
                ? `Admitted for ${family.selectorDate ?? "no date"} against a reviewed release and reviewed role bindings.`
                : family.gaps.map((gap) => `${gap.state}: ${gap.subject}`).join("; "),
          })),
          ...admission.ownerBoundFamilies.map((family) => ({
            id: `company_profile:${family.family}`,
            installed: true,
            available: family.admitted,
            limitation: family.admitted ? `Admitted by ${family.activationOwner}.` : family.effect,
          })),
        ],
        blockers: [
          ...admission.families
            .filter((family) => family.status !== "resolved")
            .map((family) => ({
              code: `CompanyAdmissionRequired:${family.family}`,
              message:
                "This family is not admitted for the requested date. Record and independently review its facts, then activate it.",
              requiredInputs: family.gaps.flatMap((gap) => gap.affectedOperations),
            })),
          ...admission.ownerBoundFamilies
            .filter((family) => !family.admitted)
            .map((family) => ({
              code: `CompanyAdmissionRequired:${family.family}`,
              message: `${family.family} is not admitted. ${family.effect}`,
              requiredInputs: [`${family.activationOwner}`],
            })),
        ],
      });
    }),
  );
});

const prepareJournalWithContext = Effect.fn("posting.prepareJournalWithContext")(function* (
  transaction: Transaction,
  principal: Principal,
  command: PrepareJournalCommand,
  manualContext?: ManualContext,
) {
  return yield* Effect.gen(function* () {
    const book = yield* readBook(transaction, command.scope);

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "prepare_journal",
      principal.actorId,
      command.input,
      PlanSchema,
    );

    if (request.previous) {
      if (
        manualContext !== manualJournalContext &&
        request.previous.groups.some((group) =>
          group.actions.some((action) => action.manualCompanyAdmission !== undefined),
        )
      )
        return yield* failure("UnsupportedProfile");

      return request.previous;
    }

    if (book.profile === "company-setup-v1" && manualContext !== manualJournalContext)
      return yield* failure("UnsupportedProfile");

    const evidenceRows = yield* Db.readEvidence(
      transaction,
      command.scope.bookId,
      command.input.evidenceId,
    );

    const source = evidenceRows[0];

    if (!source) return yield* failure("MissingEvidence");

    const admission =
      book.profile === "company-setup-v1"
        ? yield* readManualAdmission(
            transaction,
            command.scope,
            book,
            command.input.postingDate,
            "UnsupportedProfile",
          )
        : undefined;

    const period = yield* readPeriod(transaction, command.scope, command.input.accountingPeriodId);

    const eventRows = yield* Db.readEvent(
      transaction,
      command.scope.bookId,
      source.id,
      command.input.eventKey,
    );

    const eventId = eventRows[0]?.id ?? newId("event");

    if (eventRows.length === 0) {
      yield* Db.insertEvent(
        transaction,
        command.scope.bookId,
        eventId,
        source.id,
        command.input.eventKey,
      );
    }

    const actionFields = {
      kind: "post_voucher" as const,
      correctsVoucherId: null,
      eventId,
      postingPurpose: "adjustment" as const,
      occurrenceKey: "manual_journal",
      fiscalYearId: period.fiscalYearId,
      accountingPeriodId: command.input.accountingPeriodId,
      postingDate: command.input.postingDate,
      series: command.input.series,
      currency: book.currency,
      description: command.input.description,
      rationale: command.input.rationale,
      taxAssessment: command.input.taxAssessment,
      lines: command.input.lines.map((line) => ({ ...line, lineId: newId("line") })),
      evidenceRefs: [
        {
          evidenceId: source.id,
          sha256: source.sha256,
          locator: command.input.eventKey,
        },
      ],
    };

    // A reviewed dimension policy travels with the proposal. A book with no
    // dimension effective at the posting date carries none, and a line with
    // none keeps exactly the shape it had.
    const reviewed = command.input.dimensionPolicy;

    let actionValue: typeof Accounting.PostingAction.Type = actionFields;

    if (reviewed) actionValue = { ...actionValue, dimensionPolicy: [...reviewed] };

    if (admission) actionValue = { ...actionValue, manualCompanyAdmission: admission };

    const action = yield* decode(ActionSchema, actionValue);

    yield* validateActionWithContext(
      transaction,
      command.scope,
      book,
      action,
      false,
      false,
      false,
      manualContext,
    );

    // NEXT-14. Resolve and seal the original dimension assignment of every
    // line before the proposal is hashed, so approval covers exactly the
    // assignment set execution will retain.
    const assigned = yield* resolveAssignmentsInTransaction(transaction, command.scope, action);

    const createdAt = yield* isoNow(transaction);
    const changeSetId = newId("change");
    const groupId = newId("group");

    const planValue = {
      schemaVersion: "1" as const,
      canonicalization: "openerp-c14n-v1" as const,
      id: changeSetId,
      version: 1 as const,
      scope: command.scope,
      createdAt,
      dependencies: [
        {
          kind: "profile" as const,
          resourceId: book.id,
          version: book.profileVersion.toString(),
          reason: "Book currency and supported profile",
        },
        {
          kind: "writer_epoch" as const,
          resourceId: book.id,
          version: book.writerEpoch.toString(),
          reason: "Single authoritative writer",
        },
        {
          kind: "period" as const,
          resourceId: period.id,
          version: period.version.toString(),
          reason: "Posting dates and lock state",
        },
      ],
      groups: [
        {
          id: groupId,
          dependsOnGroupIds: [],
          actions: [assigned],
        },
      ],
    };

    const accountRows = yield* Db.readAccounts(
      transaction,
      command.scope.bookId,
      assigned.lines.map((line) => line.accountId),
    );

    const accountDependencies = accountRows.map((account) => ({
      kind: "account" as const,
      resourceId: account.id,
      version: account.version.toString(),
      reason: "Exact account configuration",
    }));

    const planWithoutDigest = {
      ...planValue,
      dependencies: [...planValue.dependencies, ...accountDependencies],
    };

    const planDigest = yield* versionedDigest(planWithoutDigest);
    const plan = yield* decode(PlanSchema, { ...planWithoutDigest, planDigest });
    yield* Db.insertPlan(transaction, {
      bookId: command.scope.bookId,
      id: changeSetId,
      plan,
      digest: planDigest,
      createdBy: principal.actorId,
    });
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "prepare_journal",
      principal.actorId,
      plan,
    );

    return plan;
  });
});

export const prepareJournalInTransaction = Effect.fn("posting.prepareJournalInTransaction")(
  function* (transaction: Transaction, principal: Principal, command: PrepareJournalCommand) {
    return yield* prepareJournalWithContext(transaction, principal, command);
  },
);

export const prepareManualJournalInTransaction = Effect.fn(
  "posting.prepareManualJournalInTransaction",
)(function* (transaction: Transaction, principal: Principal, command: PrepareJournalCommand) {
  return yield* prepareJournalWithContext(transaction, principal, command, manualJournalContext);
});

export const prepareJournal = Effect.fn("posting.prepareJournal")(function* (
  token: string,
  command: typeof import("@open-erp/contracts/capabilities").Capabilities.ledger_prepare_journal.input.Type,
) {
  return yield* withBook(token, command.scope, false, "update", (transaction, principal) =>
    prepareManualJournalInTransaction(transaction, principal, command),
  );
});

export const getChange = Effect.fn("posting.getChange")(function* (
  token: string,
  command: { scope: Scope; changeSetId: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      return yield* readPlan(transaction, command.scope, command.changeSetId);
    }),
  );
});

export const validateChange = Effect.fn("posting.validateChange")(function* (
  token: string,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
  },
) {
  return yield* withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const plan = yield* readPlan(transaction, command.scope, command.changeSetId);
      const manualContext = yield* retainedManualContext(transaction, command.scope, plan);

      return yield* runBookCommand(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "validate_change",
          actorId: principal.actorId,
          input: { id: command.changeSetId },
        },
        ValidationSchema,
        Effect.gen(function* () {
          yield* validatePlanWithContext(
            transaction,
            command.scope,
            plan,
            false,
            false,
            false,
            manualContext,
          );

          const result = {
            changeSetId: plan.id,
            planDigest: plan.planDigest,
            status: "valid" as const,
            checkedAt: yield* isoNow(transaction),
          };

          const decoded = yield* decode(ValidationSchema, result);

          return decoded;
        }),
      );
    }),
  );
});

export const approveChangeInTransaction = Effect.fn("posting.approveChangeInTransaction")(
  function* (
    transaction: Transaction,
    principal: Principal,
    command: {
      scope: Scope;
      changeSetId: string;
      idempotencyKey: string;
      input: typeof Accounting.ApproveChange.Type;
      owner?: PostingOwner;
    },
  ) {
    return yield* Effect.gen(function* () {
      const retained = yield* readPlan(transaction, command.scope, command.changeSetId);

      const manualContext = yield* retainedManualContext(
        transaction,
        command.scope,
        retained,
        command.owner,
      );

      yield* admitRetainedPlanOwnership(transaction, command);

      yield* readSupplierPostingReservation(transaction, command);

      if (
        (yield* CorrectionDb.readBundleByChangeSet(
          transaction,
          command.scope.bookId,
          command.changeSetId,
        )).length > 0
      ) {
        return yield* failure("UnsupportedProfile");
      }

      return yield* runBookCommand(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "approve_change",
          actorId: principal.actorId,
          input: { id: command.changeSetId, input: command.input },
        },
        ApprovalSchema,
        Effect.gen(function* () {
          yield* requireBookResponsibility(
            transaction,
            command.scope,
            principal.actorId,
            "bookkeepingApproverId",
          );
          const plan = yield* readPlan(transaction, command.scope, command.changeSetId);

          if (
            command.input.planDigest !== plan.planDigest ||
            command.input.version !== plan.version
          ) {
            return yield* failure("StaleDependency");
          }

          yield* validatePlanWithContext(
            transaction,
            command.scope,
            plan,
            command.owner?.kind === "legal_issue" || command.owner?.kind === "legal_credit",
            command.owner?.kind === "financial_close",
            isAssetProceedsOwner(command.owner),
            manualContext,
          );

          if (command.owner !== undefined || manualContext === manualJournalContext) {
            for (const group of plan.groups) {
              for (const action of group.actions) {
                yield* admitPosting(transaction, command.scope, plan.id, action, command.owner);
              }
            }
          }

          if (
            (yield* Db.readVoucherByChangeSet(transaction, command.scope.bookId, plan.id)).length >
            0
          ) {
            return yield* failure("AlreadyPosted");
          }

          const now = yield* Db.readDatabaseTime(transaction);
          const expiresAt = new Date(Date.parse(now.now) + 60 * 60 * 1000).toISOString();

          const approval = yield* Db.insertApproval(transaction, {
            bookId: command.scope.bookId,
            id: newId("approval"),
            changeSetId: plan.id,
            digest: plan.planDigest,
            actorId: principal.actorId,
            expiresAt,
            authorityBasis: yield* collectPostingPrincipalBasis(
              transaction,
              command.scope,
              principal,
              "approve_change",
            ),
          }).pipe(
            Effect.flatMap((rows) =>
              rows[0] ? Effect.succeed(rows[0]) : failure("InternalError"),
            ),
          );

          const result = yield* decode(ApprovalSchema, {
            id: approval.id,
            changeSetId: approval.changeSetId,
            planDigest: approval.digest,
            actorId: approval.actorId,
            expiresAt: approval.expiresAt,
          });

          return result;
        }),
      );
    });
  },
);

export const approveChange = Effect.fn("posting.approveChange")(function* (
  token: string,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
    input: typeof Accounting.ApproveChange.Type;
  },
) {
  return yield* withBook(token, command.scope, true, "update", (transaction, principal) =>
    approveChangeInTransaction(transaction, principal, command),
  );
});

function assertPlanUnposted(transaction: Transaction, scope: Scope, plan: Plan) {
  return Effect.gen(function* () {
    if ((yield* Db.readVoucherByChangeSet(transaction, scope.bookId, plan.id)).length > 0) {
      return yield* failure("AlreadyPosted");
    }

    for (const group of plan.groups) {
      for (const action of group.actions) {
        if (
          (yield* Db.readVoucherByEconomicIdentity(transaction, scope.bookId, action)).length > 0
        ) {
          return yield* failure("AlreadyPosted");
        }

        if (
          action.postingPurpose === "reversal" &&
          action.correctsVoucherId &&
          (yield* Db.readVoucherByReversal(transaction, scope.bookId, action.correctsVoucherId))
            .length > 0
        ) {
          return yield* failure("AlreadyPosted");
        }
      }
    }
  });
}

// Current approval authority for an exact plan digest. Named operations that seal
// their own plan reuse this rather than repeating the consumption, membership,
// admission, revocation and expiry checks.

function requireOnboardingPostingAuthority(
  transaction: Transaction,
  scope: Scope,
  owner?: PostingOwner,
) {
  return Effect.gen(function* () {
    const onboardingCases = yield* OnboardingCaseDb.readCurrent(transaction, scope.bookId);

    if (
      onboardingCases.length > 0 &&
      owner?.kind !== "historical_import" &&
      owner?.kind !== "onboarding_delta" &&
      (yield* OnboardingLifecycleDb.readRecords(transaction, "activations", scope.bookId))
        .length === 0
    )
      return yield* failure("ApprovalRequired");
  });
}

export const executeChangeInTransaction = Effect.fn("posting.execute")(function* (
  transaction: Transaction,
  principal: Principal,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
    input: typeof Accounting.ExecuteChange.Type;
    allowCorrectionChild?: boolean;
    owner?: PostingOwner;
  },
) {
  return yield* Effect.gen(function* () {
    const retained = yield* readPlan(transaction, command.scope, command.changeSetId);

    const manualContext = yield* retainedManualContext(
      transaction,
      command.scope,
      retained,
      command.owner,
      command.allowCorrectionChild === true,
    );

    yield* admitRetainedPlanOwnership(transaction, command);

    const settlement = yield* readSupplierPostingReservation(transaction, command);

    return yield* runBookCommand(
      transaction,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: "execute_change",
        actorId: principal.actorId,
        input: { id: command.changeSetId, input: command.input },
      },
      ReceiptSchema,
      Effect.gen(function* () {
        yield* requireOnboardingPostingAuthority(transaction, command.scope, command.owner);

        yield* assertPeriodWorkFence(transaction, command.scope.bookId, command.changeSetId);

        const plan = yield* lockPlan(transaction, command.scope, command.changeSetId);

        if (
          command.input.planDigest !== plan.planDigest ||
          command.input.version !== plan.version
        ) {
          return yield* failure("StaleDependency");
        }

        if (
          command.allowCorrectionChild !== true &&
          (yield* CorrectionDb.readBundleByChangeSet(
            transaction,
            command.scope.bookId,
            command.changeSetId,
          )).length > 0
        ) {
          return yield* failure("UnsupportedProfile");
        }

        const groupOrder = orderPostingGroups(
          plan.groups.map((group) => ({
            id: group.id,
            dependsOnGroupIds: group.dependsOnGroupIds,
          })),
        );

        if (Result.isFailure(groupOrder)) return yield* failure("InvalidJournal");

        if (plan.groups.length !== 1 || plan.groups[0]?.actions.length !== 1) {
          return yield* failure("UnsupportedProfile");
        }

        const group = plan.groups[0];
        const actionValue = group?.actions[0];

        if (!group || !actionValue) return yield* failure("InvalidJournal");
        const action = yield* decode(ActionSchema, actionValue);
        yield* validatePlanWithContext(
          transaction,
          command.scope,
          plan,
          command.owner?.kind === "legal_issue" || command.owner?.kind === "legal_credit",
          command.owner?.kind === "financial_close",
          isAssetProceedsOwner(command.owner),
          manualContext,
        );
        yield* assertPlanUnposted(transaction, command.scope, plan);
        yield* admitPosting(transaction, command.scope, plan.id, action, command.owner);

        const approval = yield* executionApproval(
          transaction,
          command.scope,
          plan,
          command.input.approvalId,
        );

        yield* requireBookResponsibility(
          transaction,
          command.scope,
          approval.actorId,
          "bookkeepingApproverId",
        );

        const counter = yield* Db.allocateSeriesCounter(
          transaction,
          command.scope.bookId,
          action.fiscalYearId,
          action.series,
        );

        const voucherNumber = counter[0]?.lastNumber;
        const sequence = yield* Db.allocateSequence(transaction, command.scope.bookId);
        const sequenceValue = sequence[0]?.sequence;

        if (voucherNumber === undefined || sequenceValue === undefined) {
          return yield* failure("InternalError");
        }

        const voucherId = settlement?.reservedVoucherId ?? newId("voucher");

        const voucher = yield* Db.insertVoucher(transaction, {
          bookId: command.scope.bookId,
          id: voucherId,
          fiscalYearId: action.fiscalYearId,
          periodId: action.accountingPeriodId,
          series: action.series,
          number: voucherNumber,
          sequence: sequenceValue,
          postingDate: action.postingDate,
          eventId: action.eventId,
          postingPurpose: action.postingPurpose,
          occurrenceKey: action.occurrenceKey,
          correctsVoucherId: action.correctsVoucherId,
          changeSetId: plan.id,
          action,
          expectedLineCount: action.lines.length,
        });

        yield* recordHistoricalOpening(
          transaction,
          command.scope.bookId,
          action.fiscalYearId,
          plan.id,
          voucherId,
        );
        const recordedAt = voucher[0]?.recordedAt;

        if (recordedAt === undefined) return yield* failure("InternalError");
        yield* Db.insertJournalLines(
          transaction,
          action.lines.map((line, index) => ({
            bookId: command.scope.bookId,
            voucherId,
            id: line.lineId,
            ordinal: index + 1,
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            description: line.description,
          })),
        );

        // NEXT-14. The original dimension assignment of each line is retained in
        // this same transaction, after the line it belongs to and before the
        // receipt. The sealed assignments are re-resolved against the current
        // catalogue first, so a change since approval refuses instead of
        // re-classifying an approved posting.
        yield* applyOriginalAssignmentsInTransaction(transaction, command.scope, action, voucherId);

        const receipt = yield* decode(ReceiptSchema, {
          id: newId("receipt"),
          changeSetId: plan.id,
          voucherId,
          planDigest: plan.planDigest,
          sequence: sequenceValue.toString(),
          voucherNumber: voucherNumber.toString(),
          committedAt: recordedAt,
        } satisfies typeof DomainExecutionReceipt.Type);

        const groupReceipt = yield* decode(GroupReceiptSchema, {
          id: receipt.id,
          changeSetId: plan.id,
          groupId: group.id,
          planDigest: plan.planDigest,
          executionReceipts: [receipt],
          committedAt: recordedAt,
        });

        yield* Db.insertExecutionReceipt(transaction, {
          bookId: command.scope.bookId,
          id: receipt.id,
          changeSetId: plan.id,
          voucherId,
          approvalId: approval.id,
          body: receipt,
        });
        yield* Db.insertGroupReceipt(transaction, {
          bookId: command.scope.bookId,
          id: groupReceipt.id,
          changeSetId: plan.id,
          groupId: group.id,
          planDigest: plan.planDigest,
          body: groupReceipt,
          committedAt: recordedAt,
        });
        yield* Db.insertApprovalConsumption(transaction, {
          bookId: command.scope.bookId,
          approvalId: approval.id,
          changeSetId: plan.id,
          groupId: group.id,
          planDigest: plan.planDigest,
          receiptId: groupReceipt.id,
          approverId: approval.actorId,
          consumedById: principal.actorId,
          consumedAt: recordedAt,
          approverBasis: yield* collectPostingActorBasis(
            transaction,
            command.scope,
            approval.actorId,
            "approve_change",
          ),
          executorBasis: yield* collectPostingPrincipalBasis(
            transaction,
            command.scope,
            principal,
            "execute_change",
          ),
        });

        const consumed = yield* Db.consumeApproval(
          transaction,
          command.scope.bookId,
          approval.id,
          recordedAt,
        );

        if (consumed.length !== 1) return yield* failure("InternalError");
        yield* Db.insertOutbox(transaction, {
          bookId: command.scope.bookId,
          id: newId("outbox"),
          receiptId: receipt.id,
          kind: "voucher.posted.v1",
          payload: receipt,
        });

        return receipt;
      }),
    );
  });
});

export const executeChange = Effect.fn("posting.executeWithAdmission")(function* (
  token: string,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
    input: typeof Accounting.ExecuteChange.Type;
  },
) {
  return yield* withBook(token, command.scope, false, "update", (transaction, principal) =>
    executeChangeInTransaction(transaction, principal, command),
  );
});

type CorrectionCommand = {
  scope: Scope;
  voucherId: string;
  idempotencyKey: string;
  input: typeof Accounting.PrepareCorrection.Type;
  owner?: PostingOwner;
};

export function sealActionInTransaction(
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  action: Action,
  allowLegal = false,
  allowTransfer = false,
  allowAsset = false,
) {
  return Effect.gen(function* () {
    const book = yield* readBook(transaction, scope);
    const period = yield* readPeriod(transaction, scope, action.accountingPeriodId);
    yield* validateAction(transaction, scope, book, action, allowLegal, allowTransfer, allowAsset);
    // NEXT-14. The original dimension assignments are resolved and sealed here,
    // before the proposal is hashed, so every owner that seals a plan through
    // this path carries the same reviewed assignment set.
    const assigned = yield* resolveAssignmentsInTransaction(transaction, scope, action);
    const createdAt = yield* isoNow(transaction);

    const planWithoutDigest = {
      schemaVersion: "1" as const,
      canonicalization: "openerp-c14n-v1" as const,
      id: newId("change"),
      version: 1 as const,
      scope: { entityId: scope.entityId, bookId: scope.bookId },
      createdAt,
      dependencies: [
        {
          kind: "profile" as const,
          resourceId: book.id,
          version: book.profileVersion.toString(),
          reason: "Book currency and supported profile",
        },
        {
          kind: "writer_epoch" as const,
          resourceId: book.id,
          version: book.writerEpoch.toString(),
          reason: "Single authoritative writer",
        },
        {
          kind: "period" as const,
          resourceId: period.id,
          version: period.version.toString(),
          reason: "Posting dates and lock state",
        },
        ...(yield* Db.readAccounts(
          transaction,
          scope.bookId,
          assigned.lines.map((line) => line.accountId),
        )).map((account) => ({
          kind: "account" as const,
          resourceId: account.id,
          version: account.version.toString(),
          reason: "Exact account configuration",
        })),
      ],
      groups: [
        {
          id: newId("group"),
          dependsOnGroupIds: [],
          actions: [assigned],
        },
      ],
    };

    const planDigest = yield* versionedDigest(planWithoutDigest);
    const plan = yield* decode(PlanSchema, { ...planWithoutDigest, planDigest });
    yield* Db.insertPlan(transaction, {
      bookId: scope.bookId,
      id: plan.id,
      plan,
      digest: planDigest,
      createdBy: principal.actorId,
    });

    return plan;
  });
}

export const prepareCorrectionInTransaction = Effect.fn("posting.prepareCorrectionInTransaction")(
  function* (transaction: Transaction, principal: Principal, command: CorrectionCommand) {
    const original = yield* readVoucher(transaction, command.scope, command.voucherId);

    if (original.action.manualCompanyAdmission !== undefined)
      return yield* failure("UnsupportedProfile");

    const owned = (yield* SupplierSettlementDb.readReceiptByVoucher(
      transaction,
      command.scope.bookId,
      command.voucherId,
    ))[0];

    if (
      owned &&
      (command.owner?.kind !== "supplier_settlement_cancellation" || command.owner.id !== owned.id)
    )
      return yield* failure("ApprovalRequired");

    return yield* runBookCommand(
      transaction,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: "prepare_correction",
        actorId: principal.actorId,
        input: { id: command.voucherId, input: command.input },
      },
      PlanSchema,
      Effect.gen(function* () {
        if (original.action.postingPurpose === "reversal") return yield* failure("InvalidJournal");

        if (original.action.postingPurpose !== "adjustment")
          return yield* failure("UnsupportedProfile");

        const period = yield* readPeriod(
          transaction,
          command.scope,
          command.input.accountingPeriodId,
        );

        if (period.locked) return yield* failure("PeriodLocked");

        if (command.input.postingDate < original.action.postingDate) {
          return yield* failure("InvalidJournal");
        }

        const book = yield* readBook(transaction, command.scope);

        const actionValue = {
          ...original.action,
          correctsVoucherId: command.voucherId,
          postingPurpose: "reversal" as const,
          occurrenceKey: command.voucherId,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: command.input.accountingPeriodId,
          postingDate: command.input.postingDate,
          description: `Reversal: ${original.action.description.slice(0, 1990)}`,
          rationale: command.input.rationale,
          lines: reversedLines(original.action.lines, () => newId("line")),
        };

        const action = yield* decode(ActionSchema, actionValue);
        yield* validateAction(transaction, command.scope, book, action);
        const createdAt = yield* isoNow(transaction);

        const planWithoutDigest = {
          schemaVersion: "1" as const,
          canonicalization: "openerp-c14n-v1" as const,
          id: newId("change"),
          version: 1 as const,
          scope: { entityId: command.scope.entityId, bookId: command.scope.bookId },
          createdAt,
          dependencies: [
            {
              kind: "profile" as const,
              resourceId: book.id,
              version: book.profileVersion.toString(),
              reason: "Book currency and supported profile",
            },
            {
              kind: "writer_epoch" as const,
              resourceId: book.id,
              version: book.writerEpoch.toString(),
              reason: "Single authoritative writer",
            },
            {
              kind: "period" as const,
              resourceId: period.id,
              version: period.version.toString(),
              reason: "Posting dates and lock state",
            },
            ...(yield* Db.readAccounts(
              transaction,
              command.scope.bookId,
              action.lines.map((line) => line.accountId),
            )).map((account) => ({
              kind: "account" as const,
              resourceId: account.id,
              version: account.version.toString(),
              reason: "Exact account configuration",
            })),
          ],
          groups: [
            {
              id: newId("group"),
              dependsOnGroupIds: [],
              actions: [action],
            },
          ],
        };

        const planDigest = yield* versionedDigest(planWithoutDigest);
        const plan = yield* decode(PlanSchema, { ...planWithoutDigest, planDigest });
        yield* Db.insertPlan(transaction, {
          bookId: command.scope.bookId,
          id: plan.id,
          plan,
          digest: planDigest,
          createdBy: principal.actorId,
        });

        return plan;
      }),
    );
  },
);

export const prepareCorrection = Effect.fn("posting.prepareCorrection")(function* (
  token: string,
  command: CorrectionCommand,
) {
  return yield* withBook(token, command.scope, false, "update", (tx, principal) =>
    prepareCorrectionInTransaction(tx, principal, command),
  );
});

export const getVoucher = Effect.fn("posting.getVoucher")(function* (
  token: string,
  command: { scope: Scope; voucherId: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      return yield* readVoucher(transaction, command.scope, command.voucherId);
    }),
  );
});

export const listVouchers = Effect.fn("posting.listVouchers")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const after = command.after ?? "0";

      if (!/^(0|[1-9][0-9]{0,37})$/.test(after)) return yield* failure("InvalidJournal");
      const rows = yield* Db.readVoucherPage(transaction, command.scope.bookId, BigInt(after), 101);
      const page = rows.slice(0, 100);

      const items = yield* Effect.forEach(page, (row) =>
        decode(VoucherSchema, voucherFromRow(row)),
      );

      return {
        items,
        next: rows.length > 100 ? (items[items.length - 1]?.sequence ?? null) : null,
      };
    }),
  );
});

export const ledgerSnapshot = Effect.fn("posting.ledgerSnapshot")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const book = yield* readBook(transaction, command.scope);
      const accountRows = yield* Db.readLedgerAccounts(transaction, command.scope.bookId);

      const lineRows = yield* Db.readLedgerLines(
        transaction,
        command.scope.bookId,
        book.committedSequence,
      );

      const totals = new Map<string, { debit: bigint; credit: bigint }>();

      for (const line of lineRows) {
        const current = totals.get(line.accountId) ?? { debit: 0n, credit: 0n };
        current.debit += BigInt(line.debitMinor);
        current.credit += BigInt(line.creditMinor);
        totals.set(line.accountId, current);
      }

      return {
        sequence: book.committedSequence.toString(),
        accounts: accountRows.map((account) => {
          const total = totals.get(account.id) ?? { debit: 0n, credit: 0n };
          const balance = total.debit - total.credit;

          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            debitMinor: total.debit.toString(),
            creditMinor: total.credit.toString(),
            balanceMinor: balance === 0n ? "0" : balance.toString(),
          };
        }),
      };
    }),
  );
});

export const getReceipt = Effect.fn("posting.getReceipt")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      const rows = yield* Db.readCommandReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        "share",
      );

      const row = rows[0];

      if (!row || row.operation !== "execute_change") return yield* failure("NotFound");

      return yield* decode(ReceiptSchema, row.result);
    }),
  );
});

export type { ExecutionReceipt };

const readSupplierPostingReservation = Effect.fn("posting.readSupplierReservation")(function* (
  transaction: Transaction,
  command: { scope: Scope; changeSetId: string; owner?: PostingOwner },
) {
  const acceptance = (yield* SupplierAcceptanceDb.readPostingChild(
    transaction,
    command.scope.bookId,
    command.changeSetId,
  ))[0];

  if (
    acceptance &&
    (command.owner?.kind !== "supplier_acceptance" || command.owner.id !== acceptance.id)
  )
    return yield* failure("ApprovalRequired");

  const settlement = (yield* SupplierSettlementDb.readPostingChild(
    transaction,
    command.scope.bookId,
    command.changeSetId,
  ))[0];

  if (
    settlement &&
    (command.owner?.kind !== "supplier_settlement" || command.owner.id !== settlement.id)
  )
    return yield* failure("ApprovalRequired");

  const cancellation = (yield* SupplierSettlementDb.readCancellationPostingChild(
    transaction,
    command.scope.bookId,
    command.changeSetId,
  ))[0];

  if (
    cancellation &&
    (command.owner?.kind !== "supplier_settlement_cancellation" ||
      command.owner.id !== cancellation.id)
  )
    return yield* failure("ApprovalRequired");

  return settlement;
});

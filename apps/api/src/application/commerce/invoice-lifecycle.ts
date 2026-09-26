import { readSealedDraft } from "../../db/posting-admission";
import { admitAccountRole, admitLineOwner } from "../resource-admission";
import { digest as digestNative } from "../json";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import { readInstant } from "../../db/commerce/access";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  createEvidenceInTransaction,
  executeChangeInTransaction,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
  validatePlan,
} from "../posting";
import { lockBookForUpdate, readAccounts } from "../../db/posting";
import { approvalExpiry } from "./approval";
import { calculateDraft, draftBounds } from "./draft-calculation";
import {
  commandReceipt,
  decode,
  exactKeys,
  requireInsertAccess,
  requireTableAccess,
  textField,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
  type Principal,
} from "./support";

const RevisionSchema = Drafts.InvoiceDraftRevision;

const IssueReviewSchema = Issuance.InvoiceIssueReview;

const IssuePrepareSchema = Issuance.PrepareInvoiceIssue;

const IssueApproveSchema = Issuance.ApproveInvoiceIssue;

const IssueExecuteSchema = Issuance.ExecuteInvoiceIssue;

const IssueApprovalSchema = Issuance.InvoiceIssueApproval;

const IssueReceiptSchema = Issuance.InvoiceIssueReceipt;

const issueReviewTables = [
  ...new Set([
    ...DraftDb.invoiceIssueTables,
    ...DraftDb.invoiceDraftTables,
    "commerce_invoices",
    "commerce_invoice_revisions",
    "commerce_active_allocation_legs",
    "commerce_allocation_reversals",
    "invoice_cancellations",
    "commerce_control_accounts",
    "bank_sources",
    "change_sets",
    "approvals",
    "execution_receipts",
    "journal_lines",
    "vouchers",
    "events",
    "periods",
    "accounts",
    "memberships",
  ]),
];

const issueBound = 50;

const reviewBytes = 262144;

const legalBlockers = [
  "legal_identity_not_verified",
  "legal_number_not_allocated",
  "tax_profile_not_activated",
  "delivery_not_implemented",
] as const;

const standingCodes = new Set([
  "issuance_not_implemented",
  "legal_identity_not_verified",
  "tax_profile_not_activated",
]);

const issuePrepareFields = [
  "acknowledgeSyntheticOnly",
  "accountingPeriodId",
  "controlAccountId",
  "creditAccountId",
  "draftId",
  "expectedDigest",
  "expectedRevision",
  "profile",
  "reason",
  "series",
] as const;

const issueAuthorityFields = ["acknowledgeSyntheticOnly", "digest", "version"] as const;

const executeIssueFields = ["acknowledgeSyntheticOnly", "approvalId", "digest", "version"] as const;

const CreateSchema = Drafts.CreateInvoiceDraft;

const ReviseSchema = Drafts.ReviseInvoiceDraft;

const ViewSchema = Drafts.InvoiceDraftView;

const ListSchema = Drafts.InvoiceDraftList;

const HistorySchema = Drafts.InvoiceDraftHistory;

const IssueViewSchema = Issuance.InvoiceIssueView;

const IssueHistorySchema = Issuance.InvoiceIssueHistory;

const issueReviewHistoryBound = 50;

const createFields = ["content", "draftKey"] as const;

const reviseFields = ["content", "expectedDigest", "expectedRevision", "reason"] as const;

const draftKey = /^[a-z][a-z0-9_-]{2,127}$/u;

function retainedNow(transaction: Transaction) {
  return readInstant(transaction).pipe(
    Effect.flatMap((rows) => {
      const instant = rows[0]?.instant;

      return instant === undefined ? failure("InternalError") : Effect.succeed(instant);
    }),
  );
}

function requireNativeWriter(authority: string) {
  return authority === "native" ? Effect.void : failure("Forbidden");
}

function digestOf(value: JsonObject) {
  return digestNative(value);
}

function retainedDraft(body: JsonObject) {
  return JSON.stringify(body).length > draftBounds.retainedBytes
    ? failure("InvalidJournal")
    : Effect.succeed(body);
}

function draftRecord(
  transaction: Transaction,
  command: { scope: Scope; idempotencyKey: string },
  principal: { actorId: string },
  row: {
    id: string;
    draftKey: string;
    revision: string;
    content: JsonObject;
    reason: string;
  },
  calculation: {
    counterparty: JsonObject;
    sellerEvidence: JsonObject;
    customerEvidence: JsonObject;
    totals: JsonObject;
    calculatedLines: ReadonlyArray<JsonObject>;
    blockers: ReadonlyArray<{ readonly code: string; readonly lineId: string | null }>;
    calculationBasis: string;
  },
) {
  return Effect.gen(function* () {
    const withoutDigest: JsonObject = {
      id: row.id,
      scope: command.scope,
      draftKey: row.draftKey,
      revision: row.revision,
      status: "draft",
      issued: false,
      recognized: false,
      delivered: false,
      calculationBasis: calculation.calculationBasis,
      content: row.content,
      counterparty: calculation.counterparty,
      sellerEvidence: calculation.sellerEvidence,
      customerEvidence: calculation.customerEvidence,
      totals: calculation.totals,
      calculatedLines: [...calculation.calculatedLines],
      blockers: calculation.blockers.map((entry) => ({ ...entry })),
      reason: row.reason,
      createdAt: yield* retainedNow(transaction),
      receipt: commandReceipt(
        command.idempotencyKey,
        row.revision === "1" ? "create_invoice_draft" : "revise_invoice_draft",
        principal.actorId,
      ),
    };

    const digest = yield* digestNative(withoutDigest);

    return yield* retainedDraft(Object.assign({}, withoutDigest, { digest }));
  });
}

type CreateDraftCommand = {
  scope: Scope;
  idempotencyKey: string;
  input: typeof Drafts.CreateInvoiceDraft.Type;
};

export const createInvoiceDraftInTransaction = Effect.fn("commerce.drafts.createInTransaction")(
  function* (transaction: Transaction, principal: Principal, command: CreateDraftCommand) {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "create_invoice_draft",
      principal.actorId,
      command.input,
      RevisionSchema,
    );

    if (request.previous) return request.previous;
    yield* requireTableAccess(transaction, DraftDb.invoiceDraftTables, false);
    yield* requireInsertAccess(transaction, ["invoice_drafts", "invoice_draft_revisions"]);
    const books = yield* DraftDb.readBookCurrency(transaction, command.scope.bookId);
    const book = books[0];

    if (!book) return yield* failure("Forbidden");
    yield* requireNativeWriter(book.authority);
    yield* exactKeys(yield* toJsonObject(command.input), createFields);

    if (JSON.stringify(command.input).length > draftBounds.inputBytes) {
      return yield* failure("InvalidJournal");
    }

    const input = yield* decode(CreateSchema, command.input);

    if (!draftKey.test(input.draftKey)) return yield* failure("InvalidJournal");

    const existing = yield* DraftDb.readDraftByKey(
      transaction,
      command.scope.bookId,
      input.draftKey,
    );

    if (existing[0]?.present === true) return yield* failure("IdempotencyConflict");

    const counts = yield* DraftDb.readDraftCount(
      transaction,
      command.scope.bookId,
      draftBounds.inventory,
    );

    if ((counts[0]?.count ?? 0) >= draftBounds.inventory) return yield* failure("InvalidJournal");
    const calculation = yield* calculateDraft(transaction, command.scope, book, input.content);

    const body = yield* draftRecord(
      transaction,
      command,
      principal,
      {
        id: newId("invoice_draft"),
        draftKey: input.draftKey,
        revision: "1",
        content: yield* toJsonObject(input.content),
        reason: draftBounds.initialReason,
      },
      calculation,
    );

    const result = yield* decode(RevisionSchema, body);
    yield* DraftDb.insertDraft(transaction, {
      bookId: command.scope.bookId,
      id: result.id,
      draftKey: input.draftKey,
    });
    yield* DraftDb.insertDraftRevision(transaction, {
      bookId: command.scope.bookId,
      draftId: result.id,
      revision: "1",
      body,
    });
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "create_invoice_draft",
      principal.actorId,
      result,
    );

    return result;
  },
);

export const createInvoiceDraft = Effect.fn("commerce.drafts.create")(function* (
  token: string,
  command: CreateDraftCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      return yield* createInvoiceDraftInTransaction(transaction, principal, command);
    },
    "update",
  );
});

export const reviseInvoiceDraft = Effect.fn("commerce.drafts.revise")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Drafts.ReviseInvoiceDraft.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "revise_invoice_draft",
        principal.actorId,
        replayInput,
        RevisionSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DraftDb.invoiceDraftTables, false);
      yield* requireInsertAccess(transaction, ["invoice_draft_revisions"]);
      const books = yield* DraftDb.readBookCurrency(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireNativeWriter(book.authority);
      yield* exactKeys(yield* toJsonObject(command.input), reviseFields);

      if (JSON.stringify(command.input).length > draftBounds.inputBytes) {
        return yield* failure("InvalidJournal");
      }

      const input = yield* decode(ReviseSchema, command.input);

      const draft = (yield* DraftDb.readDraft(
        transaction,
        command.scope.bookId,
        command.id,
        true,
      ))[0];

      if (!draft) return yield* failure("NotFound");

      if (
        (yield* readSealedDraft(transaction, command.scope.bookId, command.id, "customer")).length
      )
        return yield* failure("Forbidden");
      const head = (yield* DraftDb.readDraftHead(transaction, command.scope.bookId, command.id))[0];

      if (!head) return yield* failure("NotFound");

      if (
        input.expectedRevision !== draft.currentRevision ||
        input.expectedDigest !== textField(head.body, "digest")
      ) {
        return yield* failure("StaleDependency");
      }

      if (Number(draft.currentRevision) >= draftBounds.revisions) {
        return yield* failure("InvalidJournal");
      }

      const calculation = yield* calculateDraft(transaction, command.scope, book, input.content);
      const revision = (BigInt(draft.currentRevision) + 1n).toString();

      const body = yield* draftRecord(
        transaction,
        command,
        principal,
        {
          id: command.id,
          draftKey: draft.draftKey,
          revision,
          content: yield* toJsonObject(input.content),
          reason: input.reason,
        },
        calculation,
      );

      const result = yield* decode(RevisionSchema, body);
      yield* DraftDb.insertDraftRevision(transaction, {
        bookId: command.scope.bookId,
        draftId: command.id,
        revision,
        body,
      });
      yield* DraftDb.advanceDraftRevision(transaction, command.scope.bookId, command.id);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "revise_invoice_draft",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getInvoiceDraft = Effect.fn("commerce.drafts.get")(function* (
  token: string,
  input: { scope: Scope; id: string; revision?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceDraftTables, false);

    if (input.revision !== undefined && !/^[1-9][0-9]{0,17}$/u.test(input.revision)) {
      return yield* failure("InvalidJournal");
    }

    const head = (yield* DraftDb.readDraftHead(transaction, input.scope.bookId, input.id))[0];

    if (!head) return yield* failure("NotFound");
    const current = (yield* decode(RevisionSchema, head.body)).revision;

    const record =
      input.revision === undefined
        ? head
        : (yield* DraftDb.readDraftRevision(
            transaction,
            input.scope.bookId,
            input.id,
            input.revision,
          ))[0];

    if (!record) return yield* failure("NotFound");

    return yield* decode(ViewSchema, {
      record: yield* decode(RevisionSchema, record.body),
      currentRevision: current,
      currentDigest: textField(head.body, "digest") ?? "",
    });
  });
});

export const listInvoiceDrafts = Effect.fn("commerce.drafts.list")(function* (
  token: string,
  input: { scope: Scope },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceDraftTables, false);

    const rows = yield* DraftDb.readDraftSummaries(
      transaction,
      input.scope.bookId,
      null,
      draftBounds.inventory,
    );

    if (rows.length > draftBounds.inventory) return yield* failure("InvalidJournal");

    const withoutDigest: JsonObject = {
      scope: input.scope,
      complete: true,
      count: rows.length,
      items: rows.map((row) => row.body),
      capturedAt: yield* retainedNow(transaction),
    };

    const digest = yield* digestOf(withoutDigest);

    return yield* decode(ListSchema, Object.assign({}, withoutDigest, { digest }));
  });
});

export const invoiceDraftHistory = Effect.fn("commerce.drafts.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceDraftTables, false);
    const draft = (yield* DraftDb.readDraft(transaction, input.scope.bookId, input.id, false))[0];

    if (!draft) return yield* failure("NotFound");

    const rows = yield* DraftDb.readDraftSummaries(
      transaction,
      input.scope.bookId,
      input.id,
      draftBounds.revisions,
    );

    if (rows.length !== Number(draft.currentRevision) || rows.length > draftBounds.revisions) {
      return yield* failure("InvalidJournal");
    }

    const withoutDigest: JsonObject = {
      scope: input.scope,
      id: input.id,
      currentRevision: draft.currentRevision,
      complete: true,
      count: rows.length,
      items: rows.map((row) => row.body),
      capturedAt: yield* retainedNow(transaction),
    };

    const digest = yield* digestOf(withoutDigest);

    return yield* decode(HistorySchema, Object.assign({}, withoutDigest, { digest }));
  });
});

export const prepareInvoiceIssue = Effect.fn("commerce.issuance.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Issuance.PrepareInvoiceIssue.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_invoice_issue",
        principal.actorId,
        command.input,
        IssueReviewSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DraftDb.invoiceIssueTables, false);
      yield* requireInsertAccess(transaction, [
        "invoice_issue_reviews",
        "invoice_issue_approvals",
        "invoice_issues",
        "invoice_issue_counters",
        "commerce_invoices",
        "commerce_invoice_revisions",
        "commerce_control_accounts",
      ]);
      const books = yield* DraftDb.readBookProfile(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireNativeWriter(book.authority);
      yield* requireSupportedProfile(book.profile);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), issuePrepareFields);
      const input = yield* decode(IssuePrepareSchema, command.input);
      const draft = yield* issuableDraft(transaction, command.scope, book, input);
      yield* requireIssueAccounts(transaction, command.scope.bookId, input);

      const ordinals = yield* DraftDb.readIssueOrdinal(
        transaction,
        command.scope.bookId,
        input.draftId,
      );

      const ordinal = ordinals[0]?.ordinal ?? 1;

      if (ordinal > issueBound) return yield* failure("InvalidJournal");
      const reviewId = newId("issue_review");

      const evidence = yield* createEvidenceInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: `ii_${reviewId}_evidence`,
        input: {
          title: `Synthetic invoice draft: ${draft.draft.content.title}`,
          mediaType: "application/json",
          content: JSON.stringify(draft.body),
          origin:
            "Immutable synthetic invoice draft revision; not a legal invoice or VAT determination",
        },
      });

      const history = yield* DraftDb.readPostedEvidenceHistory(
        transaction,
        command.scope.bookId,
        evidence.id,
      );

      if (history[0]?.present === true) return yield* failure("AlreadyPosted");
      const amount = draft.draft.totals.grossMinor ?? "";

      const plan = yield* prepareJournalInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: `ii_${reviewId}_prepare`,
        input: {
          kind: "manual_journal",
          evidenceId: evidence.id,
          eventKey: `synthetic_invoice_${draft.draft.id}`,
          accountingPeriodId: input.accountingPeriodId,
          postingDate: draft.issueDate,
          series: input.series,
          description: `Synthetic invoice: ${draft.draft.content.title}`,
          rationale: input.reason,
          taxAssessment: "not_applicable",
          lines: [
            {
              accountId: input.controlAccountId,
              debitMinor: amount,
              creditMinor: "0",
              description: "Explicit synthetic customer control",
            },
            {
              accountId: input.creditAccountId,
              debitMinor: "0",
              creditMinor: amount,
              description: "Explicit synthetic invoice credit",
            },
          ],
        },
      });

      const planValue = yield* toJsonObject(plan);

      const withoutDigest: JsonObject = {
        id: reviewId,
        scope: command.scope,
        version: 1,
        profile: "synthetic-manual-invoice-v1",
        ordinal,
        input,
        draftSnapshot: draft.body,
        postingPlan: planValue,
        evidence,
        legalBlockers: legalBlockers,
        createdAt: yield* retainedNow(transaction),
        receipt: commandReceipt(command.idempotencyKey, "prepare_invoice_issue", principal.actorId),
      };

      const digest = yield* digestOf(withoutDigest);

      if (JSON.stringify(withoutDigest).length > reviewBytes)
        return yield* failure("InvalidJournal");
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      const result = yield* decode(IssueReviewSchema, body);
      const action = result.postingPlan.groups[0]?.actions[0];

      if (!action) return yield* failure("InternalError");
      yield* DraftDb.insertIssueReview(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        draftId: result.draftSnapshot.id,
        draftRevision: result.draftSnapshot.revision,
        ordinal,
        changeSetId: result.postingPlan.id,
        eventId: action.eventId,
        evidenceId: evidence.id,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_invoice_issue",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const approveInvoiceIssue = Effect.fn("commerce.issuance.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Issuance.ApproveInvoiceIssue.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_invoice_issue",
        principal.actorId,
        replayInput,
        IssueApprovalSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DraftDb.invoiceIssueTables, false);
      yield* requireInsertAccess(transaction, ["invoice_issue_approvals"]);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), issueAuthorityFields);
      const input = yield* decode(IssueApproveSchema, command.input);
      const review = yield* currentIssueReview(transaction, command.scope, command.id, input);

      const counts = yield* DraftDb.readIssueApprovalCount(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const ordinal = (counts[0]?.count ?? 0) + 1;

      if (ordinal > issueBound) return yield* failure("InvalidJournal");
      const expiresAt = yield* approvalExpiry(transaction);

      const withoutDigest: JsonObject = {
        id: newId("issue_approval"),
        scope: command.scope,
        reviewId: command.id,
        digest: review.digest,
        version: 1,
        actorId: principal.actorId,
        ordinal,
        expiresAt,
        createdAt: yield* retainedNow(transaction),
        receipt: commandReceipt(command.idempotencyKey, "approve_invoice_issue", principal.actorId),
      };

      const result = yield* decode(IssueApprovalSchema, withoutDigest);
      yield* DraftDb.insertIssueApproval(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        reviewId: command.id,
        ordinal,
        actorId: principal.actorId,
        digest: review.digest,
        expiresAt,
        body: withoutDigest,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_invoice_issue",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const executeInvoiceIssue = Effect.fn("commerce.issuance.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Issuance.ExecuteInvoiceIssue.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "execute_invoice_issue",
        principal.actorId,
        replayInput,
        IssueReceiptSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DraftDb.invoiceIssueTables, false);
      yield* requireInsertAccess(transaction, [
        "invoice_issues",
        "invoice_issue_counters",
        "commerce_invoices",
        "commerce_invoice_revisions",
        "commerce_control_accounts",
      ]);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), executeIssueFields);
      const input = yield* decode(IssueExecuteSchema, command.input);
      const review = yield* currentIssueReview(transaction, command.scope, command.id, input);

      const approval = (yield* DraftDb.readIssueApproval(
        transaction,
        command.scope.bookId,
        command.id,
        input.approvalId,
      ))[0];

      const used = yield* DraftDb.readIssueForApproval(
        transaction,
        command.scope.bookId,
        input.approvalId,
      );

      if (
        !approval ||
        approval.actorId !== principal.actorId ||
        approval.digest !== review.digest ||
        approval.expiresAt <= (yield* retainedNow(transaction)) ||
        used[0]?.present === true
      ) {
        return yield* failure("ApprovalRequired");
      }

      const exhausted = yield* DraftDb.readCounterExhausted(
        transaction,
        command.scope.bookId,
        999999999999999999n,
      );

      if (exhausted[0]?.exhausted === true) return yield* unsupported();

      const kernel = yield* approveChangeInTransaction(transaction, principal, {
        scope: command.scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `ii_${approval.id}_approve`,
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      const posting = yield* executeChangeInTransaction(transaction, principal, {
        scope: command.scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `ii_${approval.id}_post`,
        owner: { kind: "invoice_issue", id: review.id },
        input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: kernel.id },
      });

      const numbers = yield* DraftDb.allocateInternalNumber(transaction, command.scope.bookId);
      const internalSequence = numbers[0]?.nextNumber;

      if (internalSequence === undefined) return yield* failure("InternalError");
      const documentNumber = `SYN-${internalSequence}`;

      const registerInvoiceId = yield* registerRecognizedInvoice(
        transaction,
        command.scope,
        review,
        posting.voucherId,
        documentNumber,
        command.idempotencyKey,
        principal.actorId,
      );

      const postingValue = yield* toJsonObject(posting);

      const withoutDigest: JsonObject = {
        id: newId("invoice_issue"),
        scope: command.scope,
        reviewId: command.id,
        reviewDigest: review.digest,
        approvalId: approval.id,
        profile: "synthetic-manual-invoice-v1",
        draftId: review.draftSnapshot.id,
        draftRevision: review.draftSnapshot.revision,
        draftDigest: review.draftSnapshot.digest,
        internalSequence,
        internalDocumentNumber: documentNumber,
        issued: true,
        legalInvoice: false,
        legalDocumentNumber: null,
        recognized: true,
        delivered: false,
        postingReceipt: postingValue,
        registerInvoiceId,
        legalBlockers: review.legalBlockers,
        createdAt: yield* retainedNow(transaction),
        receipt: commandReceipt(command.idempotencyKey, "execute_invoice_issue", principal.actorId),
      };

      const digest = yield* digestOf(withoutDigest);
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      const result = yield* decode(IssueReceiptSchema, body);
      yield* DraftDb.insertIssue(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        reviewId: command.id,
        approvalId: approval.id,
        draftId: result.draftId,
        draftRevision: result.draftRevision,
        internalNumber: internalSequence,
        postingReceiptId: posting.id,
        registerInvoiceId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "execute_invoice_issue",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

function requireSupportedProfile(profile: string) {
  return profile === "synthetic-core-v1" ? Effect.void : unsupported();
}

function issuableDraft(
  transaction: Transaction,
  scope: Scope,
  book: DraftDb.BookProfileRow,
  input: typeof IssuePrepareSchema.Type,
) {
  return Effect.gen(function* () {
    const head = (yield* DraftDb.readDraftHead(transaction, scope.bookId, input.draftId))[0];

    if (!head) return yield* failure("NotFound");
    const draft = yield* decode(RevisionSchema, head.body);

    if (input.expectedRevision !== draft.revision || input.expectedDigest !== draft.digest) {
      return yield* failure("StaleDependency");
    }

    const issued = yield* DraftDb.readIssueForDraft(transaction, scope.bookId, input.draftId);

    if (issued[0]?.present === true) return yield* failure("AlreadyPosted");
    const calculation = yield* calculateDraft(transaction, scope, book, draft.content);

    const current: JsonObject = {
      counterparty: calculation.counterparty,
      sellerEvidence: calculation.sellerEvidence,
      customerEvidence: calculation.customerEvidence,
      totals: calculation.totals,
      calculatedLines: calculation.calculatedLines,
      blockers: calculation.blockers,
    };

    const stored: JsonObject = {
      counterparty: head.body.counterparty ?? null,
      sellerEvidence: head.body.sellerEvidence ?? null,
      customerEvidence: head.body.customerEvidence ?? null,
      totals: head.body.totals ?? null,
      calculatedLines: head.body.calculatedLines ?? null,
      blockers: head.body.blockers ?? null,
    };

    if (!equalJson(current, stored)) {
      return yield* failure("StaleDependency");
    }

    if (
      calculation.blockers.some((entry) => !standingCodes.has(entry.code)) ||
      draft.totals.taxMinor !== "0" ||
      draft.totals.sourceTotalMatches !== true ||
      draft.calculatedLines.some((line) => line.sourceGrossMatches !== true)
    ) {
      return yield* unsupported();
    }

    if (draft.content.plannedIssueDate === null || draft.content.dueDate === null) {
      return yield* failure("InvalidJournal");
    }

    if (!/^[1-9][0-9]{0,37}$/u.test(draft.totals.grossMinor ?? "")) {
      return yield* unsupported();
    }

    return {
      body: head.body,
      draft,
      issueDate: draft.content.plannedIssueDate,
    };
  });
}

function requireIssueAccounts(
  transaction: Transaction,
  bookId: string,
  input: typeof IssuePrepareSchema.Type,
) {
  if (input.controlAccountId === input.creditAccountId) return failure("InvalidJournal");

  return DraftDb.readControlAccountConflict(
    transaction,
    bookId,
    input.controlAccountId,
    input.creditAccountId,
  ).pipe(
    Effect.flatMap((rows) =>
      rows[0]?.conflict === true ? failure("InvalidJournal") : Effect.void,
    ),
  );
}

function currentIssueReview(
  transaction: Transaction,
  scope: Scope,
  id: string,
  input: { digest: string },
) {
  return Effect.gen(function* () {
    const review = yield* decode(
      IssueReviewSchema,
      (yield* DraftDb.readIssueReview(transaction, scope.bookId, id))[0]?.body ?? {},
    );

    if (input.digest !== review.digest) return yield* failure("StaleDependency");
    const books = yield* DraftDb.readBookProfile(transaction, scope.bookId);
    const book = books[0];

    if (!book) return yield* failure("Forbidden");
    yield* requireSupportedProfile(book.profile);
    yield* issuableDraft(transaction, scope, book, review.input);
    yield* requireIssueAccounts(transaction, scope.bookId, review.input);
    yield* validatePlan(transaction, scope, review.postingPlan);

    const executed = yield* DraftDb.readExecutedChangeSet(
      transaction,
      scope.bookId,
      review.postingPlan.id,
    );

    if (executed[0]?.present === true) return yield* failure("StaleDependency");

    return review;
  });
}

function registerRecognizedInvoice(
  transaction: Transaction,
  scope: Scope,
  review: typeof IssueReviewSchema.Type,
  voucherId: string,
  documentNumber: string,
  idempotencyKey: string,
  actorId: string,
) {
  return Effect.gen(function* () {
    const input = review.input;
    const line = review.postingPlan.groups[0]?.actions[0]?.lines[0];
    const issueDate = review.draftSnapshot.content.plannedIssueDate;
    const dueDate = review.draftSnapshot.content.dueDate;

    if (!line || issueDate === null || dueDate === null) {
      return yield* failure("InternalError");
    }

    const recognition = (yield* DraftDb.readRecognitionLine(
      transaction,
      scope.bookId,
      voucherId,
      line.lineId,
    ))[0];

    if (!recognition || recognition.periodLocked) return yield* failure("PeriodLocked");
    const accounts = yield* readAccounts(transaction, scope.bookId, [input.controlAccountId]);

    if (accounts[0]?.active !== true) return yield* failure("InvalidJournal");
    const current = yield* DraftDb.readVoucherCurrent(transaction, scope.bookId, voucherId);

    if (
      recognition.accountId !== input.controlAccountId ||
      recognition.debitMinor !== review.draftSnapshot.totals.grossMinor ||
      recognition.creditMinor !== "0" ||
      current[0]?.current !== true ||
      recognition.postingDate < issueDate
    ) {
      return yield* failure("InvalidJournal");
    }

    const evidenceRefs = recognition.evidenceRefs;

    if (
      !Array.isArray(evidenceRefs) ||
      !evidenceRefs.some(
        (reference) =>
          typeof reference === "object" &&
          reference !== null &&
          !Array.isArray(reference) &&
          reference.evidenceId === review.evidence.id &&
          reference.sha256 === review.evidence.sha256,
      )
    ) {
      return yield* failure("MissingEvidence");
    }

    const duplicate = yield* DraftDb.readRegisterIdentity(
      transaction,
      scope.bookId,
      review.draftSnapshot.content.counterpartyId,
      documentNumber,
      voucherId,
      line.lineId,
    );

    if (duplicate[0]?.present === true) return yield* failure("IdempotencyConflict");
    yield* admitAccountRole(transaction, scope.bookId, review.input.controlAccountId, "commerce");
    yield* admitLineOwner(transaction, scope.bookId, voucherId, line.lineId, "commerce");
    yield* DraftDb.claimControlAccount(
      transaction,
      scope.bookId,
      recognition.accountId,
      "customer",
    );

    const classified = yield* DraftDb.readControlAccount(
      transaction,
      scope.bookId,
      recognition.accountId,
      "customer",
    );

    if (classified[0]?.present !== true) return yield* failure("InvalidJournal");
    const invoiceId = newId("invoice");
    const gross = review.draftSnapshot.totals.grossMinor;

    if (gross === null) return yield* failure("InternalError");

    const evidence = {
      evidenceId: review.evidence.id,
      sha256: review.evidence.sha256,
    } satisfies JsonObject;

    const revisionWithoutDigest: JsonObject = {
      id: invoiceId,
      scope,
      revision: "1",
      dueOn: dueDate,
      description: `Synthetic invoice: ${review.draftSnapshot.content.title}`,
      evidence,
      reason: "Initial evidence-backed registration",
      createdAt: yield* retainedNow(transaction),
      receipt: commandReceipt(idempotencyKey, "commerce_create_invoice", actorId),
    };

    const withoutDigest: JsonObject = {
      id: invoiceId,
      scope,
      kind: "synthetic_invoice_v1",
      direction: "customer",
      counterpartyId: review.draftSnapshot.content.counterpartyId,
      counterpartyRevision: review.draftSnapshot.content.counterpartyRevision,
      counterpartyName: textField(review.draftSnapshot.counterparty, "displayName") ?? "",
      documentNumber,
      issuedOn: issueDate,
      currency: review.draftSnapshot.content.currency,
      currencyScale: review.draftSnapshot.content.currencyScale,
      amountMinor: gross,
      controlAccountId: recognition.accountId,
      evidence,
      recognition: {
        voucherId: recognition.voucherId,
        lineId: recognition.id,
        eventId: recognition.eventId,
        postingDate: recognition.postingDate,
      } satisfies JsonObject,
    };

    yield* DraftDb.insertRegisteredInvoice(transaction, {
      bookId: scope.bookId,
      id: invoiceId,
      direction: "customer",
      counterpartyId: review.draftSnapshot.content.counterpartyId,
      counterpartyRevision: review.draftSnapshot.content.counterpartyRevision,
      documentNumber,
      issuedOn: issueDate,
      amountMinor: gross,
      controlAccountId: recognition.accountId,
      recognitionVoucherId: recognition.voucherId,
      recognitionLineId: recognition.id,
      evidenceId: review.evidence.id,
      body: withoutDigest,
    });
    yield* DraftDb.insertInvoiceRevision(transaction, {
      bookId: scope.bookId,
      invoiceId,
      revision: "1",
      evidenceId: review.evidence.id,
      body: revisionWithoutDigest,
    });

    return invoiceId;
  });
}

export {
  prepareInvoiceCancellation,
  approveInvoiceCancellation,
  executeInvoiceCancellation,
  revokeInvoiceCancellationApproval,
} from "./cancellations";

function issueBlockers(
  transaction: Transaction,
  scope: Scope,
  review: typeof IssueReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const issued = yield* DraftDb.readIssueForDraft(
      transaction,
      scope.bookId,
      review.input.draftId,
    );

    if (issued[0]?.present === true) {
      return yield* Effect.succeed<ReadonlyArray<string>>([
        "This draft already has a retained synthetic issue.",
      ]);
    }

    return yield* Effect.gen(function* () {
      const books = yield* DraftDb.readBookProfile(transaction, scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireNativeWriter(book.authority);
      yield* requireSupportedProfile(book.profile);
      yield* issuableDraft(transaction, scope, book, review.input);
      yield* requireIssueAccounts(transaction, scope.bookId, review.input);
      yield* validatePlan(transaction, scope, review.postingPlan);

      const executed = yield* DraftDb.readExecutedChangeSet(
        transaction,
        scope.bookId,
        review.postingPlan.id,
      );

      if (executed[0]?.present === true) {
        return yield* Effect.succeed<ReadonlyArray<string>>([
          "The linked posting already executed. A second recognition is refused.",
        ]);
      }

      return yield* Effect.succeed<ReadonlyArray<string>>([]);
    }).pipe(
      Effect.catch((error) =>
        error instanceof Accounting.AccountingError
          ? Effect.succeed<ReadonlyArray<string>>([error.message])
          : Effect.fail(error),
      ),
    );
  });
}

export const getInvoiceIssueReview = Effect.fn("commerce.issuance.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction, principal) {
    yield* requireTableAccess(transaction, issueReviewTables, false);
    const reviews = yield* DraftDb.readIssueReview(transaction, input.scope.bookId, input.id);
    const stored = reviews[0]?.body;

    if (stored === undefined) return yield* failure("NotFound");
    const plan = yield* decode(IssueReviewSchema, stored);

    const approvals = yield* DraftDb.readLatestIssueApproval(
      transaction,
      input.scope.bookId,
      input.id,
    );

    const approval = approvals[0];
    const issues = yield* DraftDb.readIssueForReview(transaction, input.scope.bookId, input.id);
    const issue = issues[0];
    const blockers = yield* issueBlockers(transaction, input.scope, plan);
    const current = yield* retainedNow(transaction);

    const usable =
      approval !== undefined &&
      approval.actorId === principal.actorId &&
      approval.expiresAt > current &&
      approval.operator;

    return yield* decode(IssueViewSchema, {
      plan,
      approval: approval === undefined ? null : yield* decode(IssueApprovalSchema, approval.body),
      issue: issue === undefined ? null : yield* decode(IssueReceiptSchema, issue.body),
      blockers: [...blockers],
      dependenciesCurrent: blockers.length === 0,
      approvalUsable: usable && issue === undefined && blockers.length === 0,
    });
  });
});

export const invoiceIssueHistory = Effect.fn("commerce.issuance.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, issueReviewTables, false);
    const drafts = yield* DraftDb.readDraft(transaction, input.scope.bookId, input.id, false);

    if (!drafts[0]) return yield* failure("NotFound");
    const rows = yield* DraftDb.readIssueHistoryForDraft(transaction, input.scope.bookId, input.id);

    if (rows.length > issueReviewHistoryBound) return yield* failure("InvalidJournal");

    const items = yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        if (row.digest === null || row.createdAt === null) return yield* failure("InternalError");

        return {
          id: row.id,
          ordinal: row.ordinal,
          draftRevision: row.draftRevision,
          digest: row.digest,
          createdAt: row.createdAt,
          issueId: row.issueId,
          internalDocumentNumber: row.internalDocumentNumber,
        };
      }),
    );

    return yield* decode(IssueHistorySchema, {
      scope: input.scope,
      draftId: input.id,
      complete: true,
      count: rows.length,
      items,
    });
  });
});

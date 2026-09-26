import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import {
  digest,
  isoNow,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
  validatePlan,
} from "../posting";
import * as AcceptanceDb from "../../db/purchases/acceptance";
import * as Shared from "./shared";
import { calculateSupplierDraft } from "./draft-calculation";

type Scope = typeof Accounting.Scope.Type;
type Transaction = import("../../db/transaction").Transaction;
type Json = Schema.Json;
type JsonObject = Schema.JsonObject;

const ReviewSchema = Acceptance.SupplierAcceptanceReview;
const ApprovalSchema = Acceptance.SupplierAcceptanceApproval;
const ViewSchema = Acceptance.SupplierAcceptanceView;
const HistorySchema = Acceptance.SupplierAcceptanceHistory;

const acceptanceTables = [
  "books",
  "accounts",
  "periods",
  "evidence",
  "events",
  "change_sets",
  "execution_receipts",
  "command_receipts",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_control_accounts",
  "commerce_invoices",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "supplier_acceptance_reviews",
  "supplier_acceptance_approvals",
  "supplier_acceptances",
  "bank_sources",
];
const acceptanceInserts = [
  "supplier_acceptance_reviews",
  "supplier_acceptance_approvals",
  "change_sets",
  "events",
  "command_receipts",
];
const legalBlockers = [
  "legal_identity_not_verified",
  "tax_profile_not_activated",
  "payment_not_initiated",
] as const;
const toleratedBlockers = new Set([
  "acceptance_not_implemented",
  "recognition_not_implemented",
  "legal_identity_not_verified",
  "tax_profile_not_activated",
  "supplier_document_number_missing",
]);
const maximumReviews = 50;
const maximumApprovals = 50;
const maximumReviewBytes = 262144;
const approvalWindowMs = 60 * 60 * 1000;
const recoverableBlockers = new Set([
  "acceptance_not_implemented",
  "recognition_not_implemented",
  "legal_identity_not_verified",
  "tax_profile_not_activated",
  "supplier_document_number_missing",
  "supplier_identity_fields_missing",
  "buyer_identity_fields_missing",
  "tax_inputs_unreviewed",
]);

function draftAcceptable(body: JsonObject) {
  const totals = Shared.objectField(body, "totals");
  const content = Shared.objectField(body, "content");
  if (Shared.arrayField(body, "blockers").some((entry) => !tolerableBlocker(entry))) return false;
  if (content.supplierDocumentNumber === null || content.supplierDocumentNumber === undefined) {
    return false;
  }
  if (Shared.textField(totals, "taxMinor") !== "0") return false;
  if (!/^[1-9][0-9]{0,37}$/.test(Shared.textField(totals, "grossMinor") ?? "")) return false;
  if (totals.sourceTotalMatches !== true) return false;
  return Shared.arrayField(body, "calculatedLines").every(
    (line) => Shared.objectField(line, "sourceGrossMatches").sourceGrossMatches === true,
  );
}

function tolerableBlocker(entry: Json) {
  const code = Shared.textField(entry, "code");
  return code !== undefined && toleratedBlockers.has(code);
}

type AcceptancePosting = {
  readonly lines: ReadonlyArray<JsonObject>;
  readonly originalLines?: ReadonlyArray<JsonObject>;
  readonly inputVatAccountId?: string;
};

function acceptancePosting(
  transaction: Transaction,
  scope: Scope,
  book: { currency: string; currencyScale: number },
  draft: JsonObject,
  input: typeof Acceptance.PrepareSupplierAcceptance.Type,
) {
  return Effect.gen(function* () {
    const gross = Shared.textField(Shared.objectField(draft, "totals"), "grossMinor") ?? "0";
    const lines: JsonObject[] = [];

    if (input.profile === "swedish-purchase-v1") {
      if (!("lineAssignments" in input)) return yield* failure("InvalidJournal");
      if (book.currency !== "SEK" || book.currencyScale !== 2) {
        return yield* Shared.unsupported();
      }
      const detail = yield* purchaseLines(transaction, scope.bookId, draft, input);
      let netTotal = 0n;
      let taxTotal = 0n;
      for (const line of detail.originalLines) {
        const netMinor = Shared.textField(line, "netMinor") ?? "0";
        const taxMinor = Shared.textField(line, "taxMinor") ?? "0";
        lines.push({
          accountId: Shared.textField(line, "expenseAccountId") ?? "",
          debitMinor: netMinor,
          creditMinor: "0",
          description: `Supplier line ${Shared.textField(line, "lineId") ?? ""}`,
        });
        netTotal += BigInt(netMinor);
        taxTotal += BigInt(taxMinor);
      }
      const totals = Shared.objectField(draft, "totals");
      if (
        netTotal.toString() !== Shared.textField(totals, "netMinor") ||
        taxTotal.toString() !== Shared.textField(totals, "taxMinor") ||
        taxTotal <= 0n
      ) {
        return yield* failure("InvalidJournal");
      }
      lines.push(
        {
          accountId: detail.inputVatAccountId,
          debitMinor: taxTotal.toString(),
          creditMinor: "0",
          description: "Input VAT",
        },
        {
          accountId: input.controlAccountId,
          debitMinor: "0",
          creditMinor: gross,
          description: "Supplier payable",
        },
      );
      return {
        lines,
        originalLines: detail.originalLines,
        inputVatAccountId: detail.inputVatAccountId,
      } satisfies AcceptancePosting;
    }

    if (!("debitAccountId" in input)) return yield* failure("InvalidJournal");
    if (input.controlAccountId === input.debitAccountId) {
      return yield* failure("InvalidJournal");
    }
    if (
      (yield* AcceptanceDb.readBankSourceConflict(transaction, scope.bookId, [
        input.controlAccountId,
        input.debitAccountId,
      ]))[0]?.present === true ||
      (yield* AcceptanceDb.readControlAccountConflict(
        transaction,
        scope.bookId,
        [input.debitAccountId, input.controlAccountId],
        "supplier",
      ))[0]?.present === true
    ) {
      return yield* failure("InvalidJournal");
    }
    return {
      lines: [
        {
          accountId: input.debitAccountId,
          debitMinor: gross,
          creditMinor: "0",
          description: "Explicit supplier expense",
        },
        {
          accountId: input.controlAccountId,
          debitMinor: "0",
          creditMinor: gross,
          description: "Explicit supplier payable",
        },
      ],
    } satisfies AcceptancePosting;
  });
}

function readDraftForAcceptance(transaction: Transaction, bookId: string, draftId: string) {
  return AcceptanceDb.readDraftHead(transaction, bookId, draftId).pipe(
    Effect.flatMap((rows) => {
      const head = rows[0];
      return head ? Effect.succeed(head) : failure("NotFound");
    }),
  );
}

function readReview(transaction: Transaction, bookId: string, reviewId: string) {
  return AcceptanceDb.readReview(transaction, bookId, reviewId).pipe(
    Effect.flatMap((rows) => {
      const review = rows[0];
      return review ? Effect.succeed(review) : failure("NotFound");
    }),
  );
}

function readBook(transaction: Transaction, bookId: string) {
  return Shared.readBook(transaction, bookId);
}

function purchaseLines(
  transaction: Transaction,
  bookId: string,
  draft: JsonObject,
  input: typeof Acceptance.PrepareSwedishSupplierAcceptance.Type,
) {
  return Effect.gen(function* () {
    const control = (yield* AcceptanceDb.readBasAccount(transaction, bookId, "2440"))[0]?.id;
    const vat = (yield* AcceptanceDb.readBasAccount(transaction, bookId, "2641"))[0]?.id;
    if (control === null || control === undefined || control !== input.controlAccountId) {
      return yield* failure("InvalidJournal");
    }
    if (vat === null || vat === undefined) return yield* failure("InvalidJournal");
    const draftLines = Shared.arrayField(Shared.objectField(draft, "content"), "lines");
    const assignments = input.lineAssignments;
    if (assignments.length !== draftLines.length) return yield* failure("InvalidJournal");
    const lines: JsonObject[] = [];
    for (const line of draftLines) {
      const lineId = Shared.textField(line, "id") ?? "";
      const matches = assignments.filter((assignment) => assignment.lineId === lineId);
      if (matches.length !== 1) return yield* failure("InvalidJournal");
      const assignment = matches[0];
      if (assignment === undefined) return yield* failure("InvalidJournal");
      const account = (yield* AcceptanceDb.readExpenseAccount(
        transaction,
        bookId,
        assignment.expenseAccountId,
        [control, vat],
      ))[0];
      const excluded = account === undefined || account.id !== assignment.expenseAccountId;
      if (
        excluded ||
        (yield* AcceptanceDb.readBankSourceConflict(transaction, bookId, [
          assignment.expenseAccountId,
        ]))[0]?.present === true ||
        (yield* AcceptanceDb.readControlAccountConflict(
          transaction,
          bookId,
          [assignment.expenseAccountId],
          "supplier",
        ))[0]?.present === true
      ) {
        return yield* failure("InvalidJournal");
      }
      const base = BigInt(Shared.textField(line, "baseMinor") ?? "0");
      const discount = BigInt(Shared.textField(line, "discountMinor") ?? "0");
      const charge = BigInt(Shared.textField(line, "chargeMinor") ?? "0");
      const net = base - discount + charge;
      const tax = BigInt(Shared.textField(line, "taxMinor") ?? "0");
      const expected = (net * BigInt(assignment.vatRatePercent) + 50n) / 100n;
      if (net <= 0n || tax < 0n || (tax - expected > 1n ? tax - expected : expected - tax) > 1n) {
        return yield* failure("InvalidJournal");
      }
      lines.push({
        lineId,
        expenseAccountId: assignment.expenseAccountId,
        netMinor: net.toString(),
        taxMinor: tax.toString(),
        vatRatePercent: assignment.vatRatePercent,
      });
    }
    return { originalLines: lines, inputVatAccountId: vat };
  });
}

export const prepareSupplierAcceptance = Effect.fn("purchases.acceptance.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Acceptance.PrepareSupplierAcceptance.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, acceptanceTables, acceptanceInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* readBook(transaction, command.scope.bookId);
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_supplier_acceptance",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        ReviewSchema,
      );
      if (request.previous) return request.previous;

      const swedish = command.input.profile === "swedish-purchase-v1";
      const head = yield* readDraftForAcceptance(
        transaction,
        command.scope.bookId,
        command.input.draftId,
      );
      if (
        command.input.expectedRevision !== head.currentRevision ||
        command.input.expectedDigest !== Shared.textField(head.body, "digest")
      ) {
        return yield* failure("StaleDependency");
      }
      if (
        (yield* AcceptanceDb.readAcceptanceForDraft(
          transaction,
          command.scope.bookId,
          command.input.draftId,
        ))[0]?.present === true
      ) {
        return yield* failure("AlreadyPosted");
      }
      const recalculated = yield* calculateSupplierDraft(
        transaction,
        command.scope.bookId,
        book,
        Shared.objectField(head.body, "content"),
      );
      if (!Shared.sameJson(recalculated, retainedFacts(head.body))) {
        return yield* failure("StaleDependency");
      }
      if (!draftAcceptable(head.body)) return yield* Shared.unsupported();

      const ordinal =
        (yield* AcceptanceDb.readReviewCount(
          transaction,
          command.scope.bookId,
          command.input.draftId,
        ))[0]!.total + 1;
      if (ordinal > maximumReviews) return yield* failure("InvalidJournal");

      const sourceEvidenceId =
        Shared.textField(Shared.objectField(head.body, "content"), "sourceEvidenceId") ?? "";
      const evidence = yield* Shared.readEvidenceReference(
        transaction,
        command.scope.bookId,
        sourceEvidenceId,
      );
      if (
        yield* Shared.evidenceHasPostedHistory(transaction, command.scope.bookId, sourceEvidenceId)
      ) {
        return yield* failure("AlreadyPosted");
      }

      const content = Shared.objectField(head.body, "content");
      const reviewId = newId("supplier_review");
      const posting = yield* acceptancePosting(
        transaction,
        command.scope,
        book,
        head.body,
        command.input,
      );
      const originalLines = posting.originalLines;
      const inputVatAccountId = posting.inputVatAccountId;

      const plan = yield* prepareJournalInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: `sa_${reviewId}_prepare`,
        input: {
          kind: "manual_journal",
          evidenceId: sourceEvidenceId,
          eventKey: `${swedish ? "swedish_supplier" : "synthetic_supplier"}_${Shared.textField(head.body, "id") ?? ""}`,
          accountingPeriodId: command.input.accountingPeriodId,
          postingDate: Shared.textField(content, "documentDate") ?? "",
          series: command.input.series,
          description: `${swedish ? "Supplier invoice: " : "Synthetic supplier invoice: "}${Shared.textField(content, "title") ?? ""}`,
          rationale: command.input.reason,
          taxAssessment: "not_applicable",
          lines: posting.lines.map((line) => ({
            accountId: Shared.textField(line, "accountId") ?? "",
            debitMinor: Shared.textField(line, "debitMinor") ?? "0",
            creditMinor: Shared.textField(line, "creditMinor") ?? "0",
            description: Shared.textField(line, "description") ?? "",
          })),
        },
      });

      const bodyFields: JsonObject = {
        id: reviewId,
        scope: command.scope,
        version: 1,
        profile: command.input.profile,
        ordinal,
        input: yield* Shared.toJsonObject(command.input),
        draftSnapshot: head.body,
        postingPlan: yield* Shared.toJsonObject(plan),
        evidence,
        legalBlockers,
        createdAt: yield* isoNow(transaction),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "prepare_supplier_acceptance",
          principal.actorId,
        ),
      };
      const extras: JsonObject[] = [];
      if (originalLines !== undefined) extras.push({ originalLines });
      if (inputVatAccountId !== undefined) extras.push({ inputVatAccountId });
      const body = Object.assign({}, bodyFields, ...extras);
      const sealed = Object.assign({}, body, { digest: yield* digest(body) });
      if (Shared.byteLength(JSON.stringify(sealed)) > maximumReviewBytes) {
        return yield* failure("InvalidJournal");
      }
      const review = yield* Shared.decode(ReviewSchema, sealed);
      const planId = plan.id;
      const firstAction = plan.groups[0]?.actions[0];
      if (planId === "" || firstAction === undefined) {
        return yield* failure("InternalError");
      }
      const eventId = firstAction.eventId;
      yield* AcceptanceDb.insertReview(transaction, {
        bookId: command.scope.bookId,
        id: reviewId,
        draftId: command.input.draftId,
        draftRevision: head.currentRevision,
        ordinal,
        changeSetId: planId,
        eventId,
        evidenceId: sourceEvidenceId,
        body: sealed,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_supplier_acceptance",
        principal.actorId,
        yield* Shared.toJsonObject(review),
      );
      return review;
    }),
  );
});

function retainedFacts(body: JsonObject) {
  const omitted = new Set([
    "id",
    "scope",
    "draftKey",
    "revision",
    "status",
    "acceptanceSupported",
    "recognitionSupported",
    "recognitionAssessment",
    "calculationBasis",
    "content",
    "reason",
    "createdAt",
    "receipt",
    "digest",
  ]);
  return Object.fromEntries(Object.entries(body).filter(([key]) => !omitted.has(key)));
}

function acceptanceBlockers(
  transaction: Transaction,
  scope: Scope,
  review: AcceptanceDb.ReviewRow,
) {
  const bookId = scope.bookId;
  return Effect.gen(function* () {
    const body = review.body;
    const input = Shared.objectField(body, "input");
    const evidenceId = Shared.textField(Shared.objectField(body, "evidence"), "evidenceId") ?? "";
    if (
      (yield* AcceptanceDb.readAcceptanceForDraft(
        transaction,
        bookId,
        Shared.textField(input, "draftId") ?? "",
      ))[0]?.present === true
    ) {
      return ["This draft already has a retained supplier acceptance."] as const;
    }
    if (yield* Shared.evidenceHasPostedHistory(transaction, bookId, evidenceId)) {
      return [
        "The original supplier source already has posted history; a second recognition is refused.",
      ] as const;
    }
    const blockers: string[] = [];
    const head = yield* AcceptanceDb.readDraftHead(
      transaction,
      bookId,
      Shared.textField(input, "draftId") ?? "",
    );
    if (!head[0]) {
      blockers.push("The reviewed supplier draft is no longer available.");
    } else if (
      Shared.textField(input, "expectedRevision") !== head[0].currentRevision ||
      Shared.textField(input, "expectedDigest") !== Shared.textField(head[0].body, "digest")
    ) {
      blockers.push("The supplier draft changed after this review was prepared.");
    } else if (!draftAcceptable(head[0].body)) {
      blockers.push(
        "The reviewed supplier draft is no longer acceptable for synthetic recognition.",
      );
    }
    if (
      (yield* AcceptanceDb.readReviewByChangeSet(transaction, bookId, review.changeSetId))[0]
        ?.present === true
    ) {
      return ["The linked posting already executed. A second recognition is refused."] as const;
    }
    const plan = yield* Shared.decode(
      Accounting.ChangeSet,
      Shared.objectField(body, "postingPlan"),
    );
    blockers.push(
      ...(yield* validatePlan(transaction, scope, plan).pipe(
        Effect.match({
          onFailure: (error) => [error.message],
          onSuccess: () => [],
        }),
      )),
    );
    if (blockers.length > 0) return blockers;
    if (blockers.length === 0) {
      const codes = Shared.arrayField(head[0]?.body ?? {}, "blockers").flatMap((entry) => {
        const code = Shared.textField(entry, "code");
        return code === undefined || recoverableBlockers.has(code) ? [] : [code];
      });
      blockers.push(...codes);
    }
    return blockers;
  });
}

export const approveSupplierAcceptance = Effect.fn("purchases.acceptance.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Acceptance.ApproveSupplierAcceptance.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, acceptanceTables, acceptanceInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* readBook(transaction, command.scope.bookId);
      void book;
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_supplier_acceptance",
        principal.actorId,
        {
          reviewId: command.reviewId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        ApprovalSchema,
      );
      if (request.previous) return request.previous;

      const review = yield* readReview(transaction, command.scope.bookId, command.reviewId);
      if (command.input.digest !== Shared.textField(review.body, "digest")) {
        return yield* failure("StaleDependency");
      }
      const blockers = yield* acceptanceBlockers(transaction, command.scope, review);
      if (blockers.length > 0) return yield* failure("StaleDependency");

      const ordinal =
        (yield* AcceptanceDb.readApprovalCount(
          transaction,
          command.scope.bookId,
          command.reviewId,
        ))[0]!.total + 1;
      if (ordinal > maximumApprovals) return yield* failure("InvalidJournal");
      const now = (yield* AcceptanceDb.readDatabaseTime(transaction))[0]?.now;
      if (now === undefined) return yield* failure("InternalError");

      const body = Object.assign(
        {},
        {
          id: newId("supplier_approval"),
          scope: command.scope,
          reviewId: command.reviewId,
          digest: Shared.textField(review.body, "digest") ?? "",
          version: 1,
          actorId: principal.actorId,
          ordinal,
          expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
          createdAt: yield* isoNow(transaction),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "approve_supplier_acceptance",
            principal.actorId,
          ),
        },
      ) satisfies JsonObject;
      const approval = yield* Shared.decode(ApprovalSchema, body);
      yield* AcceptanceDb.insertApproval(transaction, {
        bookId: command.scope.bookId,
        id: Shared.textField(body, "id") ?? "",
        reviewId: command.reviewId,
        ordinal,
        actorId: principal.actorId,
        digest: Shared.textField(body, "digest") ?? "",
        expiresAt: Shared.textField(body, "expiresAt") ?? "",
        body: yield* Shared.toJsonObject(body),
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_supplier_acceptance",
        principal.actorId,
        yield* Shared.toJsonObject(approval),
      );
      return approval;
    }),
  );
});

export const executeSupplierAcceptance = Effect.fn("purchases.acceptance.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Acceptance.ExecuteSupplierAcceptance.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, acceptanceTables, acceptanceInserts);
      yield* readBook(transaction, command.scope.bookId);
      void command;
      return yield* Shared.unsupported();
    }),
  );
});

export const getSupplierAcceptanceReview = Effect.fn("purchases.acceptance.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reviewId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, acceptanceTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      const review = yield* readReview(transaction, command.scope.bookId, command.reviewId);
      const approval = (yield* AcceptanceDb.readApproval(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];
      const acceptance = (yield* AcceptanceDb.readAcceptanceByReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];
      const blockers = yield* acceptanceBlockers(transaction, command.scope, review);
      const now = (yield* AcceptanceDb.readDatabaseTime(transaction))[0]?.now ?? "";
      const usable =
        approval !== undefined &&
        approval.actorId === principal.actorId &&
        Date.parse(approval.expiresAt) > Date.parse(now) &&
        acceptance === undefined &&
        blockers.length === 0;
      return yield* Shared.decode(ViewSchema, {
        plan: yield* Shared.decode(ReviewSchema, review.body),
        approval: approval ? yield* Shared.decode(ApprovalSchema, approval.body) : null,
        acceptance: acceptance ? acceptance.body : null,
        blockers,
        dependenciesCurrent: blockers.length === 0,
        approvalUsable: usable,
      });
    }),
  );
});

export const supplierAcceptanceHistory = Effect.fn("purchases.acceptance.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly draftId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, acceptanceTables);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      if (
        (yield* AcceptanceDb.readDraftExists(transaction, command.scope.bookId, command.draftId))[0]
          ?.present !== true
      ) {
        return yield* failure("NotFound");
      }
      const rows = yield* AcceptanceDb.readAcceptanceHistory(
        transaction,
        command.scope.bookId,
        command.draftId,
      );
      if (rows.length > maximumReviews) return yield* failure("InvalidJournal");
      return yield* Shared.decode(HistorySchema, {
        scope: command.scope,
        draftId: command.draftId,
        complete: true,
        count: rows.length,
        items: rows.map((row) => ({
          id: row.id,
          ordinal: row.ordinal,
          draftRevision: row.draftRevision,
          digest: row.digest,
          createdAt: row.createdAt,
          acceptanceId: row.acceptanceId,
          supplierDocumentNumber: row.supplierDocumentNumber,
        })),
      });
    }),
  );
});

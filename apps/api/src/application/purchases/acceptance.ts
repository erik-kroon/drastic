import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import {
  digest,
  approveChangeInTransaction,
  executeChangeInTransaction,
  isoNow,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
  validatePlan,
} from "../posting";
import * as AcceptanceDb from "../../db/purchases/acceptance";
import * as RecognitionDb from "../../db/purchases/recognition";
import { createInvoiceInTransaction } from "../commerce/register";
import * as RecognitionContract from "@open-erp/contracts/supplier-recognition";
import * as Recognition from "./recognition";
import * as Shared from "./shared";
import { calculateSupplierDraft } from "./draft-calculation";

type Scope = typeof Accounting.Scope.Type;

type Transaction = import("../../db/transaction").Transaction;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

type Principal = Shared.Principal;

const ReviewSchema = Acceptance.SupplierAcceptanceReview;

const ApprovalSchema = Acceptance.SupplierAcceptanceApproval;

const ViewSchema = Acceptance.SupplierAcceptanceView;

type Plan = typeof RecognitionContract.RecognitionPlan.Type;

type QueryFailure = Accounting.AccountingError | EffectDrizzleQueryError;

type Review = typeof Acceptance.SupplierAcceptanceReview.Type;

// The tax point is the reviewed date the sealed plan was compiled for.
function taxPointOf(review: Review) {
  const taxPointOn = review.recognition?.lines[0]?.taxPointOn;
  const basis = "taxPoint" in review.input ? review.input.taxPoint.basis : null;

  if (taxPointOn === undefined || basis === null) return null;

  return { taxPointOn, basis };
}

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
  "purchase_recognitions",
  "purchase_tax_facts",
  "purchase_line_capacities",
];

const acceptanceInserts = [
  "supplier_acceptance_reviews",
  "supplier_acceptance_approvals",
  "change_sets",
  "events",
  "command_receipts",
  "purchase_recognitions",
  "purchase_tax_facts",
  "purchase_line_capacities",
];

const legalBlockers = [
  "legal_identity_not_verified",
  "tax_profile_not_activated",
  "payment_not_initiated",
] as const;

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

function draftAcceptable(body: JsonObject, profile: string) {
  const totals = Shared.objectField(body, "totals");
  const content = Shared.objectField(body, "content");

  if (Shared.arrayField(body, "blockers").some((entry) => !tolerableBlocker(entry))) return false;

  if (content.supplierDocumentNumber === null || content.supplierDocumentNumber === undefined) {
    return false;
  }

  const tax = Shared.textField(totals, "taxMinor");

  if (tax === undefined || !/^(0|[1-9][0-9]{0,37})$/.test(tax)) return false;

  if (profile === "synthetic-manual-supplier-v1" && tax !== "0") return false;

  if (!/^[1-9][0-9]{0,37}$/.test(Shared.textField(totals, "grossMinor") ?? "")) return false;

  if (totals.sourceTotalMatches !== true) return false;

  return Shared.arrayField(body, "calculatedLines").every(
    (line) => Shared.isJsonObject(line) && line.sourceGrossMatches === true,
  );
}

function tolerableBlocker(entry: Json) {
  const code = Shared.textField(entry, "code");

  return code !== undefined && recoverableBlockers.has(code);
}

type AcceptancePosting = {
  readonly lines: ReadonlyArray<JsonObject>;
  readonly originalLines?: ReadonlyArray<Recognition.PurchaseLineSelection>;
  readonly recognition?: Plan;
  readonly profileWitness?: Json;
  readonly profileGaps?: Json;
  readonly inputVatAccountId?: string;
};

const planJournalLines = (plan: Plan) =>
  plan.journal.map((line) => ({
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
  }));

// The reviewed accounts must be real, active and outside the bank and control
// roles before any amount is compiled for them.
function purchaseAccounts(
  transaction: Transaction,
  bookId: string,
  assignments: ReadonlyArray<{ readonly expenseAccountId: string }>,
  control: string,
  vat: string,
): Effect.Effect<void, QueryFailure> {
  return Effect.forEach(assignments, (assignment) =>
    Effect.gen(function* () {
      const account = (yield* AcceptanceDb.readExpenseAccount(
        transaction,
        bookId,
        assignment.expenseAccountId,
        [control, vat],
      ))[0];

      if (account === undefined || account.id !== assignment.expenseAccountId) {
        return yield* failure("InvalidJournal");
      }

      if (
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
    }),
  );
}

function purchaseRecognition(
  transaction: Transaction,
  scope: Scope,
  book: { currency: string; currencyScale: number },
  draft: JsonObject,
  input: typeof Acceptance.PrepareSwedishSupplierAcceptance.Type,
): Effect.Effect<AcceptancePosting, QueryFailure> {
  return Effect.gen(function* () {
    const control = (yield* AcceptanceDb.readBasAccount(transaction, scope.bookId, "2440"))[0]?.id;

    const vat = (yield* AcceptanceDb.readBasAccount(transaction, scope.bookId, "2641"))[0]?.id;

    if (control === null || control === undefined || control !== input.controlAccountId) {
      return yield* failure("InvalidJournal");
    }

    if (vat === null || vat === undefined) return yield* failure("InvalidJournal");

    const content = Shared.objectField(draft, "content");
    const draftLines = Shared.arrayField(content, "lines");
    const documentDate = Shared.textField(content, "documentDate");

    if (documentDate === undefined || input.taxPoint.taxPointOn > documentDate) {
      return yield* failure("InvalidJournal");
    }

    yield* purchaseAccounts(
      transaction,
      scope.bookId,
      input.lineAssignments,
      input.controlAccountId,
      vat,
    );

    const compiled = yield* Recognition.compilePurchasePlan(transaction, scope, {
      book,
      content,
      draftLines,
      assignments: input.lineAssignments,
      controlAccountId: input.controlAccountId,
      inputVatAccountId: vat,
      taxPoint: input.taxPoint,
      recognitionDate: documentDate,
    });

    if (
      compiled.plan.payableMinor !==
      Shared.textField(Shared.objectField(draft, "totals"), "grossMinor")
    ) {
      return yield* failure("InvalidJournal");
    }

    return {
      lines: planJournalLines(compiled.plan),
      originalLines: compiled.selections,
      recognition: compiled.plan,
      profileWitness: compiled.witness,
      profileGaps: compiled.gaps,
      inputVatAccountId: compiled.inputVatAccountId,
    } satisfies AcceptancePosting;
  });
}

function acceptancePosting(
  transaction: Transaction,
  scope: Scope,
  book: { currency: string; currencyScale: number },
  draft: JsonObject,
  input: typeof Acceptance.PrepareSupplierAcceptance.Type,
): Effect.Effect<AcceptancePosting, QueryFailure> {
  return Effect.gen(function* () {
    if (input.profile === "swedish-purchase-v1") {
      if (book.currency !== "SEK" || book.currencyScale !== 2) {
        return yield* Shared.unsupported();
      }

      return yield* purchaseRecognition(transaction, scope, book, draft, input);
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

    const gross = Shared.textField(Shared.objectField(draft, "totals"), "grossMinor") ?? "0";

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

      if (!draftAcceptable(head.body, command.input.profile)) return yield* Shared.unsupported();

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
      const recognition = posting.recognition;
      const profileWitness = posting.profileWitness;
      const profileGaps = posting.profileGaps;

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

      if (originalLines !== undefined) {
        extras.push({ originalLines: yield* Shared.toJsonObject(originalLines) });
      }

      if (recognition !== undefined) {
        extras.push({ recognition: yield* Shared.toJsonObject(recognition) });
      }

      if (profileWitness !== undefined) {
        extras.push({ profileWitness: yield* Shared.toJsonObject(profileWitness) });
      }

      if (profileGaps !== undefined) {
        extras.push({ profileGaps: yield* Shared.toJsonObject(profileGaps) });
      }

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
    } else if (!draftAcceptable(head[0].body, Shared.textField(input, "profile") ?? "")) {
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

// The reviewed supplier identity of one recognition. A second recognition of the
// same economic key is refused; a further evidence document about it is not.
const requireRecognitionIdentity = Effect.fn("purchases.acceptance.identity")(function* (
  transaction: Transaction,
  scope: Scope,
  review: Review,
) {
  const documentNumber = review.draftSnapshot.content.supplierDocumentNumber;
  const counterpartyId = review.draftSnapshot.content.counterpartyId;
  const recognition = review.recognition;

  if (
    documentNumber === null ||
    (recognition !== undefined &&
      (review.originalLines === undefined ||
        review.inputVatAccountId === undefined ||
        taxPointOf(review) === null))
  ) {
    return yield* failure("InvalidJournal");
  }

  const key = Recognition.economicKey(counterpartyId, documentNumber);

  if (
    (yield* RecognitionDb.readCounterpartyDocumentRecognition(
      transaction,
      scope.bookId,
      counterpartyId,
      documentNumber,
    ))[0]?.present === true
  ) {
    return yield* failure("AlreadyPosted");
  }

  return { key, documentNumber };
});

// The immutable recognition, its signed tax components and its original-line
// capacities commit with the journal and the payable in the same transaction.
const writeOwnedRecognition = Effect.fn("purchases.acceptance.writeRecognition")(function* (
  transaction: Transaction,
  command: {
    readonly scope: Scope;
    readonly principal: Principal;
    readonly review: Review;
    readonly approvalId: string;
    readonly draft: Review["draftSnapshot"];
    readonly key: string;
    readonly voucherId: string;
    readonly payableId: string;
    readonly receipt: JsonObject;
  },
) {
  const { review, draft } = command;
  const plan = review.recognition;
  const taxPoint = taxPointOf(review);

  if (
    plan === undefined ||
    review.originalLines === undefined ||
    review.inputVatAccountId === undefined ||
    taxPoint === null
  ) {
    return null;
  }

  return yield* Recognition.recordRecognitionInTransaction(transaction, {
    scope: command.scope,
    bookId: command.scope.bookId,
    actorId: command.principal.actorId,
    receipt: command.receipt,
    economicKey: command.key,
    draftId: draft.id,
    draftRevision: draft.revision,
    draftDigest: draft.digest,
    counterpartyId: draft.content.counterpartyId,
    documentNumber: draft.content.supplierDocumentNumber ?? "",
    reviewId: review.id,
    approvalId: command.approvalId,
    changeSetId: review.postingPlan.id,
    voucherId: command.voucherId,
    payableId: command.payableId,
    recognitionDate: draft.content.documentDate ?? "",
    taxPoint,
    currency: draft.content.currency,
    currencyScale: draft.content.currencyScale,
    plan,
    selections: review.originalLines,
    inputVatAccountId: review.inputVatAccountId,
    witness: review.profileWitness ?? null,
    gaps: review.profileGaps ?? [],
  });
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
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const { scope, reviewId, input, idempotencyKey } = command,
        operation = "execute_supplier_acceptance";

      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { reviewId, input },
        Acceptance.SupplierAcceptanceReceipt,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireTables(transaction, acceptanceTables, acceptanceInserts);
      yield* readBook(transaction, scope.bookId);
      const row = yield* readReview(transaction, scope.bookId, reviewId);
      const review = yield* Shared.decode(ReviewSchema, row.body);

      if (
        review.digest !== input.digest ||
        (yield* acceptanceBlockers(transaction, scope, row)).length
      )
        return yield* failure("StaleDependency");

      const approval = (yield* AcceptanceDb.readApprovalById(
        transaction,
        scope.bookId,
        input.approvalId,
        reviewId,
      ))[0];

      if (
        !approval ||
        approval.actorId !== principal.actorId ||
        approval.digest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(transaction)) ||
        (yield* AcceptanceDb.readAcceptanceByApproval(transaction, scope.bookId, approval.id))[0]
          ?.present
      )
        return yield* failure("ApprovalRequired");

      const identity = yield* requireRecognitionIdentity(transaction, scope, review);

      const kernel = yield* approveChangeInTransaction(transaction, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("supplier_approve"),
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      const postingReceipt = yield* executeChangeInTransaction(transaction, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("supplier_post"),
        input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: kernel.id },
        owner: { kind: "supplier_acceptance", id: reviewId },
      });

      const draft = review.draftSnapshot;

      const line = review.postingPlan.groups[0]?.actions[0]?.lines.find(
        (line) =>
          line.accountId === review.input.controlAccountId &&
          line.creditMinor === draft.totals.grossMinor,
      );

      if (
        !line ||
        draft.totals.grossMinor === null ||
        draft.content.documentDate === null ||
        draft.content.dueDate === null ||
        draft.content.supplierDocumentNumber === null
      )
        return yield* failure("InvalidJournal");

      const invoice = yield* createInvoiceInTransaction(transaction, principal, {
        scope,
        idempotencyKey: newId("supplier_register"),
        input: {
          kind: "synthetic_invoice_v1",
          direction: "supplier",
          counterpartyId: draft.content.counterpartyId,
          counterpartyRevision: draft.content.counterpartyRevision,
          documentNumber: draft.content.supplierDocumentNumber,
          issuedOn: draft.content.documentDate,
          dueOn: draft.content.dueDate,
          currency: draft.content.currency,
          amountMinor: draft.totals.grossMinor,
          controlAccountId: review.input.controlAccountId,
          recognitionVoucherId: postingReceipt.voucherId,
          recognitionLineId: line.lineId,
          evidenceId: review.evidence.evidenceId,
          description: `Supplier invoice: ${draft.content.title}`,
        },
      });

      const owned = yield* writeOwnedRecognition(transaction, {
        scope,
        principal,
        review,
        approvalId: approval.id,
        draft,
        key: identity.key,
        voucherId: postingReceipt.voucherId,
        payableId: invoice.id,
        receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
      });

      const body = {
        id: newId("supplier_acceptance"),
        scope,
        reviewId,
        reviewDigest: review.digest,
        approvalId: approval.id,
        profile: review.profile,
        draftId: draft.id,
        draftRevision: draft.revision,
        draftDigest: draft.digest,
        supplierDocumentNumber: draft.content.supplierDocumentNumber ?? "",
        accepted: true,
        recognized: true,
        paid: false,
        postingReceipt,
        registerInvoiceId: invoice.id,
        recognitionId: owned?.id ?? null,
        taxFactIds: owned?.taxFactIds ?? [],
        legalBlockers: review.legalBlockers,
        createdAt: yield* isoNow(transaction),
        receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
      };

      const result = yield* Shared.decode(Acceptance.SupplierAcceptanceReceipt, {
        ...body,
        digest: yield* digest(body),
      });

      yield* AcceptanceDb.insertAcceptance(transaction, scope.bookId, result);
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
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

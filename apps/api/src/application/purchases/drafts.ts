import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import * as DraftDb from "../../db/purchases/drafts";
import * as Shared from "./shared";
import { calculateSupplierDraft } from "./draft-calculation";

type Scope = typeof Accounting.Scope.Type;
type Json = Schema.Json;
type JsonObject = Schema.JsonObject;

const RevisionSchema = Drafts.SupplierInvoiceDraftRevision;
const ViewSchema = Drafts.SupplierInvoiceDraftView;
const ListSchema = Drafts.SupplierInvoiceDraftList;
const HistorySchema = Drafts.SupplierInvoiceDraftHistory;
const DuplicatesSchema = Drafts.SupplierInvoiceDraftDuplicates;
const SuggestionsSchema = Drafts.SupplierAccountSuggestions;

const draftTables = [
  "books",
  "accounts",
  "evidence",
  "command_receipts",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_invoices",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "supplier_acceptance_reviews",
  "supplier_acceptances",
];
const draftInserts = [
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "command_receipts",
];
const revisionUpdates = ["supplier_invoice_drafts"];

const maximumDrafts = 200;
const maximumRevisions = 50;
const maximumRevisionBodyBytes = 131072;
const maximumInputBytes = 65536;
const duplicateCursorPattern =
  /^sid1:[a-f0-9]{64}:(d:[a-z][a-z0-9_-]{2,127}:([1-9]|[1-4][0-9]|50)|r:[a-z][a-z0-9_-]{2,127}:0)$/;

export function draftSummary(body: JsonObject) {
  const content = Shared.objectField(body, "content");
  return Object.assign(
    {},
    {
      id: body.id ?? "",
      draftKey: body.draftKey ?? "",
      revision: body.revision ?? "",
      title: content.title ?? null,
      supplierName: Shared.objectField(content, "supplier").legalName ?? null,
      supplierDocumentNumber: content.supplierDocumentNumber ?? null,
      counterpartyId: content.counterpartyId ?? "",
      sourceEvidence: Shared.objectField(body, "sourceEvidence"),
      currency: content.currency ?? "",
      currencyScale: content.currencyScale ?? 0,
      grossMinor: Shared.objectField(Shared.objectField(body, "totals"), "grossMinor") ?? null,
      blockerCount: Shared.arrayField(body, "blockers").length,
      createdAt: body.createdAt ?? "",
      digest: body.digest ?? "",
    },
  ) satisfies JsonObject;
}

function storedDraft(
  transaction: import("../../db/transaction").Transaction,
  bookId: string,
  draftId: string,
) {
  return DraftDb.readDraft(transaction, bookId, draftId).pipe(
    Effect.flatMap((rows) => {
      const draft = rows[0];
      return draft ? Effect.succeed(draft) : failure("NotFound");
    }),
  );
}

export const createSupplierInvoiceDraftInTransaction = Effect.fn(
  "purchases.draft.createInTransaction",
)(function* (
  transaction: import("../../db/transaction").Transaction,
  principal: Shared.Principal,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Drafts.CreateSupplierInvoiceDraft.Type;
  },
) {
  return yield* Effect.gen(function* () {
    yield* Shared.requireTables(transaction, draftTables, draftInserts);
    yield* Shared.requireColumns(transaction, Shared.accountColumns);
    const book = yield* Shared.readBook(transaction, command.scope.bookId);
    if (Shared.byteLength(JSON.stringify(command.input)) > maximumInputBytes) {
      return yield* failure("InvalidJournal");
    }
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "create_supplier_invoice_draft",
      principal.actorId,
      yield* Shared.toJsonObject(command.input),
      RevisionSchema,
    );
    if (request.previous) return request.previous;
    yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);
    if (!Shared.draftKeyPattern.test(command.input.draftKey))
      return yield* failure("InvalidJournal");
    if (
      (yield* DraftDb.readDraftByKey(transaction, command.scope.bookId, command.input.draftKey))
        .length > 0
    ) {
      return yield* failure("IdempotencyConflict");
    }
    if (
      (yield* DraftDb.readDraftCount(transaction, command.scope.bookId))[0]!.total >= maximumDrafts
    ) {
      return yield* failure("InvalidJournal");
    }

    const content = yield* Shared.toJsonObject(command.input.content);
    const calculation = yield* calculateSupplierDraft(
      transaction,
      command.scope.bookId,
      book,
      content,
    );
    const body = Object.assign({}, calculation, {
      id: newId("supplier_invoice_draft"),
      scope: command.scope,
      draftKey: command.input.draftKey,
      revision: "1",
      status: "draft",
      acceptanceSupported: false,
      recognitionSupported: false,
      recognitionAssessment: "not_assessed",
      calculationBasis: "explicit_line_amounts_v1",
      content: command.input.content,
      reason: "Initial supplier commercial draft",
      createdAt: yield* isoNow(transaction),
      receipt: Shared.receipt(
        command.idempotencyKey,
        "create_supplier_invoice_draft",
        principal.actorId,
      ),
    }) satisfies JsonObject;
    const sealed = Object.assign({}, body, { digest: yield* digest(body) });
    if (Shared.byteLength(JSON.stringify(sealed)) > maximumRevisionBodyBytes) {
      return yield* failure("InvalidJournal");
    }
    const revision = yield* Shared.decode(RevisionSchema, sealed);
    const id = Shared.textField(sealed, "id");
    if (id === undefined) return yield* failure("InternalError");
    yield* DraftDb.insertDraft(transaction, {
      bookId: command.scope.bookId,
      id,
      draftKey: command.input.draftKey,
      body: sealed,
    });
    yield* DraftDb.insertDraftRevision(transaction, {
      bookId: command.scope.bookId,
      draftId: id,
      revision: "1",
      body: sealed,
    });
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "create_supplier_invoice_draft",
      principal.actorId,
      yield* Shared.toJsonObject(revision),
    );
    return revision;
  });
});

export const createSupplierInvoiceDraft = Effect.fn("purchases.draft.create")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Drafts.CreateSupplierInvoiceDraft.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    createSupplierInvoiceDraftInTransaction(transaction, principal, command),
  );
});

export const reviseSupplierInvoiceDraft = Effect.fn("purchases.draft.revise")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly draftId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Drafts.ReviseSupplierInvoiceDraft.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, draftTables, draftInserts, revisionUpdates);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);
      if (Shared.byteLength(JSON.stringify(command.input)) > maximumInputBytes) {
        return yield* failure("InvalidJournal");
      }
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "revise_supplier_invoice_draft",
        principal.actorId,
        {
          id: command.draftId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        RevisionSchema,
      );
      if (request.previous) return request.previous;
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const draft = yield* storedDraft(transaction, command.scope.bookId, command.draftId);
      const head = (yield* DraftDb.readHeadRevision(
        transaction,
        command.scope.bookId,
        command.draftId,
        draft.currentRevision,
      ))[0];
      if (!head) return yield* failure("NotFound");
      if (
        command.input.expectedRevision !== draft.currentRevision ||
        command.input.expectedDigest !== Shared.textField(head.body, "digest")
      ) {
        return yield* failure("StaleDependency");
      }
      if (Number(draft.currentRevision) >= maximumRevisions) {
        return yield* failure("InvalidJournal");
      }

      const content = yield* Shared.toJsonObject(command.input.content);
      const calculation = yield* calculateSupplierDraft(
        transaction,
        command.scope.bookId,
        book,
        content,
      );
      const nextRevision = (BigInt(draft.currentRevision) + 1n).toString();
      const body = Object.assign({}, calculation, {
        id: command.draftId,
        scope: command.scope,
        draftKey: draft.draftKey,
        revision: nextRevision,
        status: "draft",
        acceptanceSupported: false,
        recognitionSupported: false,
        recognitionAssessment: "not_assessed",
        calculationBasis: "explicit_line_amounts_v1",
        content: command.input.content,
        reason: command.input.reason,
        createdAt: yield* isoNow(transaction),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "revise_supplier_invoice_draft",
          principal.actorId,
        ),
      }) satisfies JsonObject;
      const sealed = Object.assign({}, body, { digest: yield* digest(body) });
      if (Shared.byteLength(JSON.stringify(sealed)) > maximumRevisionBodyBytes) {
        return yield* failure("InvalidJournal");
      }
      const revision = yield* Shared.decode(RevisionSchema, sealed);
      yield* DraftDb.insertDraftRevision(transaction, {
        bookId: command.scope.bookId,
        draftId: command.draftId,
        revision: nextRevision,
        body: sealed,
      });
      yield* DraftDb.advanceDraftRevision(transaction, command.scope.bookId, command.draftId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "revise_supplier_invoice_draft",
        principal.actorId,
        yield* Shared.toJsonObject(revision),
      );
      return revision;
    }),
  );
});

export const getSupplierInvoiceDraft = Effect.fn("purchases.draft.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly draftId: string; readonly revision?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, draftTables);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      const requested = command.revision ?? "";
      if (requested !== "" && !/^[1-9][0-9]{0,17}$/.test(requested)) {
        return yield* failure("InvalidJournal");
      }
      const draft = yield* storedDraft(transaction, command.scope.bookId, command.draftId);
      const head = (yield* DraftDb.readHeadRevision(
        transaction,
        command.scope.bookId,
        command.draftId,
        draft.currentRevision,
      ))[0];
      if (!head) return yield* failure("NotFound");
      const stored = (yield* DraftDb.readRevision(
        transaction,
        command.scope.bookId,
        command.draftId,
        requested === "" ? draft.currentRevision : requested,
      ))[0];
      if (!stored) return yield* failure("NotFound");
      return yield* Shared.decode(ViewSchema, {
        record: yield* Shared.decode(RevisionSchema, stored.body),
        currentRevision: draft.currentRevision,
        currentDigest: Shared.textField(head.body, "digest") ?? "",
      });
    }),
  );
});

export const listSupplierInvoiceDrafts = Effect.fn("purchases.draft.list")(function* (
  token: string,
  command: { readonly scope: Scope },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, draftTables);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      const count = (yield* DraftDb.readDraftCount(transaction, command.scope.bookId))[0]!.total;
      if (count > maximumDrafts) return yield* failure("InvalidJournal");
      const rows = yield* DraftDb.listDraftHeads(transaction, command.scope.bookId);
      if (rows.length !== count) return yield* failure("InvalidJournal");
      const body = Object.assign(
        {},
        {
          scope: command.scope,
          complete: true,
          count,
          items: rows.map((row) => draftSummary(row.body)),
          capturedAt: yield* isoNow(transaction),
        },
      ) satisfies JsonObject;
      return yield* Shared.decode(
        ListSchema,
        Object.assign({}, body, { digest: yield* digest(body) }),
      );
    }),
  );
});

export const supplierInvoiceDraftHistory = Effect.fn("purchases.draft.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly draftId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, draftTables);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      const draft = yield* storedDraft(transaction, command.scope.bookId, command.draftId);
      const rows = yield* DraftDb.listDraftHistory(
        transaction,
        command.scope.bookId,
        command.draftId,
      );
      if (
        rows.length !== Number(draft.currentRevision) ||
        Number(draft.currentRevision) > maximumRevisions
      ) {
        return yield* failure("InvalidJournal");
      }
      const body = Object.assign(
        {},
        {
          scope: command.scope,
          id: command.draftId,
          currentRevision: draft.currentRevision,
          complete: true,
          count: Number(draft.currentRevision),
          items: rows.map((row) => draftSummary(row.body)),
          capturedAt: yield* isoNow(transaction),
        },
      ) satisfies JsonObject;
      return yield* Shared.decode(
        HistorySchema,
        Object.assign({}, body, { digest: yield* digest(body) }),
      );
    }),
  );
});

export const supplierInvoiceDraftDuplicates = Effect.fn("purchases.draft.duplicates")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly draftId: string;
    readonly after?: string;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, draftTables);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      const head = (yield* DraftDb.readHeadRevision(
        transaction,
        command.scope.bookId,
        command.draftId,
        (yield* storedDraft(transaction, command.scope.bookId, command.draftId)).currentRevision,
      ))[0];
      if (!head) return yield* failure("NotFound");

      const content = Shared.objectField(head.body, "content");
      const counterpartyId = Shared.textField(content, "counterpartyId") ?? "";
      const documentNumber = Shared.textField(content, "supplierDocumentNumber") ?? null;
      const evidenceSha256 =
        Shared.textField(Shared.objectField(head.body, "sourceEvidence"), "sha256") ?? null;
      const context = (yield* digest({
        entityId: command.scope.entityId,
        bookId: command.scope.bookId,
        draftId: command.draftId,
        draftDigest: Shared.textField(head.body, "digest") ?? "",
      })).slice(7);

      let afterKind = "";
      let afterId = "";
      let afterRevision = "0";
      if (command.after !== undefined) {
        const match = duplicateCursorPattern.exec(command.after);
        if (match === null || match[1] !== context) {
          return yield* failure("InvalidJournal");
        }
        afterKind = match[2] ?? "";
        afterId = match[3] ?? "";
        afterRevision = match[4] ?? "0";
        if (afterKind === "d") {
          const anchor = yield* DraftDb.readDuplicateAnchorDraftRevision(
            transaction,
            command.scope.bookId,
            afterId,
            afterRevision,
            counterpartyId,
            documentNumber,
            evidenceSha256,
          );
          if (afterId === command.draftId || anchor[0]?.present !== true) {
            return yield* failure("InvalidJournal");
          }
        } else {
          const anchor = yield* DraftDb.readDuplicateAnchorInvoice(
            transaction,
            command.scope.bookId,
            afterId,
            counterpartyId,
            documentNumber,
            evidenceSha256,
          );
          if (anchor[0]?.present !== true) return yield* failure("InvalidJournal");
        }
      }

      const page = yield* DraftDb.readDuplicateCandidates(
        transaction,
        command.scope.bookId,
        command.draftId,
        counterpartyId,
        documentNumber,
        evidenceSha256,
        afterKind,
        afterId,
      );
      const visible = page.slice(0, 50);
      const items: JsonObject[] = [];
      for (const candidate of visible) {
        const reasons: Json[] = [];
        if (candidate.sameNumber) reasons.push("same_document_number");
        if (candidate.sameContent) reasons.push("same_original_evidence_content");
        if (candidate.kind === "d") {
          const row = (yield* DraftDb.readRevision(
            transaction,
            command.scope.bookId,
            candidate.id,
            candidate.revision,
          ))[0];
          if (!row) return yield* failure("InvalidJournal");
          items.push({
            kind: "draft",
            draft: draftSummary(row.body),
            reasons,
          });
          continue;
        }
        const invoice = (yield* DraftDb.readRegisteredInvoiceBody(
          transaction,
          command.scope.bookId,
          candidate.id,
        ))[0];
        if (!invoice) return yield* failure("InvalidJournal");
        items.push({ kind: "registered", invoice: invoice.body, reasons });
      }
      const anchor = visible[visible.length - 1];
      return yield* Shared.decode(DuplicatesSchema, {
        scope: command.scope,
        source: draftSummary(head.body),
        coverage: "current_supplier_drafts_and_registered_supplier_invoices",
        consistency: "live_candidates",
        items,
        next:
          page.length > 50 && anchor
            ? `sid1:${context}:${anchor.kind}:${anchor.id}:${anchor.revision}`
            : null,
      });
    }),
  );
});

export const supplierAccountSuggestions = Effect.fn("purchases.draft.accountSuggestions")(
  function* (token: string, command: { readonly scope: Scope; readonly counterpartyId: string }) {
    return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
      Effect.gen(function* () {
        yield* Shared.requireTables(transaction, draftTables);
        const book = (yield* Shared.PurchaseDb.lockBook(
          transaction,
          command.scope.bookId,
          "share",
        ))[0];
        if (!book) return yield* failure("Forbidden");
        if (
          (yield* DraftDb.readSupplierCounterpartyExists(
            transaction,
            command.scope.bookId,
            command.counterpartyId,
          ))[0]?.present !== true
        ) {
          return yield* failure("NotFound");
        }
        const rows = yield* DraftDb.readSupplierAccountSuggestions(
          transaction,
          command.scope.bookId,
          command.counterpartyId,
        );
        return yield* Shared.decode(SuggestionsSchema, {
          scope: command.scope,
          counterpartyId: command.counterpartyId,
          items: rows.map((row) => ({
            expenseAccountId: row.expenseAccountId,
            vatRatePercent: row.vatRatePercent,
            sourceInvoiceId: row.sourceInvoiceId,
          })),
        });
      }),
    );
  },
);

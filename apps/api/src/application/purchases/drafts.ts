import { readFirmMemory } from "../automation/firm-memory";
import * as Provenance from "@open-erp/contracts/decision-provenance";
import { recordSuggestion } from "../decision-provenance";
import { readSealedDraft } from "../../db/posting-admission";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import * as DraftDb from "../../db/purchases/drafts";
import * as InvoiceDb from "../../db/commerce/invoices";
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

const draftPageSize = 200;

const maximumRevisions = 50;

const maximumRevisionBodyBytes = 131072;

const maximumInputBytes = 65536;

const duplicateCursorPattern =
  /^sid1:(?<context>[a-f0-9]{64}):(?<kind>d|r):(?<id>[a-z][a-z0-9_-]{2,127}):(?<revision>0|[1-9]|[1-4][0-9]|50)$/;

export function draftSummary(body: typeof Drafts.SupplierInvoiceDraftRevision.Type) {
  const content = body.content;

  return Object.assign(
    {},
    {
      id: body.id,
      draftKey: body.draftKey,
      revision: body.revision,
      title: content.title,
      supplierName: content.supplier.legalName,
      supplierDocumentNumber: content.supplierDocumentNumber,
      counterpartyId: content.counterpartyId,
      sourceEvidence: body.sourceEvidence,
      currency: content.currency,
      currencyScale: content.currencyScale,
      grossMinor: body.totals.grossMinor,
      blockerCount: body.blockers.length,
      createdAt: body.createdAt,
      digest: body.digest,
    },
  ) satisfies typeof Drafts.SupplierInvoiceDraftSummary.Type;
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
    reviseSupplierInvoiceDraftInTransaction(transaction, principal, command),
  );
});

// Nested callers supply a distinct child command key in the same transaction.
// The parent's receipt owns replay; child and parent receipts commit together.
export const reviseSupplierInvoiceDraftInTransaction = Effect.fn(
  "purchases.draft.reviseInTransaction",
)(function* (
  transaction: import("../../db/transaction").Transaction,
  principal: Shared.Principal,
  command: {
    readonly scope: Scope;
    readonly draftId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Drafts.ReviseSupplierInvoiceDraft.Type;
  },
) {
  return yield* Effect.gen(function* () {
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
      (yield* readSealedDraft(transaction, command.scope.bookId, command.draftId, "supplier"))
        .length
    )
      return yield* failure("Forbidden");

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
  });
});

export const getSupplierInvoiceDraft = Effect.fn("purchases.draft.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly draftId: string; readonly revision?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, draftTables);

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
  command: { readonly scope: Scope; readonly after?: string; readonly q?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, draftTables);

      const search = command.q ?? "";

      if (search.length > 200) return yield* failure("InvalidJournal");

      const context = (yield* digest({ scope: command.scope, q: search })).slice(7);
      let after = "";

      if (command.after !== undefined) {
        const match = /^sdl1:(?<context>[a-f0-9]{64}):(?<key>[a-z][a-z0-9_-]{2,127})$/.exec(
          command.after,
        )?.groups;

        if (!match || match.context !== context) return yield* failure("InvalidJournal");
        after = match.key ?? "";
      }

      const page = yield* DraftDb.listDraftHeads(transaction, command.scope.bookId, after, search);
      const rows = page.slice(0, draftPageSize);

      const items = yield* Effect.forEach(rows, (row) =>
        Shared.decode(RevisionSchema, row.body).pipe(Effect.map(draftSummary)),
      );

      const anchor = rows.at(-1);

      const body = Object.assign(
        {},
        {
          scope: command.scope,
          complete: command.after === undefined && page.length <= draftPageSize,
          count: items.length,
          items,
          next: page.length > draftPageSize && anchor ? `sdl1:${context}:${anchor.draftKey}` : null,
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
          items: yield* Effect.forEach(rows, (row) =>
            Shared.decode(RevisionSchema, row.body).pipe(Effect.map(draftSummary)),
          ),
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
      yield* Shared.requireTables(transaction, [
        ...draftTables,
        ...InvoiceDb.commerceInvoiceTables,
        "supplier_credits",
        "customer_credit_notes",
        "journal_lines",
      ]);

      const head = (yield* DraftDb.readHeadRevision(
        transaction,
        command.scope.bookId,
        command.draftId,
        (yield* storedDraft(transaction, command.scope.bookId, command.draftId)).currentRevision,
      ))[0];

      if (!head) return yield* failure("NotFound");

      if (
        (yield* readSealedDraft(transaction, command.scope.bookId, command.draftId, "supplier"))
          .length
      )
        return yield* failure("Forbidden");

      const source = yield* Shared.decode(RevisionSchema, head.body);
      const counterpartyId = source.content.counterpartyId;
      const documentNumber = source.content.supplierDocumentNumber;
      const evidenceSha256 = source.sourceEvidence.sha256;

      const context = (yield* digest({
        entityId: command.scope.entityId,
        bookId: command.scope.bookId,
        draftId: command.draftId,
        draftDigest: source.digest,
      })).slice(7);

      let afterKind = "";
      let afterId = "";
      let afterRevision = "0";

      if (command.after !== undefined) {
        const match = duplicateCursorPattern.exec(command.after)?.groups;

        if (
          !match ||
          match.context !== context ||
          (match.kind === "r") !== (match.revision === "0")
        ) {
          return yield* failure("InvalidJournal");
        }

        afterKind = match.kind ?? "";
        afterId = match.id ?? "";
        afterRevision = match.revision ?? "0";

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

      const invoiceIds = visible
        .filter((candidate) => candidate.kind === "r")
        .map((candidate) => candidate.id);

      const invoices =
        invoiceIds.length === 0
          ? []
          : yield* InvoiceDb.readLiveInvoicePage(transaction, command.scope.bookId, invoiceIds);

      const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice.body]));
      const items: JsonObject[] = [];

      for (const candidate of visible) {
        const reasons: Json[] = [];

        if (candidate.sameNumber) reasons.push("same_document_number");

        if (candidate.sameContent) reasons.push("same_original_evidence_content");

        if (candidate.kind === "d") {
          items.push({
            kind: "draft",
            draft: draftSummary(yield* Shared.decode(RevisionSchema, candidate.body)),
            reasons,
          });
          continue;
        }

        const invoice = invoicesById.get(candidate.id);

        if (!invoice) return yield* failure("InternalError");
        items.push({ kind: "registered", invoice, reasons });
      }

      const anchor = visible[visible.length - 1];

      return yield* Shared.decode(DuplicatesSchema, {
        scope: command.scope,
        source: draftSummary(source),
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
  function* (
    token: string,
    command: {
      readonly scope: Scope;
      readonly counterpartyId: string;
      readonly draftId: string;
      readonly draftRevision: string;
    },
  ) {
    return yield* Shared.withBook(token, command.scope, false, "share", (transaction, principal) =>
      Effect.gen(function* () {
        yield* Shared.requireTables(transaction, draftTables);

        if (
          (yield* DraftDb.readSupplierCounterpartyExists(
            transaction,
            command.scope.bookId,
            command.counterpartyId,
          ))[0]?.present !== true
        ) {
          return yield* failure("NotFound");
        }

        const head = (yield* DraftDb.readHeadRevision(
          transaction,
          command.scope.bookId,
          command.draftId,
          command.draftRevision,
        ))[0];

        if (!head) return yield* failure("NotFound");

        const draft = yield* Shared.decode(RevisionSchema, head.body);

        if (draft.content.counterpartyId !== command.counterpartyId)
          return yield* failure("Forbidden");

        const memory = yield* readFirmMemory(transaction, {
          bookId: command.scope.bookId,
          counterpartyId: command.counterpartyId,
          documentKind: "supplier_invoice",
          currency: draft.content.currency,
          currencyScale: draft.content.currencyScale,
          description: draft.content.lines.map((line) => line.description).join(" | "),
          amountMinor: draft.content.sourceTotalMinor,
          excludeRelatedIds: [
            `draft:${command.draftId}`,
            `evidence:${draft.content.sourceEvidenceId}`,
          ],
        });

        const items = memory.precedents
          .flatMap((record) => record.accountHints)
          .filter(
            (item, index, all) =>
              all.findIndex(
                (other) =>
                  other.expenseAccountId === item.expenseAccountId &&
                  other.vatRatePercent === item.vatRatePercent,
              ) === index,
          )
          .slice(0, 5);

        const ranked = yield* Shared.decode(Provenance.SuggestionOptions, {
          source: "firm_memory_v2",
          version: memory.algorithmVersion,
          historyDigest: memory.historyDigest,
          legacyItems: items,
          options: memory.precedents,
        });

        const suggestionRecordId = yield* recordSuggestion(
          transaction,
          command.scope.bookId,
          principal,
          { kind: "supplier_draft", draftId: command.draftId, revision: command.draftRevision },
          ranked,
        );

        return yield* Shared.decode(SuggestionsSchema, {
          algorithmVersion: memory.algorithmVersion,
          historyDigest: memory.historyDigest,
          precedents: memory.precedents,
          eligibleCount: memory.eligibleCount,
          exclusions: memory.exclusions,
          suggestionRecordId,
          draftId: command.draftId,
          draftRevision: command.draftRevision,
          scope: command.scope,
          counterpartyId: command.counterpartyId,
          items,
        });
      }),
    );
  },
);

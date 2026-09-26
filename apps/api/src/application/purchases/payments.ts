import * as Accounting from "@open-erp/contracts/accounting";
import * as Payments from "@open-erp/contracts/supplier-payment-batches";
import * as Effect from "effect/Effect";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import * as PaymentDb from "../../db/purchases/payments";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = import("effect/Schema").JsonObject;

const ProposalSchema = Payments.PayeeProposal;
const VerificationSchema = Payments.PayeeVerification;
const ReviewSchema = Payments.PayeeReview;
const OutcomeSchema = Payments.PaymentOutcome;
const BatchViewSchema = Payments.SupplierPaymentBatchView;
const PreviewSchema = Payments.SupplierPaymentPreview;
const ExportSchema = Payments.SupplierPaymentExport;

const paymentTables = [
  "books",
  "accounts",
  "evidence",
  "command_receipts",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_invoices",
  "supplier_acceptances",
  "supplier_payment_batch_previews",
  "supplier_payment_batch_exports",
  "supplier_payment_batch_items",
  "supplier_payee_proposals",
  "supplier_payee_verifications",
  "supplier_payment_outcomes",
];
const payeeInserts = [
  "supplier_payee_proposals",
  "supplier_payee_verifications",
  "supplier_payment_outcomes",
  "command_receipts",
];
const maximumOutcomes = 50;
const maximumPreviews = 200;

const ibanPattern = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const bicPattern = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

function checkIban(value: string) {
  if (!ibanPattern.test(value)) return yieldInvalid();
  const reordered = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const character of reordered) {
    const code = character.charCodeAt(0);
    const addend =
      code >= 65 && code <= 90 ? 100 + (code - 65) : code >= 48 && code <= 57 ? code - 48 : -1;
    if (addend < 0) return yieldInvalid();
    remainder = (remainder * (addend > 9 ? 100 : 10) + addend) % 97;
  }
  if (remainder !== 1) return yieldInvalid();
  return value;
}

function yieldInvalid(): never {
  throw failure("InvalidJournal");
}

function checkBic(value: string) {
  if (!bicPattern.test(value)) return yieldInvalid();
  return value;
}

function checkXmlText(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return yieldInvalid();
  }
  return value;
}

function readBook(transaction: import("../../db/transaction").Transaction, bookId: string) {
  return Shared.readBook(transaction, bookId);
}

export const proposeSupplierPayee = Effect.fn("purchases.payments.proposePayee")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Payments.PayeeProposalInput.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, paymentTables, payeeInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* readBook(transaction, command.scope.bookId);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "propose_supplier_payee",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        ProposalSchema,
      );
      if (request.previous) return request.previous;
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const party = (yield* PaymentDb.readCounterpartyRevision(
        transaction,
        command.scope.bookId,
        command.input.counterpartyId,
      ))[0];
      if (!party || (party.role !== "supplier" && party.role !== "both")) {
        return yield* failure("NotFound");
      }
      if (party.currentRevision !== command.input.expectedRevision) {
        return yield* failure("StaleDependency");
      }
      checkXmlText(command.input.creditorName);
      checkIban(command.input.creditorIban);
      checkBic(command.input.creditorBic);
      const evidence = yield* Shared.readEvidenceReference(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      );

      const body = Object.assign(
        {},
        {
          id: newId("payee_proposal"),
          scope: command.scope,
          counterpartyId: command.input.counterpartyId,
          counterpartyRevision: party.currentRevision,
          creditorName: command.input.creditorName,
          creditorIban: command.input.creditorIban,
          creditorBic: command.input.creditorBic,
          evidence,
          reason: command.input.reason,
          status: "pending",
          bankVerified: false,
          createdAt: yield* isoNow(transaction),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "propose_supplier_payee",
            principal.actorId,
          ),
        },
      ) satisfies JsonObject;
      const sealed = Object.assign({}, body, { digest: yield* digest(body) });
      const proposal = yield* Shared.decode(ProposalSchema, sealed);
      yield* PaymentDb.insertPayeeProposal(transaction, {
        bookId: command.scope.bookId,
        id: Shared.textField(sealed, "id") ?? "",
        counterpartyId: command.input.counterpartyId,
        counterpartyRevision: party.currentRevision,
        actorId: principal.actorId,
        evidenceId: command.input.evidenceId,
        creditorName: command.input.creditorName,
        creditorIban: command.input.creditorIban,
        creditorBic: command.input.creditorBic,
        body: sealed,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "propose_supplier_payee",
        principal.actorId,
        yield* Shared.toJsonObject(proposal),
      );
      return proposal;
    }),
  );
});

export const verifySupplierPayee = Effect.fn("purchases.payments.verifyPayee")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly proposalId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Payments.VerifyPayeeInput.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, paymentTables, payeeInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      yield* readBook(transaction, command.scope.bookId);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "verify_supplier_payee",
        principal.actorId,
        {
          proposalId: command.proposalId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        VerificationSchema,
      );
      if (request.previous) return request.previous;

      const proposal = (yield* PaymentDb.readPayeeProposal(
        transaction,
        command.scope.bookId,
        command.proposalId,
      ))[0];
      if (!proposal) return yield* failure("NotFound");
      if (proposal.actorId === principal.actorId) return yield* failure("ApprovalRequired");

      const latest = (yield* PaymentDb.readLatestProposalForCounterparty(
        transaction,
        command.scope.bookId,
        proposal.counterpartyId,
      ))[0]?.id;
      const counterparty = (yield* PaymentDb.readCounterpartyRevision(
        transaction,
        command.scope.bookId,
        proposal.counterpartyId,
      ))[0];
      if (
        command.input.digest !== Shared.textField(proposal.body, "digest") ||
        (yield* PaymentDb.readPayeeVerificationByProposal(
          transaction,
          command.scope.bookId,
          command.proposalId,
        )).length > 0 ||
        latest !== command.proposalId ||
        !counterparty ||
        counterparty.currentRevision !== proposal.counterpartyRevision
      ) {
        return yield* failure("StaleDependency");
      }
      if (command.input.evidenceId !== proposal.evidenceId) {
        return yield* failure("MissingEvidence");
      }

      const body = Object.assign(
        {},
        {
          id: newId("payee_verification"),
          scope: command.scope,
          proposalId: command.proposalId,
          proposalDigest: Shared.textField(proposal.body, "digest") ?? "",
          counterpartyId: proposal.counterpartyId,
          counterpartyRevision: proposal.counterpartyRevision,
          creditorName: proposal.creditorName,
          creditorIban: proposal.creditorIban,
          creditorBic: proposal.creditorBic,
          evidence: Shared.objectField(proposal.body, "evidence"),
          status: "independently_checked",
          bankVerified: false,
          reason: command.input.reason,
          createdAt: yield* isoNow(transaction),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "verify_supplier_payee",
            principal.actorId,
          ),
        },
      ) satisfies JsonObject;
      const sealed = Object.assign({}, body, { digest: yield* digest(body) });
      const verification = yield* Shared.decode(VerificationSchema, sealed);
      yield* PaymentDb.insertPayeeVerification(transaction, {
        bookId: command.scope.bookId,
        id: Shared.textField(sealed, "id") ?? "",
        proposalId: command.proposalId,
        counterpartyId: proposal.counterpartyId,
        counterpartyRevision: proposal.counterpartyRevision,
        evidenceId: proposal.evidenceId,
        creditorName: proposal.creditorName,
        creditorIban: proposal.creditorIban,
        creditorBic: proposal.creditorBic,
        actorId: principal.actorId,
        body: sealed,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "verify_supplier_payee",
        principal.actorId,
        yield* Shared.toJsonObject(verification),
      );
      return verification;
    }),
  );
});

export const getSupplierPayee = Effect.fn("purchases.payments.getPayee")(function* (
  token: string,
  command: { readonly scope: Scope; readonly proposalId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, paymentTables);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      const proposal = (yield* PaymentDb.readPayeeProposal(
        transaction,
        command.scope.bookId,
        command.proposalId,
      ))[0];
      if (!proposal) return yield* failure("NotFound");
      const verification = (yield* PaymentDb.readPayeeVerificationByProposal(
        transaction,
        command.scope.bookId,
        command.proposalId,
      ))[0];
      let current = false;
      if (verification) {
        const latest = (yield* PaymentDb.readLatestProposalForCounterparty(
          transaction,
          command.scope.bookId,
          proposal.counterpartyId,
        ))[0]?.id;
        const counterparty = (yield* PaymentDb.readCounterpartyRevision(
          transaction,
          command.scope.bookId,
          proposal.counterpartyId,
        ))[0];
        current =
          latest === proposal.id &&
          counterparty !== undefined &&
          counterparty.currentRevision === proposal.counterpartyRevision;
      }
      return yield* Shared.decode(ReviewSchema, {
        proposal: yield* Shared.decode(ProposalSchema, proposal.body),
        verification: verification
          ? yield* Shared.decode(VerificationSchema, verification.body)
          : null,
        current,
      });
    }),
  );
});

export const reportSupplierPaymentOutcome = Effect.fn("purchases.payments.reportOutcome")(
  function* (
    token: string,
    command: {
      readonly scope: Scope;
      readonly exportId: string;
      readonly idempotencyKey: string;
      readonly input: typeof Payments.OutcomeInput.Type;
    },
  ) {
    return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
      Effect.gen(function* () {
        yield* Shared.requireTables(transaction, paymentTables, payeeInserts);
        yield* Shared.requireColumns(transaction, Shared.accountColumns);
        yield* readBook(transaction, command.scope.bookId);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "report_supplier_payment_outcome",
          principal.actorId,
          {
            exportId: command.exportId,
            input: yield* Shared.toJsonObject(command.input),
          } satisfies JsonObject,
          OutcomeSchema,
        );
        if (request.previous) return request.previous;

        const exported = (yield* PaymentDb.readExport(
          transaction,
          command.scope.bookId,
          command.exportId,
        ))[0];
        if (!exported) return yield* failure("NotFound");
        if (command.input.exportSha256 !== Shared.textField(exported.body, "sha256")) {
          return yield* failure("StaleDependency");
        }
        const evidence = yield* Shared.readEvidenceReference(
          transaction,
          command.scope.bookId,
          command.input.evidenceId,
        );
        const latest = (yield* PaymentDb.readLatestOutcome(
          transaction,
          command.scope.bookId,
          command.exportId,
        ))[0];
        const ordinal = latest?.nextOrdinal ?? 1;
        const priorAccepted =
          (yield* PaymentDb.readPriorAcceptedOutcome(
            transaction,
            command.scope.bookId,
            command.exportId,
          ))[0]?.present === true;
        if (
          ordinal > maximumOutcomes ||
          latest?.status === "reported_settled" ||
          latest?.status === "reported_rejected" ||
          (latest?.status === "reported_accepted" &&
            command.input.status === "reported_rejected") ||
          (priorAccepted &&
            (command.input.status === "unknown" || command.input.status === "reported_rejected"))
        ) {
          return yield* failure("StaleDependency");
        }

        const body = Object.assign(
          {},
          {
            id: newId("payment_outcome"),
            scope: command.scope,
            exportId: command.exportId,
            exportSha256: command.input.exportSha256,
            status: command.input.status,
            ordinal,
            evidence,
            externalReference: command.input.externalReference,
            reason: command.input.reason,
            bankVerified: false,
            paid: false,
            allocationCreated: false,
            createdAt: yield* isoNow(transaction),
            receipt: Shared.receipt(
              command.idempotencyKey,
              "report_supplier_payment_outcome",
              principal.actorId,
            ),
          },
        ) satisfies JsonObject;
        const sealed = Object.assign({}, body, { digest: yield* digest(body) });
        const outcome = yield* Shared.decode(OutcomeSchema, sealed);
        yield* PaymentDb.insertOutcome(transaction, {
          bookId: command.scope.bookId,
          id: Shared.textField(sealed, "id") ?? "",
          exportId: command.exportId,
          ordinal,
          actorId: principal.actorId,
          evidenceId: command.input.evidenceId,
          status: command.input.status,
          body: sealed,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "report_supplier_payment_outcome",
          principal.actorId,
          yield* Shared.toJsonObject(outcome),
        );
        return outcome;
      }),
    );
  },
);

export const getSupplierPaymentBatch = Effect.fn("purchases.payments.getBatch")(function* (
  token: string,
  command: { readonly scope: Scope; readonly previewId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, paymentTables);
      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];
      if (!book) return yield* failure("Forbidden");
      const preview = (yield* PaymentDb.readPreview(
        transaction,
        command.scope.bookId,
        command.previewId,
      ))[0];
      if (!preview) return yield* failure("NotFound");
      const exported = (yield* PaymentDb.readExportByPreview(
        transaction,
        command.scope.bookId,
        command.previewId,
      ))[0];
      const outcomes =
        exported === undefined
          ? []
          : yield* PaymentDb.readOutcomes(transaction, command.scope.bookId, exported.id);
      const latest =
        exported === undefined
          ? undefined
          : (yield* PaymentDb.readLatestOutcome(transaction, command.scope.bookId, exported.id))[0];
      const current =
        exported === undefined
          ? false
          : (yield* PaymentDb.readPayeeStillCurrent(
              transaction,
              command.scope.bookId,
              command.previewId,
            ))[0]?.current === true;
      return yield* Shared.decode(BatchViewSchema, {
        preview: yield* Shared.decode(PreviewSchema, preview.body),
        export: exported === undefined ? null : yield* Shared.decode(ExportSchema, exported.body),
        outcomes: yield* Effect.forEach(outcomes, (row) => Shared.decode(OutcomeSchema, row.body)),
        payeeStillCurrent: current,
        externalStatus: exported === undefined ? "not_exported" : (latest?.status ?? "exported"),
        bankVerified: false,
        allocationCreated: false,
        recovery:
          "Retain exported bytes and reconcile bank evidence before recording payment. Never re-export an unresolved invoice.",
      });
    }),
  );
});

export const prepareSupplierPaymentBatch = Effect.fn("purchases.payments.prepareBatch")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Payments.PrepareSupplierPaymentBatch.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, paymentTables, [
        "supplier_payment_batch_previews",
        "command_receipts",
      ]);
      yield* readBook(transaction, command.scope.bookId);
      if (
        (yield* PaymentDb.readPreviewCount(transaction, command.scope.bookId))[0]!.total >=
        maximumPreviews
      ) {
        return yield* failure("InvalidJournal");
      }
      return yield* Shared.unsupported();
    }),
  );
});

export const exportSupplierPaymentBatch = Effect.fn("purchases.payments.exportBatch")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly previewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Payments.ExportSupplierPaymentBatch.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, paymentTables, [
        "supplier_payment_batch_exports",
        "supplier_payment_batch_items",
        "command_receipts",
      ]);
      yield* readBook(transaction, command.scope.bookId);
      return yield* Shared.unsupported();
    }),
  );
});

export const listSupplierPaymentEligibility = Effect.fn("purchases.payments.eligibility")(
  function* (token: string, command: { readonly scope: Scope; readonly after?: string }) {
    return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
      Effect.gen(function* () {
        yield* Shared.requireTables(transaction, paymentTables);
        const book = (yield* Shared.PurchaseDb.lockBook(
          transaction,
          command.scope.bookId,
          "share",
        ))[0];
        if (!book) return yield* failure("Forbidden");
        return yield* Shared.unsupported();
      }),
    );
  },
);

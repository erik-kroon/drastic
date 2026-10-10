import { runBookCommandWithReceipt } from "../book-commands";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cash from "@open-erp/contracts/cash-forecast";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as BankDb from "../../db/banking/shared";
import * as BasisDb from "../../db/cash/basis";
import * as FxDb from "../../db/commerce/fx";
import type { Transaction } from "../../db/transaction";
import { readCashOpeningWitnessInTransaction } from "../banking/reconciliations";
import * as Bank from "../banking/shared";
import { findFinalCashSourceInTransaction } from "../commerce/cash-payments";
import { readItemState } from "../commerce/fx";
import { readForecastInvoicesInTransaction } from "../commerce/register";
import { readEvidenceReference, requireTableAccess } from "../commerce/support";
import { readSettlementOpeningSourceInTransaction } from "../purchases/supplier-settlements";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { sha256Hex } from "../hashing";

type Scope = typeof Accounting.Scope.Type;

type Input = typeof Cash.CaptureCashBasis.Type;

const sourceTables = [
  "accounts",
  "bank_active_matches",
  "bank_capacity_reconciliations",
  "bank_observations",
  "bank_source_coverage_reports",
  "bank_sources",
  "bank_statements",
  "books",
  "cash_method_credit_lines",
  "cash_method_credits",
  "cash_method_lines",
  "cash_method_recognitions",
  "closing_inventories",
  "commerce_allocation_legs",
  "commerce_allocation_reversals",
  "commerce_fx_items",
  "commerce_fx_settlement_corrections",
  "commerce_fx_settlements",
  "commerce_invoice_revisions",
  "commerce_invoices",
  "customer_credit_notes",
  "events",
  "evidence",
  "execution_receipts",
  "invoice_cancellations",
  "journal_lines",
  "owner_operation_receipts",
  "periods",
  "supplier_credits",
  "supplier_refund_principal_increases",
  "supplier_settlement_cancellation_receipts",
  "supplier_settlement_plans",
  "supplier_settlement_receipts",
  "vat_fact_components",
  "vouchers",
];

type ForecastPayment = Effect.Success<
  ReturnType<typeof readForecastInvoicesInTransaction>
>["payments"][number];

function readPaymentMemberships(
  transaction: Transaction,
  scope: Scope,
  observations: ReadonlyArray<typeof Cash.CashOpeningObservation.Type>,
  payments: ReadonlyArray<ForecastPayment>,
) {
  return Effect.gen(function* () {
    const memberships = new Map<
      string,
      Array<(typeof Cash.CashInvoiceContribution.Type.paymentMembership)[number]>
    >();

    for (const payment of payments) {
      const supplierSource = yield* readSettlementOpeningSourceInTransaction(
        transaction,
        scope,
        payment.receiptId,
      );

      const cashSource = supplierSource
        ? null
        : yield* findFinalCashSourceInTransaction(
            transaction,
            scope,
            payment.paymentVoucherId,
            payment.paymentLineId,
          );

      const source = supplierSource ?? cashSource;

      const sourceIdentityCurrent =
        supplierSource === null ||
        (supplierSource.invoiceId === payment.invoiceId &&
          supplierSource.voucherId === payment.paymentVoucherId &&
          supplierSource.lineId === payment.paymentLineId);

      const witness = source
        ? observations.find((entry) => entry.accountId === source.bankAccountId)
        : undefined;

      const matchingSource =
        source &&
        witness?.reconciliation.sourceRows.find(
          (row) =>
            row.statementId === source.statementId &&
            row.rowOrdinal === source.rowOrdinal &&
            row.evidenceId === source.evidenceId &&
            row.evidenceSha256 === source.sha256,
        );

      const exactMatch =
        source &&
        witness?.reconciliation.matches.some(
          (match) =>
            match.statementId === source.statementId &&
            match.rowOrdinal === source.rowOrdinal &&
            match.voucherId === source.voucherId &&
            match.lineId === source.bankLineId,
        );

      const qualified =
        sourceIdentityCurrent &&
        witness?.blockers.length === 0 &&
        matchingSource !== undefined &&
        exactMatch === true;

      const current = memberships.get(payment.invoiceId) ?? [];
      current.push({
        receiptId: payment.receiptId,
        sourceOwner: cashSource
          ? "commerce/cash-payments"
          : supplierSource
            ? "purchases/supplier-settlements"
            : null,
        sourceId: cashSource?.eventId ?? supplierSource?.id ?? null,
        ordinal: payment.ordinal,
        amountMinor: payment.amountMinor,
        statementId: source?.statementId ?? null,
        rowOrdinal: source?.rowOrdinal ?? null,
        accountId: source?.bankAccountId ?? null,
        status: qualified ? "included_in_opening" : "unqualified",
      });
      memberships.set(payment.invoiceId, current);
    }

    return memberships;
  });
}

function readSources(
  transaction: Transaction,
  scope: Scope,
  book: BankDb.BookStateRow,
  input: Input,
) {
  return Effect.gen(function* () {
    yield* requireTableAccess(transaction, sourceTables, false);

    const observations: Array<typeof Cash.CashOpeningObservation.Type> = [];

    for (const selection of input.accounts) {
      observations.push(
        yield* readCashOpeningWitnessInTransaction(transaction, scope, book, input.asOf, selection),
      );
    }

    const commerce = yield* readForecastInvoicesInTransaction(transaction, scope.bookId);

    const memberships = yield* readPaymentMemberships(
      transaction,
      scope,
      observations,
      commerce.payments,
    );

    const expectedDates = new Map(
      input.expectedDates.map((entry) => [entry.invoiceId, entry.expectedOn]),
    );

    const contributions = commerce.invoices.map((invoice) => {
      const paymentMembership = memberships.get(invoice.id) ?? [];

      const unqualifiedPayments = paymentMembership.some(
        (payment) => payment.status === "unqualified",
      );

      const excluded = invoice.outstandingMinor === "0";

      const blocked =
        invoice.outstandingMinor === null ||
        unqualifiedPayments ||
        invoice.currency !== "SEK" ||
        invoice.currencyScale !== 2;

      return {
        invoiceId: invoice.id,
        direction: invoice.direction,
        amountMinor: invoice.outstandingMinor,
        inclusion: blocked ? "blocked" : excluded ? "excluded" : "included",
        reason:
          invoice.outstandingMinor === null
            ? "canonical_residual_unknown"
            : unqualifiedPayments
              ? "payment_opening_membership_unqualified"
              : invoice.currency !== "SEK" || invoice.currencyScale !== 2
                ? "foreign_conversion_unqualified"
                : excluded
                  ? "canonical_obligation_discharged"
                  : "canonical_remaining_obligation",
        dueOn: invoice.currentRevision.dueOn,
        expectedOn: expectedDates.get(invoice.id) ?? null,
        provenance: {
          evidence: invoice.evidence,
          recognition: invoice.recognition
            ? { voucherId: invoice.recognition.voucherId, lineId: invoice.recognition.lineId }
            : null,
          revision: invoice.currentRevision.revision,
          revisionEvidence: invoice.currentRevision.evidence,
          allocationVersion: invoice.allocationVersion,
          originalMinor: invoice.amountMinor,
          allocatedMinor: invoice.recordedAllocatedMinor,
          creditedMinor: invoice.creditedMinor ?? null,
          cancelledMinor: invoice.cancelledMinor ?? null,
          status: invoice.status,
          blockers: invoice.blockers,
        },
        paymentMembership,
      } satisfies typeof Cash.CashInvoiceContribution.Type;
    });

    const identities = yield* FxDb.readForecastItemIdentities(transaction, scope.bookId);

    if (identities.length > 10000) return yield* failure("UnsupportedProfile");
    const foreignObligations: Array<(typeof Cash.CashBasis.Type.foreignObligations)[number]> = [];

    for (const identity of identities) {
      const { item } = yield* readItemState(transaction, scope, identity.id);
      foreignObligations.push({
        id: item.id,
        originalCurrency: item.original.currency,
        remainingOriginalMinor: item.remainingOriginalMinor,
        inclusion: "blocked",
        reason: "forecast_conversion_rate_and_settlement_boundary_unqualified",
        item,
      });
    }

    const blockers = observations.flatMap((entry) =>
      entry.blockers.map((reason) => `${entry.accountId}:${reason}`),
    );

    if (
      contributions.some((entry) =>
        entry.paymentMembership.some((payment) => payment.status === "unqualified"),
      )
    )
      blockers.push("invoice_payment_opening_membership_unqualified");
    let total = 0n;

    for (const observation of observations) {
      if (observation.amountMinor === null)
        blockers.push(`${observation.accountId}:closing_amount_unknown`);
      else total += BigInt(observation.amountMinor);
    }

    const opening =
      blockers.length === 0
        ? ({ status: "qualified", totalMinor: total.toString(), observations, blockers } as const)
        : ({ status: "unavailable", totalMinor: null, observations, blockers } as const);

    const sourceDigest = yield* digest(
      yield* Bank.toJsonObject({
        sequence: book.committedSequence,
        observations,
        invoices: commerce.invoices,
        payments: commerce.payments,
        foreignObligations,
      }),
    );

    return { opening, contributions, foreignObligations, sourceDigest };
  });
}

const familyGaps = [
  {
    family: "tax",
    owner: "vat/tax-account",
    status: "unknown",
    reason: "No qualified cash funding roll-forward with payment date is selected.",
  },
  {
    family: "payroll",
    owner: "payroll/calculations",
    status: "unknown",
    reason:
      "No qualified aggregate payable funding schedule is selected. Payroll details are not exposed.",
  },
  {
    family: "owners",
    owner: "subledger/owners",
    status: "unknown",
    reason: "Owner balance receipts do not establish future payment dates or unrestricted funding.",
  },
  {
    family: "assets",
    owner: "assets",
    status: "unknown",
    reason:
      "Depreciation is not cash. No qualified purchase or disposal payment schedule is selected.",
  },
  {
    family: "financing",
    owner: "subledger/owner-operations",
    status: "unknown",
    reason: "Retained loan movements do not establish a complete future financing schedule.",
  },
] satisfies Array<(typeof Cash.CashBasis.Type.coverage)[number]>;

export const captureCashBasis = Effect.fn("cash.basis.capture")(function* (
  token: string,
  command: { readonly scope: Scope; readonly idempotencyKey: string; readonly input: Input },
) {
  return yield* Bank.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTableAccess(transaction, ["cash_bases", "command_receipts"], true);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "capture_cash_basis",
          actorId: principal.actorId,
          input: yield* Bank.toJsonObject(command.input),
        },
        Cash.CashBasis,
        Effect.gen(function* () {
          yield* Bank.requireNativeBankProfile(book.profile, book.authority);
          const recordedCutoff = yield* isoNow(transaction);

          if (
            book.currency !== "SEK" ||
            book.currencyScale !== 2 ||
            command.input.asOf !== Accounting.swedishBusinessDate(new Date(recordedCutoff))
          )
            return yield* failure("UnsupportedProfile");

          if (
            new Set(command.input.accounts.map((entry) => entry.accountId)).size !==
              command.input.accounts.length ||
            new Set(command.input.expectedDates.map((entry) => entry.invoiceId)).size !==
              command.input.expectedDates.length
          )
            return yield* failure("InvalidJournal");

          const sources = yield* readSources(transaction, command.scope, book, command.input);

          for (const selection of [...command.input.accounts, ...command.input.expectedDates]) {
            const reference = yield* readEvidenceReference(
              transaction,
              command.scope.bookId,
              selection.review.evidenceId,
            );

            if (reference.sha256 !== selection.review.sha256)
              return yield* failure("StaleDependency");
          }

          const invoiceIds = new Set(sources.contributions.map((entry) => entry.invoiceId));

          if (command.input.expectedDates.some((entry) => !invoiceIds.has(entry.invoiceId)))
            return yield* failure("NotFound");

          const captured = yield* Bank.toJsonObject({
            id: newId("cash_basis"),
            scope: command.scope,
            asOf: command.input.asOf,
            recordedCutoff,
            captureMode: "current_knowledge",
            currency: "SEK",
            currencyScale: 2,
            actorId: principal.actorId,
            input: command.input,
            opening: sources.opening,
            contributions: sources.contributions,
            foreignObligations: sources.foreignObligations,
            coverage: [
              {
                family: "bank",
                owner: "banking/reconciliations+coverage",
                status: sources.opening.status === "qualified" ? "selected_scope" : "unavailable",
                reason:
                  "Selected current statement closings only. Native full-period coverage remains not_established and observation time is unavailable.",
              },
              {
                family: "commerce",
                owner: "commerce/register+fx",
                status:
                  sources.contributions.some((entry) => entry.inclusion === "blocked") ||
                  sources.foreignObligations.length > 0
                    ? "incomplete"
                    : "selected_scope",
                reason:
                  "Current canonical registered invoices only. Unregistered obligations and foreign forecast conversions remain unqualified.",
              },
              ...familyGaps,
            ],
            companyCoverage: "incomplete",
            label: "known_items",
            dependencyDigest: sources.sourceDigest,
          });

          const body = yield* Bank.toJsonObject({ ...captured, digest: yield* digest(captured) });
          const basis = yield* Bank.decode(Cash.CashBasis, body);
          const content = yield* Bank.canonicalText(body);
          const byteLength = Bank.byteLength(content);

          if (byteLength > 8388608) return yield* failure("UnsupportedProfile");
          yield* BasisDb.insertBasis(transaction, command.scope.bookId, basis.id, {
            body,
            content,
            sha256: yield* sha256Hex(content),
            byteLength,
          });

          return { receipt: body, result: basis };
        }),
      );
    }),
  );
});

export function readCashBasisInTransaction(
  transaction: Transaction,
  scope: Scope,
  book: BankDb.BookStateRow,
  id: string,
) {
  return Effect.gen(function* () {
    yield* requireTableAccess(transaction, ["cash_bases"], false);

    const saved = (yield* BasisDb.readBasis(transaction, scope.bookId, id))[0];

    if (!saved) return yield* failure("NotFound");
    const basis = yield* Bank.decode(Cash.CashBasis, saved.body);

    const dependency = yield* readSources(transaction, scope, book, basis.input).pipe(
      Effect.map(
        (sources) =>
          ({
            status: sources.sourceDigest === basis.dependencyDigest ? "current" : "changed",
            reason: null,
          }) as const,
      ),
      Effect.catchTag("AccountingError", (error) =>
        error.code === "UnsupportedProfile" || error.code === "StaleDependency"
          ? Effect.succeed({ status: "unavailable", reason: error.code } as const)
          : Effect.fail(error),
      ),
    );

    return {
      basis,
      dependenciesCurrent: dependency.status === "current",
      dependencyStatus: dependency.status,
      dependencyReason: dependency.reason,
      artifact: {
        content: saved.content,
        sha256: saved.sha256,
        byteLength: saved.byteLength,
        mediaType: "application/json",
      },
    } satisfies typeof Cash.CashBasisView.Type;
  });
}

export const getCashBasis = Effect.fn("cash.basis.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* Bank.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      return yield* readCashBasisInTransaction(transaction, command.scope, book, command.id);
    }),
  );
});

export const listCashBases = Effect.fn("cash.basis.list")(function* (
  token: string,
  command: { readonly scope: Scope; readonly after?: string },
) {
  return yield* Bank.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* requireTableAccess(transaction, ["cash_bases"], false);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      const after = command.after ?? "";

      if (after !== "" && !Schema.is(Accounting.Identifier)(after))
        return yield* failure("InvalidJournal");

      if (
        after !== "" &&
        (yield* BasisDb.readBasis(transaction, command.scope.bookId, after)).length === 0
      )
        return yield* failure("NotFound");

      const rows = yield* BasisDb.listBases(transaction, command.scope.bookId, after);

      const items = yield* Effect.forEach(rows.slice(0, 50), (row) =>
        Bank.decode(Cash.CashBasisSummary, row.body),
      );

      const total = (yield* BasisDb.countBases(transaction, command.scope.bookId))[0]!.total;

      return yield* Bank.decode(Cash.CashBasisPage, {
        items,
        next: rows.length > 50 ? items.at(-1)!.id : null,
        total,
      });
    }),
  );
});

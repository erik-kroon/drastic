import { equalJson } from "@open-erp/domain/canonicalization";
import { retainedArticle } from "./catalog";
import { copiedDefaults, resolveCustomerDefaults } from "./customer-invoice-defaults";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Policy from "@open-erp/contracts/legal-sales-policy";
import { commercialLineAmounts, exactCommercialBase } from "@open-erp/domain/commercial-invoice";
import * as Policies from "../../db/commerce/legal-policies";
import { digest } from "../json";
import { customerDefaultsTables } from "../../db/commerce/customer-invoice-defaults";
import * as CatalogDb from "../../db/commerce/catalog";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import {
  exactKeys,
  readEvidenceReference,
  textField,
  toJsonObject,
  decode,
  requireRetainedEvidence,
  requireTableAccess,
  type JsonObject,
  type Scope,
} from "./support";

type DraftContent = typeof Drafts.DraftContent.Type;

type DraftLine = typeof Drafts.DraftLine.Type;

type DraftIdentity = typeof Drafts.DraftIdentity.Type;

const maximumMinor = 10n ** 38n;

const draftBound = 200;

const revisionBound = 50;

const inputBytes = 65536;

const retainedBytes = 131072;

const initialReason = "Initial commercial draft";

const calculationBasis = "explicit_line_amounts_v1";

const contentFields = [
  "counterpartyId",
  "counterpartyRevision",
  "currency",
  "currencyScale",
  "customer",
  "dueDate",
  "lines",
  "paymentTerms",
  "plannedIssueDate",
  "seller",
  "sourceTotalMinor",
  "supplyDate",
  "title",
] as const;

const lineFields = [
  "baseMinor",
  "chargeMinor",
  "description",
  "discountMinor",
  "id",
  "quantity",
  "sourceGrossMinor",
  "taxDescription",
  "taxEvidenceId",
  "taxMinor",
  "unitPriceMinor",
] as const;

const identityFields = [
  "address",
  "countryCode",
  "evidenceId",
  "legalName",
  "registrationId",
  "taxId",
] as const;

const selectionFields = ["code", "revision", "unit"] as const;

const standingBlockers: ReadonlyArray<{ readonly code: string; readonly lineId: null }> = [
  { code: "issuance_not_implemented", lineId: null },
  { code: "legal_identity_not_verified", lineId: null },
  { code: "tax_profile_not_activated", lineId: null },
];

type Blocker = { readonly code: string; readonly lineId: string | null };

function blocker(code: string, lineId: string | null): Blocker {
  return { code, lineId };
}

function optionalMinor(value: string | null) {
  return value === null ? null : BigInt(value);
}

function exactLineBase(quantity: string, unitPriceMinor: string | null) {
  if (unitPriceMinor === null) return null;

  return exactCommercialBase(quantity, unitPriceMinor);
}

function identityBlockers(identity: DraftIdentity, role: string) {
  return identity.registrationId === null ||
    identity.address === null ||
    identity.countryCode === null
    ? [blocker(`${role}_identity_fields_missing`, null)]
    : [];
}

function requireCatalogAgreement(
  transaction: Transaction,
  scope: Scope,
  line: DraftLine,
  commercial = false,
) {
  const selection = line.catalogSelection;

  if (selection === undefined) return Effect.void;

  return Effect.gen(function* () {
    const article = (yield* CatalogDb.readArticleRevision(
      transaction,
      scope.bookId,
      selection.code,
      String(selection.revision),
    ))[0];

    if (!article) return yield* failure("StaleDependency");
    const body = article.body;

    if (
      selection.scope !== undefined &&
      (selection.scope.bookId !== scope.bookId || selection.scope.entityId !== scope.entityId)
    )
      return yield* failure("StaleDependency");

    if (
      selection.digest !== undefined &&
      selection.digest !== (yield* retainedArticle(scope, body)).digest
    )
      return yield* failure("StaleDependency");

    if (
      textField(body, "unit") !== selection.unit ||
      textField(body, "description") !== line.description ||
      (textField(body, "unitPriceMinor") ?? null) !== line.unitPriceMinor ||
      (!commercial && (textField(body, "taxDescription") ?? null) !== line.taxDescription)
    ) {
      return yield* failure("StaleDependency");
    }
  });
}

function lineEvidence(transaction: Transaction, bookId: string, line: DraftLine) {
  if (line.taxEvidenceId === null) return Effect.succeed<JsonObject | null>(null);

  return readEvidenceReference(transaction, bookId, line.taxEvidenceId);
}

function calculateLine(
  transaction: Transaction,
  scope: Scope,
  line: DraftLine,
  blockers: Blocker[],
  commercial: boolean,
) {
  return Effect.gen(function* () {
    yield* exactKeys(
      yield* toJsonObject(line),
      line.catalogSelection === undefined ? lineFields : [...lineFields, "catalogSelection"],
    );

    if (line.catalogSelection !== undefined) {
      yield* exactKeys(yield* toJsonObject(line.catalogSelection), [
        ...selectionFields,
        ...(line.catalogSelection.scope === undefined ? [] : ["scope"]),
        ...(line.catalogSelection.digest === undefined ? [] : ["digest"]),
      ]);
      yield* requireCatalogAgreement(transaction, scope, line, commercial);
    }

    const taxEvidence = yield* lineEvidence(transaction, scope.bookId, line);

    if (line.taxMinor === null || taxEvidence === null || line.taxDescription === null) {
      blockers.push(blocker("tax_inputs_unreviewed", line.id));
    }

    const base = BigInt(line.baseMinor);
    const discount = BigInt(line.discountMinor);
    const charge = BigInt(line.chargeMinor);

    if (discount > base) return yield* failure("InvalidJournal");
    const net = base - discount + charge;
    const tax = optionalMinor(line.taxMinor);
    const gross = tax === null ? null : net + tax;

    if (net >= maximumMinor || (gross !== null && gross >= maximumMinor)) {
      return yield* failure("InvalidJournal");
    }

    const calculatedBase = exactLineBase(line.quantity, line.unitPriceMinor);

    if (calculatedBase === null) {
      blockers.push(blocker("quantity_price_not_exact", line.id));
    } else if (calculatedBase !== base) {
      blockers.push(blocker("line_base_mismatch", line.id));
    }

    const source = optionalMinor(line.sourceGrossMinor);
    const sourceGrossMatches = gross === null || source === null ? null : gross === source;

    if (sourceGrossMatches === false) blockers.push(blocker("line_total_mismatch", line.id));

    return { taxEvidence, net, gross, tax, calculatedBase, sourceGrossMatches };
  });
}

/**
 * The application-owned draft calculation on explicit line amounts. It derives no
 * tax, numbers no document and posts nothing; unresolved inputs become blockers
 * instead of silent defaults.
 */
export function calculateDraft(
  transaction: Transaction,
  scope: Scope,
  book: DraftDb.BookCurrencyRow,
  content: DraftContent,
  commercial = false,
) {
  return Effect.gen(function* () {
    yield* exactKeys(
      yield* toJsonObject(content),
      content.note === undefined ? contentFields : [...contentFields, "note"],
    );
    yield* exactKeys(yield* toJsonObject(content.seller), identityFields);
    yield* exactKeys(yield* toJsonObject(content.customer), identityFields);

    if (content.currency !== book.currency || content.currencyScale !== book.currencyScale) {
      return yield* failure("InvalidJournal");
    }

    const sellerEvidence = yield* readEvidenceReference(
      transaction,
      scope.bookId,
      content.seller.evidenceId,
    );

    const customerEvidence = yield* readEvidenceReference(
      transaction,
      scope.bookId,
      content.customer.evidenceId,
    );

    const blockers: Blocker[] = [...standingBlockers];
    blockers.push(...identityBlockers(content.seller, "seller"));
    blockers.push(...identityBlockers(content.customer, "customer"));

    const counterparty = (yield* DraftDb.readCustomerCounterparty(
      transaction,
      scope.bookId,
      content.counterpartyId,
    ))[0];

    if (!counterparty || (counterparty.role !== "customer" && counterparty.role !== "both")) {
      return yield* failure("InvalidJournal");
    }

    if (counterparty.currentRevision !== content.counterpartyRevision) {
      return yield* failure("StaleDependency");
    }

    if (
      content.dueDate !== null &&
      content.plannedIssueDate !== null &&
      content.dueDate < content.plannedIssueDate
    ) {
      return yield* failure("InvalidJournal");
    }

    if (
      content.plannedIssueDate === null ||
      content.dueDate === null ||
      content.supplyDate === null ||
      content.paymentTerms === null
    ) {
      blockers.push(blocker("dates_or_terms_missing", null));
    }

    const sourceTotal = optionalMinor(content.sourceTotalMinor);
    const seen = new Set<string>();
    const calculatedLines: Array<JsonObject> = [];
    let baseTotal = 0n;
    let discountTotal = 0n;
    let chargeTotal = 0n;
    let netTotal = 0n;
    let taxTotal = 0n;
    let taxKnown = true;

    for (const line of content.lines) {
      if (seen.has(line.id)) return yield* failure("InvalidJournal");
      seen.add(line.id);

      const calculated = yield* calculateLine(transaction, scope, line, blockers, commercial);

      baseTotal += BigInt(line.baseMinor);
      discountTotal += BigInt(line.discountMinor);
      chargeTotal += BigInt(line.chargeMinor);
      netTotal += calculated.net;

      if (calculated.tax === null) taxKnown = false;
      else taxTotal += calculated.tax;
      calculatedLines.push({
        id: line.id,
        calculatedBaseMinor: calculated.calculatedBase?.toString() ?? null,
        netMinor: calculated.net.toString(),
        grossMinor: calculated.gross?.toString() ?? null,
        sourceGrossMatches: calculated.sourceGrossMatches,
        taxEvidence: calculated.taxEvidence,
      });
    }

    const grossTotal = taxKnown ? netTotal + taxTotal : null;

    const sourceTotalMatches =
      grossTotal === null || sourceTotal === null ? null : grossTotal === sourceTotal;

    if (sourceTotalMatches === false) blockers.push(blocker("document_total_mismatch", null));

    return {
      content,
      counterparty: counterparty.revision,
      sellerEvidence,
      customerEvidence,
      totals: {
        baseMinor: baseTotal.toString(),
        discountMinor: discountTotal.toString(),
        chargeMinor: chargeTotal.toString(),
        netMinor: netTotal.toString(),
        taxMinor: taxKnown ? taxTotal.toString() : null,
        grossMinor: grossTotal?.toString() ?? null,
        sourceTotalMatches,
      } satisfies JsonObject,
      calculatedLines,
      blockers,
      calculationBasis,
    };
  });
}

export const draftBounds = {
  inventory: draftBound,
  revisions: revisionBound,
  inputBytes,
  retainedBytes,
  initialReason,
} as const;

const resolveCommercialArticlePrice = Effect.fn("commerce.drafts.resolveCommercialArticlePrice")(
  function* (
    transaction: Transaction,
    scope: Scope,
    line: typeof Drafts.CommercialLine.Type,
    prior: typeof Drafts.InvoiceDraftRevision.Type | undefined,
  ) {
    const selection = line.catalogSelection;

    if (selection === undefined) return line.unitPriceMinor;

    const previous =
      prior?.purpose === "commercial"
        ? prior.commercialInput.lines.find((item) => item.id === line.id)?.catalogSelection
        : undefined;

    const copied = previous !== undefined && equalJson(previous, selection);

    const row = (yield* CatalogDb.readArticleRevision(
      transaction,
      scope.bookId,
      selection.code,
      String(selection.revision),
    ))[0];

    if (!row) return yield* failure("StaleDependency");
    const article = yield* retainedArticle(scope, row.body);

    if (article.unitPriceMinor !== line.unitPriceMinor) return yield* failure("StaleDependency");

    if (
      selection.scope !== undefined &&
      (selection.scope.bookId !== scope.bookId || selection.scope.entityId !== scope.entityId)
    )
      return yield* failure("StaleDependency");

    if (
      (!copied && (selection.scope === undefined || selection.digest === undefined)) ||
      (selection.digest !== undefined && selection.digest !== article.digest)
    )
      return yield* failure("StaleDependency");

    if (!copied) {
      const pointer = (yield* CatalogDb.readArticlePointer(
        transaction,
        scope.bookId,
        selection.code,
        "share",
      ))[0];

      if (pointer?.currentRevision !== String(selection.revision) || article.status === "archived")
        return yield* failure("StaleDependency");
    }

    if (row.body.treatment !== undefined || !copied) {
      if (!equalJson(article.treatment ?? { kind: "unresolved" }, line.treatment))
        return yield* failure("StaleDependency");
    }

    return article.unitPriceMinor;
  },
);

const resolveCopiedDraftDefaults = Effect.fn("commerce.drafts.resolveCopiedDefaults")(function* (
  transaction: Transaction,
  scope: Scope,
  book: DraftDb.BookCurrencyRow,
  input: typeof Drafts.CommercialContent.Type,
  prior: typeof Drafts.InvoiceDraftRevision.Type | undefined,
) {
  const selection = input.customerDefaultsSelection;

  if (selection !== undefined && selection.partyId !== input.counterpartyId)
    return yield* failure("StaleDependency");

  if (
    selection !== undefined &&
    (input.plannedIssueDate === null || input.dueDateOrigin === undefined)
  )
    return yield* failure("InvalidJournal");

  if (selection === undefined && input.dueDateOrigin === "customer_default")
    return yield* failure("InvalidJournal");

  const priorSelection =
    prior?.purpose === "commercial" ? prior.commercialInput.customerDefaultsSelection : undefined;

  const copied =
    priorSelection !== undefined && selection !== undefined && equalJson(priorSelection, selection);

  if (selection !== undefined)
    yield* requireTableAccess(transaction, customerDefaultsTables, false);

  const defaults =
    selection === undefined
      ? undefined
      : yield* resolveCustomerDefaults(transaction, scope, selection, !copied);

  if (defaults !== undefined && defaults.currency !== book.currency)
    return yield* failure("UnsupportedProfile");

  return defaults === undefined || input.plannedIssueDate === null
    ? undefined
    : yield* copiedDefaults(defaults, input.plannedIssueDate);
});

export const calculateCommercialContent = Effect.fn("commerce.drafts.calculateCommercialContent")(
  function* (
    transaction: Transaction,
    scope: Scope,
    book: DraftDb.BookCurrencyRow,
    input: typeof Drafts.CommercialContent.Type,
    prior?: typeof Drafts.InvoiceDraftRevision.Type,
  ) {
    const snapshot = yield* resolveCopiedDraftDefaults(transaction, scope, book, input, prior);
    const lines: DraftLine[] = [];
    const seen = new Set<string>();

    for (const line of input.lines) {
      if (seen.has(line.id)) return yield* failure("InvalidJournal");
      seen.add(line.id);
      const unitPriceMinor = yield* resolveCommercialArticlePrice(transaction, scope, line, prior);
      let taxEvidenceId: string | null = null;
      let taxDescription: string | null = null;

      if (line.treatment.kind === "legal_sales_policy") {
        const row = (yield* Policies.readPolicy(transaction, scope.bookId, line.treatment.id))[0];

        if (!row) return yield* failure("StaleDependency");
        const policy = yield* decode(Policy.LegalSalesPolicy, row.body);

        if (policy.digest !== line.treatment.digest) return yield* failure("StaleDependency");

        if (
          book.currency !== "SEK" ||
          book.currencyScale !== 2 ||
          policy.status !== "active" ||
          policy.input.ruleVersion !== "se-domestic-standard-25-2023-200-v1" ||
          policy.candidate.input.vatTreatment !== "se-domestic-standard-25-v1" ||
          policy.candidate.input.roundingMethod !== "line-tax-half-up-minor-v1"
        )
          return yield* failure("UnsupportedProfile");
        yield* requireRetainedEvidence(
          transaction,
          scope.bookId,
          policy.candidate.input.vatEvidence,
        );
        taxEvidenceId = policy.candidate.input.vatEvidence.evidenceId;
        taxDescription = policy.candidate.input.vatTreatment;
      }

      const amounts = commercialLineAmounts({
        quantity: line.quantity,
        unitPriceMinor,
        discountMinor: line.discountMinor,
        chargeMinor: line.chargeMinor,
        taxRule: taxDescription === null ? "unresolved" : "line-tax-half-up-minor-25-v1",
      });

      if (Result.isFailure(amounts)) return yield* failure("InvalidJournal");

      const expanded: DraftLine = {
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor,
        baseMinor: amounts.success.base.toString(),
        discountMinor: line.discountMinor,
        chargeMinor: line.chargeMinor,
        taxMinor: amounts.success.tax?.toString() ?? null,
        taxDescription,
        taxEvidenceId,
        sourceGrossMinor: null,
      };

      lines.push(
        line.catalogSelection === undefined
          ? expanded
          : { ...expanded, catalogSelection: line.catalogSelection },
      );
    }

    const content: DraftContent = {
      title: input.title,
      counterpartyId: input.counterpartyId,
      counterpartyRevision: input.counterpartyRevision,
      seller: input.seller,
      customer: input.customer,
      plannedIssueDate: input.plannedIssueDate,
      supplyDate: input.supplyDate,
      dueDate:
        snapshot !== undefined && input.dueDateOrigin === "customer_default"
          ? snapshot.dueDate
          : input.dueDate,
      paymentTerms: input.paymentTerms ?? snapshot?.paymentTerms ?? null,
      ...(input.note === undefined ? {} : { note: input.note }),
      currency: book.currency,
      currencyScale: book.currencyScale,
      sourceTotalMinor: null,
      lines,
    };

    const calculation = yield* calculateDraft(transaction, scope, book, content, true);

    if (
      BigInt(calculation.totals.netMinor) >= maximumMinor ||
      (calculation.totals.grossMinor !== null &&
        BigInt(calculation.totals.grossMinor) >= maximumMinor)
    )
      return yield* failure("InvalidJournal");
    const inputDigest = yield* digest(yield* toJsonObject(input));

    return {
      ...calculation,
      content,
      calculationBasis: "commercial_minor_v1",
      blockers: [
        ...calculation.blockers.filter(
          (item) => !standingBlockers.some((standing) => standing.code === item.code),
        ),
        blocker("legal_issue_review_required", null),
      ],
      commercial: {
        input,
        digest: inputDigest,
        copiedCustomerDefaults: snapshot,
      },
      copiedCustomerDefaults: snapshot,
      inputDigest,
    };
  },
);

export const recalculateInvoiceDraft = Effect.fn("commerce.drafts.recalculate")(function* (
  transaction: Transaction,
  scope: Scope,
  book: DraftDb.BookCurrencyRow,
  draft: typeof Drafts.InvoiceDraftRevision.Type,
) {
  return draft.purpose === "commercial"
    ? yield* calculateCommercialContent(transaction, scope, book, draft.commercialInput, draft)
    : yield* calculateDraft(transaction, scope, book, draft.content);
});

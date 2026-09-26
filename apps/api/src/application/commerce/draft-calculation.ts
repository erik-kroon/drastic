import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Effect from "effect/Effect";
import * as CatalogDb from "../../db/commerce/catalog";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import {
  exactKeys,
  readEvidenceReference,
  textField,
  toJsonObject,
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

/** Quantity is an exact canonical decimal; minor units are integers. */
function exactLineBase(quantity: string, unitPriceMinor: string | null) {
  if (unitPriceMinor === null) return null;
  const [whole = "0", fraction = ""] = quantity.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const product = BigInt(whole + fraction) * BigInt(unitPriceMinor);

  return product % scale === 0n ? product / scale : null;
}

function identityBlockers(identity: DraftIdentity, role: string) {
  return identity.registrationId === null ||
    identity.address === null ||
    identity.countryCode === null
    ? [blocker(`${role}_identity_fields_missing`, null)]
    : [];
}

function requireCatalogAgreement(transaction: Transaction, bookId: string, line: DraftLine) {
  const selection = line.catalogSelection;

  if (selection === undefined) return Effect.void;

  return Effect.gen(function* () {
    const article = (yield* CatalogDb.readArticleRevision(
      transaction,
      bookId,
      selection.code,
      String(selection.revision),
    ))[0];

    if (!article) return yield* failure("StaleDependency");
    const body = article.body;

    if (
      textField(body, "unit") !== selection.unit ||
      textField(body, "description") !== line.description ||
      (textField(body, "unitPriceMinor") ?? null) !== line.unitPriceMinor ||
      (textField(body, "taxDescription") ?? null) !== line.taxDescription
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
  bookId: string,
  line: DraftLine,
  blockers: Blocker[],
) {
  return Effect.gen(function* () {
    yield* exactKeys(
      yield* toJsonObject(line),
      line.catalogSelection === undefined ? lineFields : [...lineFields, "catalogSelection"],
    );

    if (line.catalogSelection !== undefined) {
      yield* exactKeys(yield* toJsonObject(line.catalogSelection), selectionFields);
      yield* requireCatalogAgreement(transaction, bookId, line);
    }

    const taxEvidence = yield* lineEvidence(transaction, bookId, line);

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
) {
  return Effect.gen(function* () {
    yield* exactKeys(yield* toJsonObject(content), contentFields);
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
      const calculated = yield* calculateLine(transaction, scope.bookId, line, blockers);
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

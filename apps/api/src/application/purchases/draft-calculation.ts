import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import type { Transaction } from "../../db/transaction";
import * as DraftDb from "../../db/purchases/drafts";
import * as Shared from "./shared";

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

export type DraftContent =
  typeof import("@open-erp/contracts/supplier-invoice-drafts").SupplierDraftContent.Type;

type Blocker = { readonly code: string; readonly lineId: string | null };

type CalculatedLine = {
  readonly id: string;
  readonly calculatedBaseMinor: string | null;
  readonly netMinor: string;
  readonly grossMinor: string;
  readonly sourceGrossMatches: boolean | null;
  readonly taxEvidence: JsonObject | null;
};

const contentKeys = [
  "title",
  "counterpartyId",
  "counterpartyRevision",
  "supplier",
  "buyer",
  "currency",
  "currencyScale",
  "documentDate",
  "supplyDate",
  "dueDate",
  "paymentTerms",
  "sourceTotalMinor",
  "lines",
  "sourceEvidenceId",
  "supplierDocumentNumber",
] as const;

const lineKeys = [
  "id",
  "description",
  "quantity",
  "unitPriceMinor",
  "baseMinor",
  "discountMinor",
  "chargeMinor",
  "taxMinor",
  "taxDescription",
  "taxEvidenceId",
  "sourceGrossMinor",
] as const;

const identityKeys = [
  "legalName",
  "registrationId",
  "taxId",
  "address",
  "countryCode",
  "evidenceId",
] as const;

const minorCeiling = 10n ** 38n;

function text(value: JsonObject, key: string, max: number) {
  const candidate = value[key];

  if (typeof candidate !== "string") return yieldInvalid();

  if (candidate !== candidate.trim() || candidate.length < 1 || candidate.length > max) {
    return yieldInvalid();
  }

  return candidate;
}

function yieldInvalid(): never {
  throw failure("InvalidJournal");
}

function optionalText(value: JsonObject, key: string, max: number) {
  if (value[key] === null) return null;

  return text(value, key, max);
}

function minor(value: JsonObject, key: string, nullable = false) {
  if (nullable && value[key] === null) return null;
  const candidate = value[key];

  if (typeof candidate !== "string" || !Shared.minorPattern.test(candidate)) {
    return yieldInvalid();
  }

  return BigInt(candidate);
}

function calendarDate(value: JsonObject, key: string) {
  const candidate = value[key];

  if (candidate === null) return null;

  if (typeof candidate !== "string" || !Shared.datePattern.test(candidate)) {
    return yieldInvalid();
  }

  const parsed = new Date(`${candidate}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    return yieldInvalid();
  }

  return candidate;
}

function exactKeys(value: Json, keys: ReadonlyArray<string>) {
  if (!Shared.isJsonObject(value)) return yieldInvalid();
  const present = Object.keys(value).sort();
  const expected = [...keys].sort();

  if (present.length !== expected.length || present.some((key, index) => key !== expected[index])) {
    return yieldInvalid();
  }

  return value;
}

function blocker(code: string, lineId: string | null): Blocker {
  return { code, lineId };
}

function identityEvidence(transaction: Transaction, bookId: string, identity: Json) {
  return Effect.gen(function* () {
    const value = exactKeys(identity, identityKeys);
    text(value, "legalName", 200);
    optionalText(value, "registrationId", 200);
    optionalText(value, "taxId", 200);
    optionalText(value, "address", 1000);
    const country = optionalText(value, "countryCode", 2);

    if (country !== null && !/^[A-Z]{2}$/.test(country)) return yieldInvalid();
    const evidenceId = text(value, "evidenceId", 128);

    return yield* Shared.readEvidenceReference(transaction, bookId, evidenceId);
  });
}

function identityBlockers(value: JsonObject, blockers: Blocker[]) {
  for (const key of ["supplier", "buyer"] as const) {
    const identity = Shared.objectField(value, key);

    if (
      identity.registrationId === null ||
      identity.address === null ||
      identity.countryCode === null
    ) {
      blockers.push(
        blocker(
          key === "supplier" ? "supplier_identity_fields_missing" : "buyer_identity_fields_missing",
          null,
        ),
      );
    }
  }
}

export const calculateSupplierDraft = Effect.fn("purchases.draft.calculate")(function* (
  transaction: Transaction,
  bookId: string,
  book: { currency: string; currencyScale: number },
  content: Json,
) {
  return yield* Effect.gen(function* () {
    const value = exactKeys(content, contentKeys);
    text(value, "title", 200);

    if (value.currency !== book.currency || value.currencyScale !== book.currencyScale) {
      return yieldInvalid();
    }

    const supplierEvidence = yield* identityEvidence(transaction, bookId, value.supplier ?? null);
    const buyerEvidence = yield* identityEvidence(transaction, bookId, value.buyer ?? null);

    const blockers: Blocker[] = [
      blocker("acceptance_not_implemented", null),
      blocker("legal_identity_not_verified", null),
      blocker("tax_profile_not_activated", null),
    ];

    identityBlockers(value, blockers);

    const counterpartyId = text(value, "counterpartyId", 128);
    const party = (yield* DraftDb.readCounterparty(transaction, bookId, counterpartyId))[0];

    if (!party || (party.role !== "supplier" && party.role !== "both")) {
      return yieldInvalid();
    }

    if (text(value, "counterpartyRevision", 18) !== party.currentRevision) {
      return yield* failure("StaleDependency");
    }

    const counterparty = party.body;

    if (counterparty === null) return yield* failure("InternalError");

    const documentDate = calendarDate(value, "documentDate");
    const supplyDate = calendarDate(value, "supplyDate");
    const dueDate = calendarDate(value, "dueDate");

    if (documentDate !== null && dueDate !== null && dueDate < documentDate) {
      return yieldInvalid();
    }

    optionalText(value, "paymentTerms", 1000);

    if (
      documentDate === null ||
      dueDate === null ||
      supplyDate === null ||
      value.paymentTerms === null
    ) {
      blockers.push(blocker("dates_or_terms_missing", null));
    }

    const sourceTotal = minor(value, "sourceTotalMinor", true);
    const lines = value.lines;

    if (!Array.isArray(lines)) return yieldInvalid();

    if (lines.length < 1 || lines.length > 50) return yieldInvalid();

    const accumulated = yield* calculateLines(transaction, bookId, lines, blockers);

    const totals = accumulated;
    const netTotal = totals.netTotal;
    const effectiveTaxTotal = totals.effectiveTaxTotal;
    const grossTotal = effectiveTaxTotal === null ? null : netTotal + effectiveTaxTotal;

    const totalMatch =
      grossTotal === null || sourceTotal === null ? null : grossTotal === sourceTotal;

    if (totalMatch === false) blockers.push(blocker("document_total_mismatch", null));

    const sourceEvidenceId = text(value, "sourceEvidenceId", 128);

    const sourceEvidence = yield* Shared.readEvidenceReference(
      transaction,
      bookId,
      sourceEvidenceId,
    );

    const documentNumber = optionalText(value, "supplierDocumentNumber", 128);
    blockers.push(blocker("recognition_not_implemented", null));

    if (documentNumber === null) blockers.push(blocker("supplier_document_number_missing", null));

    return Object.assign(
      {},
      {
        counterparty,
        supplierEvidence,
        buyerEvidence,
        sourceEvidence,
        totals: {
          baseMinor: totals.baseTotal.toString(),
          discountMinor: totals.discountTotal.toString(),
          chargeMinor: totals.chargeTotal.toString(),
          netMinor: netTotal.toString(),
          taxMinor: effectiveTaxTotal === null ? "" : effectiveTaxTotal.toString(),
          grossMinor: grossTotal === null ? "" : grossTotal.toString(),
          sourceTotalMatches: totalMatch,
        },
        calculatedLines: totals.calculated,
        blockers,
      },
    ) satisfies JsonObject;
  });
});

type LineTotals = {
  readonly calculated: ReadonlyArray<CalculatedLine>;
  readonly baseTotal: bigint;
  readonly discountTotal: bigint;
  readonly chargeTotal: bigint;
  readonly netTotal: bigint;
  readonly effectiveTaxTotal: bigint | null;
};

function calculateLines(
  transaction: Transaction,
  bookId: string,
  lines: ReadonlyArray<Json>,
  blockers: Blocker[],
) {
  return Effect.gen(function* () {
    const seen = new Set<string>();
    const calculated: CalculatedLine[] = [];
    let baseTotal = 0n;
    let discountTotal = 0n;
    let chargeTotal = 0n;
    let netTotal = 0n;
    let taxTotal = 0n;
    let taxKnown = true;

    for (const entry of lines) {
      const line = exactKeys(entry, lineKeys);
      const lineId = text(line, "id", 128);

      if (!Shared.lineIdPattern.test(lineId) || seen.has(lineId)) return yieldInvalid();
      seen.add(lineId);
      text(line, "description", 200);
      const quantity = line.quantity;

      if (typeof quantity !== "string" || !Shared.quantityPattern.test(quantity)) {
        return yieldInvalid();
      }

      const base = requireMinor(minor(line, "baseMinor"));
      const discount = requireMinor(minor(line, "discountMinor"));
      const charge = requireMinor(minor(line, "chargeMinor"));
      const tax = minor(line, "taxMinor", true);
      const source = minor(line, "sourceGrossMinor", true);
      optionalText(line, "taxDescription", 200);

      const taxEvidence =
        line.taxEvidenceId === null
          ? null
          : yield* Shared.readEvidenceReference(
              transaction,
              bookId,
              text(line, "taxEvidenceId", 128),
            );

      if (tax === null || taxEvidence === null || line.taxDescription === null) {
        blockers.push(blocker("tax_inputs_unreviewed", lineId));
      }

      if (discount > base) return yieldInvalid();
      const net = base - discount + charge;
      const gross = tax === null ? null : net + tax;

      if (gross !== null && gross >= minorCeiling) return yieldInvalid();
      const product = exactProduct(quantity, minor(line, "unitPriceMinor", true));

      if (product === null) {
        blockers.push(blocker("quantity_price_not_exact", lineId));
      } else if (product !== base) {
        blockers.push(blocker("line_base_mismatch", lineId));
      }

      const lineMatch = gross === null || source === null ? null : gross === source;

      if (lineMatch === false) blockers.push(blocker("line_total_mismatch", lineId));
      calculated.push({
        id: lineId,
        calculatedBaseMinor: product === null ? null : product.toString(),
        netMinor: net.toString(),
        grossMinor: gross === null ? "" : gross.toString(),
        sourceGrossMatches: lineMatch,
        taxEvidence,
      });
      baseTotal += base;
      discountTotal += discount;
      chargeTotal += charge;
      netTotal += net;

      if (tax === null) taxKnown = false;
      else taxTotal += tax;
    }

    return {
      calculated,
      baseTotal,
      discountTotal,
      chargeTotal,
      netTotal,
      effectiveTaxTotal: taxKnown ? taxTotal : null,
    } satisfies LineTotals;
  });
}

function requireMinor(value: bigint | null) {
  return value === null ? yieldInvalid() : value;
}

function exactProduct(quantity: string, price: bigint | null) {
  if (price === null) return null;
  const parts = quantity.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(whole) * scale + (fraction === "" ? 0n : BigInt(fraction));
  const product = scaled * price;

  if (product % scale !== 0n) return null;

  return product / scale;
}

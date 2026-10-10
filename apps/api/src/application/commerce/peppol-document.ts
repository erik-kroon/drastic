import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Contracts from "@open-erp/contracts/peppol-exchange";
import * as Domain from "@open-erp/domain/peppol-exchange";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as ArDb from "../../db/commerce/ar-legal";
import * as CreditsDb from "../../db/commerce/credit-notes";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "./support";
import { failure } from "../failures";
import { digest } from "../json";

type Party = {
  readonly legalName: string;
  readonly registrationId: string | null;
  readonly taxId: string | null;
  readonly address: string | null;
  readonly countryCode: string | null;
};

export type PeppolDocument = {
  readonly reference: typeof Contracts.DocumentReference.Type;
  readonly digest: string;
  readonly legalNumber: string;
  readonly documentType: "Invoice" | "CreditNote";
  readonly issuedOn: string;
  readonly dueOn: string | null;
  readonly paymentTerms: string | null;
  readonly buyerReference: string | null;
  readonly orderReference: string | null;
  readonly seller: Party;
  readonly buyer: Party;
  readonly counterpartyId: string;
  readonly currency: string;
  readonly scale: number;
  readonly lines: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly quantity: string;
    readonly unitPriceMinor: string;
    readonly netMinor: string;
    readonly taxMinor: string;
    readonly vatTreatment: string;
  }>;
  readonly netMinor: string;
  readonly taxMinor: string;
  readonly grossMinor: string;
  readonly originalNumber: string | null;
  readonly originalIssuedOn: string | null;
};

export function readPeppolDocument(
  tx: Transaction,
  scope: Scope,
  reference: typeof Contracts.DocumentReference.Type,
) {
  return Effect.gen(function* () {
    if (reference.kind === "invoice") {
      const row = (yield* ArDb.readArLegalIssueById(tx, scope.bookId, reference.id))[0];

      if (!row) return yield* failure("NotFound");
      const issue = yield* decode(Ar.ArLegalIssueReceipt, row.body);

      if (issue.scope.entityId !== scope.entityId || issue.scope.bookId !== scope.bookId)
        return yield* failure("Forbidden");

      if (
        issue.lines.some(
          (line) =>
            line.discountMinor !== "0" ||
            line.chargeMinor !== "0" ||
            line.unitPriceMinor !== line.netMinor,
        )
      )
        return yield* failure("UnsupportedProfile");

      return {
        reference,
        digest: issue.digest,
        legalNumber: issue.legalDocumentNumber,
        documentType: "Invoice" as const,
        issuedOn: issue.issuedOn,
        dueOn: issue.draftSnapshot.content.dueDate,
        paymentTerms: issue.draftSnapshot.content.paymentTerms,
        buyerReference: issue.draftSnapshot.content.buyerReference ?? null,
        orderReference: issue.draftSnapshot.content.orderReference ?? null,
        seller: issue.draftSnapshot.content.seller,
        buyer: issue.draftSnapshot.content.customer,
        counterpartyId: issue.draftSnapshot.content.counterpartyId,
        currency: issue.draftSnapshot.content.currency,
        scale: issue.draftSnapshot.content.currencyScale,
        lines: issue.lines,
        netMinor: issue.totals.netMinor,
        taxMinor: issue.totals.taxMinor,
        grossMinor: issue.totals.grossMinor,
        originalNumber: null,
        originalIssuedOn: null,
      } satisfies PeppolDocument;
    }

    const row = (yield* CreditsDb.readCredit(tx, scope.bookId, reference.id))[0];

    if (!row) return yield* failure("NotFound");
    const credit = yield* decode(Credits.CustomerCreditReceipt, row.body);

    const originalRow = (yield* ArDb.readArLegalIssueById(
      tx,
      scope.bookId,
      credit.originalLegalIssueId,
    ))[0];

    if (!originalRow) return yield* failure("MissingEvidence");
    const original = yield* decode(Ar.ArLegalIssueReceipt, originalRow.body);

    if (
      credit.scope.entityId !== scope.entityId ||
      credit.scope.bookId !== scope.bookId ||
      original.digest !== credit.originalIssueDigest ||
      original.legalDocumentNumber !== credit.originalDocumentNumber
    )
      return yield* failure("StaleDependency");
    const document = credit.semanticDocument;

    return {
      reference,
      digest: credit.digest,
      legalNumber: document.documentNumber,
      documentType: "CreditNote" as const,
      issuedOn: document.creditDate,
      dueOn: null,
      paymentTerms: original.draftSnapshot.content.paymentTerms,
      buyerReference: document.buyerReference ?? null,
      orderReference: document.orderReference ?? null,
      seller: document.seller,
      buyer: document.customer,
      counterpartyId: document.counterpartyId,
      currency: document.currency,
      scale: document.currencyScale,
      lines: document.lines.map((line) => ({
        id: line.originalLineId,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.creditedNetMinor,
        netMinor: line.creditedNetMinor,
        taxMinor: line.creditedTaxMinor,
        vatTreatment: line.vatTreatment,
      })),
      netMinor: document.totals.netMinor,
      taxMinor: document.totals.taxMinor,
      grossMinor: document.totals.grossMinor,
      originalNumber: document.originalDocumentNumber,
      originalIssuedOn: document.originalIssuedOn,
    } satisfies PeppolDocument;
  });
}

export function partyDigest(party: Party) {
  return digest({
    legalName: party.legalName,
    registrationId: party.registrationId,
    taxId: party.taxId,
    address: party.address,
    countryCode: party.countryCode,
  });
}

export function bindingSubject(document: PeppolDocument, role: "sender" | "recipient") {
  return digest({
    role,
    subject: role === "sender" ? document.seller.registrationId : document.counterpartyId,
  });
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function amount(value: string) {
  const n = BigInt(value);

  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

function partyXml(party: Party, binding: typeof Contracts.Binding.Type) {
  return `<cac:Party><cbc:EndpointID schemeID="${binding.schemeId}">${escape(binding.participantId)}</cbc:EndpointID><cac:PartyName><cbc:Name>${escape(party.legalName)}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>${escape(party.address ?? "")}</cbc:StreetName><cac:Country><cbc:IdentificationCode>${escape(party.countryCode ?? "")}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>${party.taxId === null ? "" : `<cac:PartyTaxScheme><cbc:CompanyID>${escape(party.taxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`}<cac:PartyLegalEntity><cbc:RegistrationName>${escape(party.legalName)}</cbc:RegistrationName><cbc:CompanyID>${escape(party.registrationId ?? "")}</cbc:CompanyID></cac:PartyLegalEntity></cac:Party>`;
}

export function renderPeppol(
  document: PeppolDocument,
  sender: typeof Contracts.Binding.Type,
  recipient: typeof Contracts.Binding.Type,
) {
  return Effect.gen(function* () {
    if (
      document.currency !== "SEK" ||
      document.scale !== 2 ||
      document.seller.countryCode !== "SE" ||
      document.buyer.countryCode !== "SE" ||
      document.seller.address === null ||
      document.buyer.address === null ||
      document.seller.taxId === null ||
      document.lines.some(
        (line) => line.quantity !== "1" || line.vatTreatment !== "se-domestic-standard-25-v1",
      ) ||
      sender.paymentAccountReference === null ||
      document.paymentTerms === null
    )
      return yield* failure("UnsupportedProfile");

    const totals = Domain.reconcileBisTotals({
      document: {
        documentId: document.reference.id,
        documentType: document.documentType,
        issued: true,
        sellerParticipant: sender.participantId,
        buyerParticipant: recipient.participantId,
        currencySupported: true,
        lines: document.lines.map((line) => ({
          lineId: line.id,
          netMinor: line.netMinor,
          taxCategory: "S",
          taxRateNumerator: "25",
          taxRateDenominator: "100",
          taxAmountMinor: line.taxMinor,
        })),
        documentAllowancesMinor: "0",
        documentChargesMinor: "0",
        prepaidAmountMinor: "0",
        documentRoundingMinor: "0",
        retainedExclusiveMinor: document.netMinor,
        retainedTaxMinor: document.taxMinor,
        retainedPayableMinor: document.grossMinor,
        originalInvoiceRef: document.originalNumber,
      },
      supportedTypes: ["Invoice", "CreditNote"],
      senderBindingCurrent: true,
      recipientBindingCurrent: true,
    });

    if (Result.isFailure(totals)) return yield* failure("InvalidJournal", totals.failure);

    const expected: typeof Contracts.ExpectedSemantic.Type = {
      documentId: document.legalNumber,
      documentType: document.documentType,
      currency: "SEK",
      sellerParticipant: sender.participantId,
      buyerParticipant: recipient.participantId,
      exclusiveMinor: document.netMinor,
      taxMinor: document.taxMinor,
      payableMinor: document.grossMinor,
      originalInvoiceRef: document.originalNumber,
      buyerReference: document.buyerReference,
      orderReference: document.orderReference,
    };

    const tag = document.documentType;

    const money = (name: string, value: string) =>
      `<cbc:${name} currencyID="SEK">${amount(value)}</cbc:${name}>`;

    const category = `<cbc:ID>S</cbc:ID><cbc:Percent>25</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`;

    const lines = document.lines
      .map(
        (line) =>
          `<cac:${tag}Line><cbc:ID>${escape(line.id)}</cbc:ID><cbc:${tag === "Invoice" ? "Invoiced" : "Credited"}Quantity unitCode="C62">${line.quantity}</cbc:${tag === "Invoice" ? "Invoiced" : "Credited"}Quantity>${money("LineExtensionAmount", line.netMinor)}<cac:Item><cbc:Name>${escape(line.description)}</cbc:Name><cac:ClassifiedTaxCategory>${category}</cac:ClassifiedTaxCategory></cac:Item><cac:Price>${money("PriceAmount", line.unitPriceMinor)}<cbc:BaseQuantity unitCode="C62">1</cbc:BaseQuantity></cac:Price></cac:${tag}Line>`,
      )
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?><${tag} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${tag}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID><cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID><cbc:ID>${escape(document.legalNumber)}</cbc:ID><cbc:IssueDate>${document.issuedOn}</cbc:IssueDate>${tag === "Invoice" && document.dueOn !== null ? `<cbc:DueDate>${document.dueOn}</cbc:DueDate>` : ""}<cbc:${tag}TypeCode>${tag === "Invoice" ? "380" : "381"}</cbc:${tag}TypeCode><cbc:DocumentCurrencyCode>SEK</cbc:DocumentCurrencyCode>${document.buyerReference === null ? "" : `<cbc:BuyerReference>${escape(document.buyerReference)}</cbc:BuyerReference>`}${document.orderReference === null ? "" : `<cac:OrderReference><cbc:ID>${escape(document.orderReference)}</cbc:ID></cac:OrderReference>`}${document.originalNumber === null ? "" : `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${escape(document.originalNumber)}</cbc:ID><cbc:IssueDate>${document.originalIssuedOn}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`}<cac:AccountingSupplierParty>${partyXml(document.seller, sender)}</cac:AccountingSupplierParty><cac:AccountingCustomerParty>${partyXml(document.buyer, recipient)}</cac:AccountingCustomerParty><cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>${escape(document.legalNumber)}</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>${sender.paymentAccountReference}</cbc:ID><cac:FinancialInstitutionBranch><cbc:ID>SE:BANKGIRO</cbc:ID></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount></cac:PaymentMeans><cac:PaymentTerms><cbc:Note>${escape(document.paymentTerms)}</cbc:Note></cac:PaymentTerms><cac:TaxTotal>${money("TaxAmount", document.taxMinor)}<cac:TaxSubtotal>${money("TaxableAmount", document.netMinor)}${money("TaxAmount", document.taxMinor)}<cac:TaxCategory>${category}</cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal>${money("LineExtensionAmount", document.netMinor)}${money("TaxExclusiveAmount", document.netMinor)}${money("TaxInclusiveAmount", document.grossMinor)}${money("PayableAmount", document.grossMinor)}</cac:LegalMonetaryTotal>${lines}</${tag}>`;

    if (new TextEncoder().encode(xml).length > 1048576) return yield* failure("UnsupportedProfile");

    return { xml, expected };
  });
}

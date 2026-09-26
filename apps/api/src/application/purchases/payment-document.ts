import type * as Payments from "@open-erp/contracts/supplier-payment-batches";

const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const amount = (minor: string) =>
  `${BigInt(minor) / 100n}.${(BigInt(minor) % 100n).toString().padStart(2, "0")}`;

export function paymentDocument(preview: typeof Payments.SupplierPaymentPreview.Type) {
  const { input, selection, id, createdAt } = preview;
  const header = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>${id}</MsgId><CreDtTm>${createdAt}</CreDtTm><NbOfTxs>${selection.count}</NbOfTxs><CtrlSum>${amount(selection.totalMinor)}</CtrlSum><InitgPty><Nm>${xml(input.debtorName)}</Nm></InitgPty></GrpHdr><PmtInf><PmtInfId>${id}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${selection.count}</NbOfTxs><CtrlSum>${amount(selection.totalMinor)}</CtrlSum><ReqdExctnDt>${input.executionDate}</ReqdExctnDt><Dbtr><Nm>${xml(input.debtorName)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${input.debtorIban}</IBAN></Id></DbtrAcct><DbtrAgt><FinInstnId><BIC>${input.debtorBic}</BIC></FinInstnId></DbtrAgt><ChrgBr>SLEV</ChrgBr>`;

  const transfers = selection.items
    .map(
      (item) =>
        `<CdtTrfTxInf><PmtId><EndToEndId>${item.invoiceId.slice(-32)}</EndToEndId></PmtId><Amt><InstdAmt Ccy="SEK">${amount(item.amountMinor)}</InstdAmt></Amt><CdtrAgt><FinInstnId><BIC>${item.creditorBic}</BIC></FinInstnId></CdtrAgt><Cdtr><Nm>${xml(item.creditorName)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${item.creditorIban}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${xml(item.supplierDocumentNumber)}</Ustrd></RmtInf></CdtTrfTxInf>`,
    )
    .join("");

  return `${header}${transfers}</PmtInf></CstmrCdtTrfInitn></Document>`;
}

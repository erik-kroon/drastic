import * as O from "@open-erp/contracts/onboarding";
import { render } from "takumi-pdf";
import { Document, Page, pointToCssPixel } from "./pdfcn/primitives";
import { PageHeader, PageFooter, Section, Text, KeyValue } from "./pdfcn/components";
import { pdfcnTheme } from "./pdfcn/theme";
import {
  legalDocumentFonts,
  legalDocumentText,
  verifyDocumentBytes,
} from "../../application/commerce/legal-document-presentation";

export async function renderOnboardingReceipt(receipt: typeof O.OnboardingActivationReceipt.Type) {
  const name = legalDocumentText(receipt.projection.companyName);

  const presentation = (
    <Document title={`Aktiveringskvitto, ${name}`}>
      <Page>
        <PageHeader
          title="Aktiveringskvitto"
          subtitle={name}
          rightText="Drastic"
          rightSubText={receipt.activatedAt}
        />
        <Section>
          <KeyValue items={[{ key: "Aktiverad", value: receipt.activatedAt }]} />
          <KeyValue items={[{ key: "Gällande från", value: receipt.authoritativeFrom }]} />
          <KeyValue
            items={[
              { key: "Verifikat", value: String(receipt.projection.counts.importedVouchers) },
            ]}
          />
          <KeyValue
            items={[
              { key: "Kundfakturor", value: String(receipt.projection.counts.customerInvoices) },
            ]}
          />
          <KeyValue
            items={[
              {
                key: "Leverantörsfakturor",
                value: String(receipt.projection.counts.supplierInvoices),
              },
            ]}
          />
          <KeyValue
            items={[
              { key: "Bankhändelser", value: String(receipt.projection.counts.bankObservations) },
            ]}
          />
          <KeyValue
            items={[
              {
                key: "Original",
                value:
                  receipt.projection.counts.retainedOriginals === null
                    ? "Ej verifierat"
                    : String(receipt.projection.counts.retainedOriginals),
              },
            ]}
          />
        </Section>
        <Section>
          <Text weight="semibold">Accepterade begränsningar</Text>
          {receipt.acceptedLimitations.map((entry) => (
            <Text key={entry.id}>
              {entry.decision.kind === "accept_limitation"
                ? `${entry.decision.limitation}, ${legalDocumentText(entry.decision.reason)}`
                : ""}
              {", "}
              {legalDocumentText(entry.actorName)}
              {", "}
              {entry.recordedAt}
            </Text>
          ))}
        </Section>
        <Section>
          <Text weight="semibold">Godkänt av</Text>
          {receipt.confirmations.map((entry) => (
            <Text key={entry.id}>
              {legalDocumentText(entry.actorName)}
              {", "}
              {entry.recordedAt}
            </Text>
          ))}
        </Section>
        <Text>Exempeldata. Ingen myndighetsinlämning har genomförts.</Text>
      </Page>
    </Document>
  );

  const bytes = verifyDocumentBytes(
    await render(presentation, {
      size: "a4",
      lang: "sv-SE",
      fonts: legalDocumentFonts,
      fontFamilies: [pdfcnTheme.typography.fontFamily],
      margin: {
        top: pointToCssPixel(pdfcnTheme.page.top),
        right: pointToCssPixel(pdfcnTheme.page.right),
        bottom: pointToCssPixel(pdfcnTheme.page.bottom),
        left: pointToCssPixel(pdfcnTheme.page.left),
      },
      footer: <PageFooter leftText={name} />,
      metadata: {
        title: `Aktiveringskvitto, ${name}`,
        creator: "Drastic",
        creationDate: receipt.activatedAt.slice(0, 19),
      },
    }),
  );

  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return {
    receiptId: receipt.id,
    filename: "aktiveringskvitto.pdf",
    mediaType: "application/pdf" as const,
    contentBase64: btoa(binary),
  };
}

import type * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import { legalInvoiceRendererVersion } from "@open-erp/contracts/legal-invoice-pdf";
import { render } from "takumi-pdf";
import { Document, Page, View, pointToCssPixel } from "../../adapters/pdf/pdfcn/primitives";
import {
  PageHeader,
  PageFooter,
  Section,
  Table,
  TableBody,
  TableHeader,
  TableRow,
  TableCell,
  Text,
  KeyValue,
} from "../../adapters/pdf/pdfcn/components";
import { pdfcnTheme } from "../../adapters/pdf/pdfcn/theme";
import {
  legalDocumentFonts,
  legalDocumentText as text,
  legalDocumentMoney as money,
  requiredDocumentText as required,
  unsupportedDocument as unsupported,
  verifyDocumentBytes,
} from "./legal-document-presentation";

// Only immutable issue and policy snapshots enter the pdfcn presentation.
export async function renderLegalInvoicePdf(capture: typeof Pdf.LegalInvoicePdfCapture.Type) {
  const issue = capture.source.issue;
  const draft = issue.draftSnapshot;
  const policy = issue.policySnapshot;
  const content = draft.content;
  const seller = policy.candidate.input.sellerIdentity;

  if (
    capture.input.rendererVersion !== legalInvoiceRendererVersion ||
    issue.policyId !== policy.id ||
    issue.policyDigest !== policy.digest ||
    policy.input.ruleVersion !== "se-domestic-standard-25-2023-200-v1" ||
    content.currency !== "SEK" ||
    content.currencyScale !== 2 ||
    content.seller.legalName !== seller.legalName ||
    content.seller.taxId !== seller.vatRegistrationNumber ||
    content.seller.registrationId !== seller.registrationNumber ||
    content.seller.address !== seller.postalAddress ||
    content.lines.length !== issue.lines.length ||
    draft.totals.taxMinor !== issue.totals.taxMinor ||
    draft.totals.netMinor !== issue.totals.netMinor ||
    draft.totals.grossMinor !== issue.totals.grossMinor ||
    !draft.totals.sourceTotalMatches
  )
    unsupported(
      "The legal PDF source does not match its approved seller, version or exact invoice amounts.",
    );

  for (const [index, line] of issue.lines.entries()) {
    const asserted = content.lines[index];

    if (
      !asserted ||
      asserted.id !== line.id ||
      line.vatTreatment !== "se-domestic-standard-25-v1" ||
      asserted.taxMinor !== line.taxMinor ||
      asserted.sourceGrossMinor !== line.grossMinor ||
      asserted.unitPriceMinor !== line.unitPriceMinor
    )
      unsupported("A legal invoice line is not the exact approved issued line.");
  }

  const number = text(issue.legalDocumentNumber);

  const document = (
    <Document title={`Faktura ${number}`}>
      <Page>
        <PageHeader
          title="Faktura"
          subtitle={text(seller.legalName)}
          rightText={number}
          rightSubText={text(issue.issuedOn)}
        />
        <Section noWrap style={{ flexDirection: "row", gap: pdfcnTheme.spacing.section }}>
          <View style={{ width: "50%" }}>
            <Text weight="semibold">Från</Text>
            <Text noMargin>{text(seller.legalName)}</Text>
            <Text noMargin>{text(seller.postalAddress)}</Text>
            <Text noMargin>{text(seller.countryCode)}</Text>
            <Text variant="sm" noMargin>
              Org.nr: {text(seller.registrationNumber)}
            </Text>
            <Text variant="sm" noMargin>
              Momsnr: {required(seller.vatRegistrationNumber, "seller VAT registration")}
            </Text>
          </View>
          <View style={{ width: "50%" }}>
            <Text weight="semibold">Till</Text>
            <Text noMargin>{text(content.customer.legalName)}</Text>
            <Text noMargin>{required(content.customer.address, "customer address")}</Text>
            <Text noMargin>{required(content.customer.countryCode, "customer country")}</Text>
            <Text variant="sm" noMargin>
              Org.nr: {required(content.customer.registrationId, "customer registration")}
            </Text>
          </View>
        </Section>
        <Section noWrap spacing="sm">
          <Text weight="semibold">{text(content.title)}</Text>
          <Text variant="sm" muted>
            Fakturadatum: {text(issue.issuedOn)} · Leveransdatum:{" "}
            {required(content.supplyDate, "supply date")} · Förfallodatum:{" "}
            {required(content.dueDate, "due date")}
          </Text>
        </Section>
        <Table>
          <TableHeader>
            <TableRow header>
              <TableCell width="42%">Beskrivning</TableCell>
              <TableCell width="6%" align="center">
                Ant.
              </TableCell>
              <TableCell width="26%" align="right">
                À-pris exkl. moms
              </TableCell>
              <TableCell width="26%" align="right">
                Totalt inkl. moms
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issue.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell width="42%">
                  <Text variant="sm" noMargin>
                    {text(line.description)}
                  </Text>
                  <Text variant="xs" muted noMargin>
                    Netto {money(line.netMinor)} · moms 25 % {money(line.taxMinor)}
                    {"\n"}Rabatt {money(line.discountMinor)} · tillägg {money(line.chargeMinor)}
                  </Text>
                </TableCell>
                <TableCell width="6%" align="center">
                  {text(line.quantity)}
                </TableCell>
                <TableCell width="26%" align="right">
                  {money(line.unitPriceMinor)}
                </TableCell>
                <TableCell width="26%" align="right">
                  {money(line.grossMinor)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Section noWrap>
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <View style={{ width: "65%" }}>
              <KeyValue
                items={[
                  { key: "Netto", value: money(issue.totals.netMinor) },
                  { key: "Moms 25 %", value: money(issue.totals.taxMinor) },
                  { key: "Att betala", value: money(issue.totals.grossMinor), emphasized: true },
                ]}
              />
            </View>
          </View>
          <Section spacing="sm">
            <Text weight="semibold">Betalningsvillkor</Text>
            <Text variant="sm">{required(content.paymentTerms, "payment terms")}</Text>
            <Text variant="sm">Ange fakturanummer {number} vid betalning.</Text>
            <Text variant="xs" muted noMargin>
              Fakturan avser en svensk försäljning med 25 % moms. Valuta: SEK.
            </Text>
          </Section>
        </Section>
      </Page>
    </Document>
  );

  return verifyDocumentBytes(
    await render(document, {
      size: "a4",
      margin: {
        top: pointToCssPixel(pdfcnTheme.page.top),
        right: pointToCssPixel(pdfcnTheme.page.right),
        bottom: pointToCssPixel(pdfcnTheme.page.bottom),
        left: pointToCssPixel(pdfcnTheme.page.left),
      },
      lang: "sv-SE",
      fonts: legalDocumentFonts,
      fontFamilies: [pdfcnTheme.typography.fontFamily],
      stylesheets: ["*{box-sizing:border-box}body{margin:0}"],
      footer: <PageFooter leftText={`${text(seller.legalName)} · ${number}`} />,
      metadata: {
        title: `Faktura ${issue.legalDocumentNumber}`,
        creator: "OpenERP",
        creationDate: `${issue.issuedOn}T00:00:00`,
      },
    }),
  );
}

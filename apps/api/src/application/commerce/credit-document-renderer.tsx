import type * as Credits from "@open-erp/contracts/customer-credit-notes";
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
  unsupportedDocument,
  verifyDocumentBytes,
} from "./legal-document-presentation";

function Party(props: { party: typeof Credits.CustomerCreditParty.Type; label: string }) {
  const party = props.party;

  if (!party.address || !party.registrationId || party.countryCode !== "SE")
    unsupportedDocument("The retained credit party is incomplete for this document profile.");

  return (
    <View style={{ width: "50%" }}>
      <Text weight="semibold">{props.label}</Text>
      <Text noMargin>{text(party.legalName)}</Text>
      <Text noMargin>{text(party.address)}</Text>
      <Text variant="sm" noMargin>
        Org.nr: {text(party.registrationId)}
      </Text>
      {party.taxId && (
        <Text variant="sm" noMargin>
          Momsnr: {text(party.taxId)}
        </Text>
      )}
    </View>
  );
}

// Every monetary value comes from the immutable issued credit document.
export async function renderCreditDocumentPdf(
  document: typeof Credits.CustomerCreditSemanticDocument.Type,
) {
  if (document.currency !== "SEK" || document.currencyScale !== 2 || !document.seller.taxId)
    unsupportedDocument("The credit PDF profile requires retained Swedish SEK facts.");

  const number = text(document.documentNumber);

  const presentation = (
    <Document title={`Kreditnota ${number}`}>
      <Page>
        <PageHeader
          title="Kreditnota"
          subtitle={text(document.seller.legalName)}
          rightText={number}
          rightSubText={text(document.creditDate)}
        />
        <Section noWrap style={{ flexDirection: "row", gap: pdfcnTheme.spacing.section }}>
          <Party party={document.seller} label="Från" />
          <Party party={document.customer} label="Till" />
        </Section>
        <Section noWrap spacing="sm">
          <Text variant="sm">
            Kreditdatum: {text(document.creditDate)} · Avser faktura{" "}
            {text(document.originalDocumentNumber)} från {text(document.originalIssuedOn)}
          </Text>
          <Text weight="semibold">Orsak</Text>
          <Text>{text(document.reason)}</Text>
        </Section>
        <Table>
          <TableHeader>
            <TableRow header>
              <TableCell width="40%">Beskrivning</TableCell>
              <TableCell width="20%" align="right">
                Krediterat exkl. moms
              </TableCell>
              <TableCell width="20%" align="right">
                Moms 25 %
              </TableCell>
              <TableCell width="20%" align="right">
                Krediterat inkl. moms
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {document.lines.map((line) => (
              <TableRow key={line.originalLineId}>
                <TableCell width="40%">
                  <Text variant="sm" noMargin>
                    {text(line.description)}
                  </Text>
                  <Text variant="xs" muted noMargin>
                    Ursprunglig mängd: {text(line.quantity)}
                  </Text>
                </TableCell>
                <TableCell width="20%" align="right">
                  {money(line.creditedNetMinor)}
                </TableCell>
                <TableCell width="20%" align="right">
                  {money(line.creditedTaxMinor)}
                </TableCell>
                <TableCell width="20%" align="right">
                  {money(line.creditedGrossMinor)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Section noWrap>
          <View style={{ width: "65%", marginBottom: pdfcnTheme.spacing.section }}>
            <Text variant="sm" weight="semibold">
              Om krediten
            </Text>
            <Text variant="xs" muted noMargin>
              Krediten minskar den obetalda fordran. Dokumentet är ingen betalningsuppmaning eller
              bekräftelse på återbetalning.
            </Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <View style={{ width: "65%" }}>
              <KeyValue
                items={[
                  { key: "Netto", value: money(document.totals.netMinor) },
                  { key: "Moms", value: money(document.totals.taxMinor) },
                  {
                    key: "Krediterat belopp",
                    value: money(document.totals.grossMinor),
                    emphasized: true,
                  },
                ]}
              />
            </View>
          </View>
        </Section>
      </Page>
    </Document>
  );

  return verifyDocumentBytes(
    await render(presentation, {
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
      footer: <PageFooter leftText={`${text(document.seller.legalName)} · ${number}`} />,
      metadata: {
        title: `Kreditnota ${document.documentNumber}`,
        creator: "OpenERP",
        creationDate: `${document.creditDate}T00:00:00`,
      },
    }),
  );
}

import type * as Runs from "@open-erp/contracts/payroll-runs";
import { render } from "takumi-pdf";
import { Document, Page, pointToCssPixel } from "../../adapters/pdf/pdfcn/primitives";
import {
  PageHeader,
  PageFooter,
  Section,
  KeyValue,
  Text,
} from "../../adapters/pdf/pdfcn/components";
import { pdfcnTheme } from "../../adapters/pdf/pdfcn/theme";
import {
  legalDocumentFonts,
  legalDocumentText as text,
  legalDocumentMoney as money,
  unsupportedDocument,
  verifyDocumentBytes,
} from "../commerce/legal-document-presentation";

export async function renderPayslipPdf(document: typeof Runs.PayrollPayslipDocument.Type) {
  if (document.currency !== "SEK" || document.currencyScale !== 2)
    unsupportedDocument("The payslip renderer requires the retained SEK scale-2 profile.");

  const presentation = (
    <Document title="Lönebesked">
      <Page>
        <PageHeader
          title="Lönebesked"
          subtitle={text(document.personRef)}
          rightText={text(document.expectedPaymentOn)}
          rightSubText="Bokförd, ej utbetald"
        />
        <Section>
          <Text>
            Intjänandeperiod {text(document.earningsPeriod.startsOn)} till{" "}
            {text(document.earningsPeriod.endsOn)}
          </Text>
          <KeyValue
            items={[
              { key: "Bruttolön", value: money(document.grossMinor) },
              { key: "Ersättning", value: money(document.cashReimbursementMinor) },
              { key: "Preliminärskatt", value: money(document.withholdingMinor) },
              { key: "Nettoavdrag", value: money(document.netDeductionMinor) },
              { key: "Nettolön", value: money(document.payableMinor) },
              { key: "Arbetsgivaravgift", value: money(document.employerContributionMinor) },
            ]}
          />
        </Section>
        {document.benefitBases.length > 0 && (
          <Section>
            <Text>Förmåner</Text>
            <KeyValue
              items={document.benefitBases.map((benefit) => ({
                key: text(benefit.componentId),
                value: money(benefit.withholdingBaseMinor),
              }))}
            />
          </Section>
        )}
        {document.deductions.length > 0 && (
          <Section>
            <Text>Avdrag</Text>
            <KeyValue
              items={document.deductions.map((deduction) => ({
                key: text(deduction.description),
                value: money(deduction.minor),
              }))}
            />
          </Section>
        )}
        {document.extraAccruals.length > 0 && (
          <Section>
            <Text>Övriga arbetsgivaravsättningar</Text>
            <KeyValue
              items={document.extraAccruals.map((accrual) => ({
                key: text(accrual.componentId),
                value: money(accrual.minor),
              }))}
            />
          </Section>
        )}
        <Text>Bokföring är inte betalningsbevis</Text>
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
      footer: <PageFooter leftText={text(document.id)} />,
      metadata: {
        title: "Lönebesked",
        creator: "OpenERP",
        creationDate: `${document.expectedPaymentOn}T00:00:00`,
      },
    }),
  );
}

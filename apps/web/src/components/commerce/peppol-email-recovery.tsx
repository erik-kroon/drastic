import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Peppol from "@open-erp/contracts/peppol-exchange";
import * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import * as Delivery from "@open-erp/contracts/legal-delivery";
import { Box } from "@open-erp/ui/components/box";
import { InputField } from "@open-erp/ui/components/field";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";
import { verifyLegalPdf, downloadLegalPdf } from "./invoice-issuance";
import { checkScope, CommandForm } from "./shared";

export function PeppolEmailRecovery({ review }: { review: typeof Peppol.Review.Type }) {
  const { book, locale } = useBookWorkspace();
  const client = useQueryClient();
  const base = `${bookPath(book)}/commerce`;
  const key = [...bookKey(book), "peppol-email-pdf", review.source.reference.id];

  const pdf = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) => {
      const history = await readAccounting(
        (client) =>
          client.legalInvoicePdfs.legalInvoicePdfHistory({
            params: { ...bookScope(book), id: review.source.reference.id },
          }),
        Pdf.LegalInvoicePdfHistory,
        { signal },
      );

      checkScope(book, history.scope);

      if (history.issueId !== review.source.reference.id) throw new Error("PDF source mismatch");
      const item = history.items[0];

      if (!item) return null;

      const view = await readAccounting(
        (client) =>
          client.legalInvoicePdfs.getLegalInvoicePdf({
            params: { ...bookScope(book), id: item.id },
          }),
        Pdf.LegalInvoicePdfView,
        { signal },
      );

      checkScope(book, view.capture.scope);

      if (
        view.capture.issueId !== review.source.reference.id ||
        view.capture.input.issueDigest !== review.source.digest
      )
        throw new Error("PDF source mismatch");

      return {
        ...view,
        verified: view.artifact ? await verifyLegalPdf(book, view.capture, view.artifact) : null,
      };
    },
  });

  const artifact = pdf.isError ? null : pdf.data?.artifact;

  return (
    <Box display="grid" gap="md">
      <Text>Förbered e-post</Text>
      <Text>Ladda ner PDF och skicka själv. Fakturan markeras då inte som skickad.</Text>
      <AccountingStatus locale={locale} pending={pdf.isPending} error={pdf.error} />
      {pdf.isSuccess && !artifact ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/legal-invoice-pdfs`}
          schema={Pdf.PrepareLegalInvoicePdf}
          output={Pdf.LegalInvoicePdfView}
          input={() => ({
            issueId: review.source.reference.id,
            issueDigest: review.source.digest,
            rendererVersion: Pdf.legalInvoiceRendererVersion,
          })}
          label="Förbered PDF"
          onSuccess={() => {
            void client.invalidateQueries({ queryKey: key });
          }}
          operation={(client, requestOptions) =>
            client.legalInvoicePdfs.prepareLegalInvoicePdf(
              httpRequest(
                Api.groups.legalInvoicePdfs.endpoints.prepareLegalInvoicePdf,
                { params: { ...bookScope(book) } },
                requestOptions,
              ),
            )
          }
        />
      ) : null}
      {pdf.data?.verified && !pdf.isError ? <PdfDownload verified={pdf.data.verified} /> : null}
      {artifact && pdf.data ? (
        <EmailHandoff capture={pdf.data.capture} artifact={artifact} />
      ) : null}
    </Box>
  );
}

function EmailHandoff(props: {
  capture: typeof Pdf.LegalInvoicePdfCapture.Type;
  artifact: typeof Pdf.LegalInvoicePdfArtifact.Type;
}) {
  const { book, locale } = useBookWorkspace();
  const client = useQueryClient();
  const base = `${bookPath(book)}/commerce`;
  const key = [...bookKey(book), "peppol-email-handoffs", props.capture.id];

  const history = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.legalDeliveries.legalDeliveryHistory({
            params: { ...bookScope(book), id: props.capture.id },
          }),
        Delivery.LegalDeliveryHistory,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.pdfCaptureId !== props.capture.id) throw new Error("Delivery source mismatch");

      for (const item of result.items) {
        checkScope(book, item.request.scope);

        if (
          item.request.input.pdfCaptureId !== props.capture.id ||
          item.request.input.artifactSha256 !== props.artifact.sha256
        )
          throw new Error("Delivery artifact mismatch");
      }

      return result;
    },
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
  };

  return (
    <Box display="grid" gap="md">
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      <CommandForm
        book={book}
        locale={locale}
        path={`${base}/legal-deliveries`}
        schema={Delivery.PrepareLegalDelivery}
        output={Delivery.LegalDeliveryView}
        canSubmit={history.isSuccess}
        label="Förbered e-post"
        onSuccess={refresh}
        input={(fields) => ({
          pdfCaptureId: props.capture.id,
          captureDigest: props.capture.digest,
          artifactSha256: props.artifact.sha256,
          channel: "email",
          destination: formText(fields, "destination"),
          providerProfileKey: "manual_email_handoff_v1",
          reason: formText(fields, "reason"),
        })}
        operation={(client, requestOptions) =>
          client.legalDeliveries.prepareLegalDelivery(
            httpRequest(
              Api.groups.legalDeliveries.endpoints.prepareLegalDelivery,
              { params: { ...bookScope(book) } },
              requestOptions,
            ),
          )
        }
      >
        <InputField name="destination" type="email" label="Till" required />
        <InputField name="reason" label="Anledning" required />
      </CommandForm>
      {!history.isError
        ? history.data?.items
            .filter((item) => item.request.input.channel === "email")
            .map((item) => (
              <Box key={item.request.id} display="grid" gap="sm">
                <Text>{item.request.input.destination}</Text>
                {item.approval ? (
                  <Text>Att godkänna skickar inte direkt. Utskicket är ett eget steg.</Text>
                ) : (
                  <CommandForm
                    book={book}
                    locale={locale}
                    path={`${base}/legal-deliveries/${item.request.id}/send-approval`}
                    schema={Delivery.ApproveLegalDelivery}
                    output={Delivery.LegalDeliveryView}
                    label="Godkänn utskick"
                    onSuccess={refresh}
                    input={(fields) => ({
                      requestDigest: item.request.digest,
                      reason: formText(fields, "reason"),
                      approveSendHandoff: true,
                    })}
                    operation={(client, requestOptions) =>
                      client.legalDeliveries.approveLegalDelivery(
                        httpRequest(
                          Api.groups.legalDeliveries.endpoints.approveLegalDelivery,
                          { params: { ...bookScope(book), id: item.request.id } },
                          requestOptions,
                        ),
                      )
                    }
                  >
                    <InputField name="reason" label="Anledning" required />
                  </CommandForm>
                )}
                <Text>Ingenting har skickats och kunden har inte fått något.</Text>
              </Box>
            ))
        : null}
    </Box>
  );
}

function PdfDownload({
  verified,
}: {
  verified: NonNullable<Awaited<ReturnType<typeof verifyLegalPdf>>>;
}) {
  return (
    <Button variant="outline" onClick={() => downloadLegalPdf(verified)}>
      Ladda ner PDF
    </Button>
  );
}

function formText(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value.trim() : "";
}

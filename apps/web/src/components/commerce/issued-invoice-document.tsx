import { useQuery } from "@tanstack/react-query";
import type * as Commerce from "@open-erp/contracts/commerce";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { Button } from "@open-erp/ui/components/button";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { InvoiceDraftDocument } from "./invoice-draft-document";
import { InvoiceDocumentPanel } from "./invoice-documents";
import { InvoiceCancellationPanel } from "./invoice-cancellations";
import { checkScope, commercePath, commerceKey, Details, type CommerceProps } from "./shared";

export function IssuedInvoiceDocument(
  props: CommerceProps & { invoice: typeof Commerce.Invoice.Type; reviewId: string },
) {
  const { book, locale, invoice, reviewId } = props;
  const view = useQuery({
    queryKey: [...commerceKey(book), "issued-invoice-document", invoice.id, reviewId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-issue-reviews/${encodeURIComponent(reviewId)}`,
        Issuance.InvoiceIssueView,
        { signal },
      );
      checkScope(book, result.plan.scope);
      if (
        result.plan.id !== reviewId ||
        result.issue?.registerInvoiceId !== invoice.id ||
        result.issue.id !== invoice.issueOrigin?.issueId
      )
        throw new Error("Invoice document origin mismatch");
      checkScope(book, result.issue.scope);
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg">
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {view.isError ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              void view.refetch();
            }}
          >
            {locale === "sv" ? "Försök igen" : "Try again"}
          </Button>
        </Box>
      ) : null}
      {view.data?.issue && !view.isError ? (
        <>
          <Text tone="muted">
            {locale === "sv"
              ? "Demofaktura. Dokumentet har inte skickats och är inte en juridisk faktura."
              : "Demo invoice. This document has not been sent and is not a legal invoice."}
          </Text>
          <InvoiceDocumentPanel book={book} locale={locale} issue={view.data.issue} />
          <InvoiceDraftDocument
            record={view.data.plan.draftSnapshot}
            locale={locale}
            title={`${locale === "sv" ? "Demofaktura" : "Demo invoice"} · ${invoice.documentNumber}`}
            issued
          />
          <Details
            title={
              invoice.status === "cancelled"
                ? locale === "sv"
                  ? "Makulering"
                  : "Cancellation"
                : locale === "sv"
                  ? "Makulera demofaktura"
                  : "Cancel demo invoice"
            }
          >
            <InvoiceCancellationPanel book={book} locale={locale} issue={view.data.issue} />
          </Details>
        </>
      ) : null}
    </Box>
  );
}

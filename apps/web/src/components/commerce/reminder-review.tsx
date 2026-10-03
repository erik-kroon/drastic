import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Collections from "@open-erp/contracts/collections";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Crm from "@open-erp/contracts/crm-master";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

export function ReminderReview({ book, locale }: CommerceProps) {
  const sv = locale === "sv";
  const [issueEntry, setIssueEntry] = useState("");
  const [issueId, setIssueId] = useState("");
  const [reminderId, setReminderId] = useState("");
  const [message, setMessage] = useState<typeof Collections.ReminderMessage.Type | null>(null);
  const base = `${commercePath(book)}/collections/reminders`;

  const issue = useQuery({
    queryKey: [...commerceKey(book), "reminder-issue", issueId],
    enabled: issueId !== "",
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/ar-legal-issues/${encodeURIComponent(issueId)}`,
        Ar.ArLegalIssueReceipt,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
  });

  const customerId = issue.data?.draftSnapshot.content.counterpartyId;

  const recipient = useQuery({
    queryKey: [...commerceKey(book), "reminder-recipient", customerId],
    enabled: customerId !== undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!customerId) throw new Error("Invoice customer is unavailable.");

      const result = await readAccounting(
        `${commercePath(book)}/directory/${encodeURIComponent(customerId)}/recipient`,
        Crm.ReviewedCustomerRecipient,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
  });

  const retained = useQuery({
    queryKey: [...commerceKey(book), "reminder", reminderId],
    enabled: reminderId !== "",
    retry: false,
    refetchInterval: reminderId ? 2000 : false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${base}/${encodeURIComponent(reminderId)}`,
        Collections.ReminderView,
        { signal },
      );

      checkScope(book, result.message.scope);

      return result;
    },
  });

  const currentMessage = retained.data?.message ?? message;
  const view = retained.data;
  const destination = recipient.data;

  const ready =
    destination?.status === "reviewed" && destination.purposes.includes("payment_reminder");

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <h3>{sv ? "Betalningspåminnelse" : "Payment reminder"}</h3>
      <Text tone="muted">
        {sv
          ? "Granska exakt meddelande och mottagare. Bankunderlaget är inte kvalificerat här. Inga avgifter eller ränta ingår. Endast lokal transport är tillgänglig."
          : "Review the exact message and recipient. Bank coverage is not qualified here. No fee or interest is included. Only local fixture transport is available."}
      </Text>
      <Box
        as="form"
        display="flex"
        gap="md"
        flexWrap="wrap"
        alignItems="end"
        onSubmit={(event) => {
          event.preventDefault();
          setIssueId(issueEntry.trim());
          setReminderId("");
          setMessage(null);
        }}
      >
        <InputField
          label={sv ? "Utfärdad fakturas ID" : "Issued invoice ID"}
          name="reminderIssueId"
          value={issueEntry}
          onChange={(event) => setIssueEntry(event.target.value)}
          required
        />
        <Button type="submit" variant="outline">
          {sv ? "Hämta faktura och mottagare" : "Load invoice and recipient"}
        </Button>
      </Box>
      <AccountingStatus
        locale={locale}
        pending={issue.isFetching || recipient.isFetching}
        error={issue.error ?? recipient.error}
      />
      {issue.data && destination ? (
        <Box display="grid" gap="md">
          <Text>
            {issue.data.legalDocumentNumber} · {destination.destination}
          </Text>
          {!ready ? (
            <Text>
              {sv
                ? "En aktuell granskad mottagare för betalningspåminnelser krävs."
                : "A current reviewed payment reminder recipient is required."}
            </Text>
          ) : null}
          <CommandForm
            book={book}
            locale={locale}
            path={base}
            schema={Collections.PrepareReminder}
            output={Collections.ReminderMessage}
            canSubmit={ready}
            label={sv ? "Förbered exakt påminnelse" : "Prepare exact reminder"}
            input={() => ({
              issueId,
              recipient: {
                partyId: destination.partyId,
                revision: destination.revision,
                digest: destination.digest,
              },
            })}
            onSuccess={(result) => {
              setMessage(result);
              setReminderId(result.id);
            }}
          />
        </Box>
      ) : null}
      <AccountingStatus
        locale={locale}
        pending={retained.isFetching && !view}
        error={retained.error}
      />
      {currentMessage ? (
        <ReminderPreview book={book} locale={locale} message={currentMessage} view={view} />
      ) : null}
    </Box>
  );
}

function ReminderPreview({
  book,
  locale,
  message,
  view,
}: CommerceProps & {
  readonly message: typeof Collections.ReminderMessage.Type;
  readonly view: typeof Collections.ReminderView.Type | undefined;
}) {
  const sv = locale === "sv";
  const base = `${commercePath(book)}/collections/reminders`;

  const statuses = sv
    ? {
        prepared: "Förberedd",
        approved: "Godkänd för lokal leverans",
        admitted: "Leveransförsök registrerat",
        reconciling: "Kontrollerar samma leveransförsök",
        provider_accepted: "Accepterad av lokal transport",
        delivered: "Leverans bekräftad av lokal transport",
        outcome_unknown: "Leveransutfall okänt",
        failed: "Avvisad av lokal transport",
        cancelled: "Avbruten före leveransförsök",
        refused: "Leverans nekad",
      }
    : {
        prepared: "Prepared",
        approved: "Approved for local delivery",
        admitted: "Dispatch attempt retained",
        reconciling: "Checking the same dispatch attempt",
        provider_accepted: "Accepted by local transport",
        delivered: "Delivery evidenced by local transport",
        outcome_unknown: "Outcome unknown",
        failed: "Rejected by local transport",
        cancelled: "Cancelled before admission",
        refused: "Dispatch refused",
      };

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>
        <strong>{message.recipient.destination}</strong>
      </Text>
      <Text>{message.subject}</Text>
      <Text>
        {sv ? "Förberett belopp" : "Prepared amount"} ·{" "}
        {formatMinorAmount(message.outstandingMinor, 2, locale)} SEK
      </Text>
      <Box overflow="auto" minWidth="zero">
        <pre>{message.plainText}</pre>
      </Box>
      <Text>{sv ? "HTML-meddelandets exakta innehåll" : "Exact HTML message content"}</Text>
      <Box overflow="auto" minWidth="zero">
        <pre>{message.html}</pre>
      </Box>
      <Text>{sv ? "Inga bilagor." : "No attachments."}</Text>
      <Text role="status">{statuses[view?.status ?? "prepared"]}</Text>
      {view?.currentOutstandingMinor !== null && view?.currentOutstandingMinor !== undefined ? (
        <Text>
          {sv ? "Nuvarande obetalda belopp" : "Current outstanding amount"} ·{" "}
          {formatMinorAmount(view.currentOutstandingMinor, 2, locale)} SEK
        </Text>
      ) : null}
      {view?.approval ? (
        <Text>
          {sv ? "Godkännandet gäller till" : "Approval expires at"} {view.approval.expiresAt}
        </Text>
      ) : null}
      {view?.reason ? <Text>{view.reason}</Text> : null}
      {view?.status === "prepared" || !view ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/${message.id}/approvals`}
          schema={Collections.ApproveReminder}
          output={Collections.ReminderView}
          allowed={book.role === "operator"}
          label={
            sv
              ? "Godkänn exakt meddelande till lokal transport"
              : "Approve exact message for local transport"
          }
          input={() => ({
            messageDigest: message.digest,
            acknowledgeExactMessage: true,
          })}
        />
      ) : null}
      {view?.status === "approved" ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/${message.id}/cancel`}
          schema={Collections.ReminderCommand}
          output={Collections.ReminderView}
          allowed={book.role === "operator"}
          label={sv ? "Avbryt före leveransförsök" : "Cancel before dispatch admission"}
          input={() => ({ messageDigest: message.digest })}
        />
      ) : null}
      {view?.attempt && ["provider_accepted", "outcome_unknown", "failed"].includes(view.status) ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/${message.id}/reconcile`}
          schema={Collections.ReminderCommand}
          output={Collections.ReminderView}
          allowed={book.role === "operator"}
          label={sv ? "Kontrollera samma leveransförsök" : "Check the same dispatch attempt"}
          input={() => ({ messageDigest: message.digest })}
        />
      ) : null}
    </Box>
  );
}

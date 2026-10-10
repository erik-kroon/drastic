import { bookScope, httpQuery, httpRequest } from "@/lib/contract-client";
import { Api } from "@open-erp/contracts/api";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { defaultStringifySearch, useSearch, useNavigate } from "@tanstack/react-router";
import * as Collections from "@open-erp/contracts/collections";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Crm from "@open-erp/contracts/crm-master";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { workspacePath } from "@/lib/book-context";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

export function ReminderReview({
  book,
  locale,
  initialReminderId = "",
}: CommerceProps & {
  readonly initialReminderId?: string;
}) {
  const navigate = useNavigate();
  const sv = locale === "sv";
  const [issueEntry, setIssueEntry] = useState("");
  const [issueId, setIssueId] = useState("");
  const [reminderId, setReminderId] = useState(initialReminderId);
  const [message, setMessage] = useState<typeof Collections.ReminderMessage.Type | null>(null);
  const base = `${commercePath(book)}/collections/reminders`;

  const issue = useQuery({
    queryKey: [...commerceKey(book), "reminder-issue", issueId],
    enabled: issueId !== "",
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.arLegalIssue.getArLegalIssue({ params: { ...bookScope(book), id: issueId } }),
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
        (client) =>
          client.crmMaster.crmCustomerRecipient({
            params: { ...bookScope(book), partyId: customerId },
            query: httpQuery(Api.groups.crmMaster.endpoints.crmCustomerRecipient, ``),
          }),
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
        (client) =>
          client.collections.readReminder({ params: { ...bookScope(book), id: reminderId } }),
        Collections.ReminderView,
        { signal },
      );

      checkScope(book, result.message.scope);

      if (result.message.id !== reminderId) throw new Error("Reminder identity mismatch.");

      return result;
    },
  });

  const currentMessage = retained.isError ? null : (retained.data?.message ?? message);
  const view = retained.isError ? undefined : retained.data;
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
            {issue.data.legalDocumentNumber}, {destination.destination}
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
              void navigate({
                to: `${workspacePath(book)}/sales`,
                search: { view: "collections", reminder: result.id },
              });
            }}
            operation={(client, requestOptions) =>
              client.collections.prepareReminder(
                httpRequest(
                  Api.groups.collections.endpoints.prepareReminder,
                  { params: { ...bookScope(book) } },
                  requestOptions,
                ),
              )
            }
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

export function ReminderPreview({
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
  const search = useSearch({ strict: false });

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
      <Link
        href={`${workspacePath(book)}/sales${defaultStringifySearch({ ...search, view: "collections", reminder: message.id })}`}
      >
        {sv ? "Öppna sparad påminnelse" : "Open retained reminder"}
      </Link>
      <Text>
        <strong>{message.recipient.destination}</strong>
      </Text>
      <Text>{message.subject}</Text>
      <Text>
        {sv ? "Förberett belopp" : "Prepared amount"},{" "}
        {formatMinorAmount(message.outstandingMinor, 2, locale)} SEK
      </Text>
      <Box overflow="auto" minWidth="zero">
        <pre>{message.plainText}</pre>
      </Box>
      <Text>{sv ? "HTML-meddelandets exakta innehåll" : "Exact HTML message content"}</Text>
      <Box overflow="auto" minWidth="zero">
        <pre>{message.html}</pre>
      </Box>
      <Text>
        {message.attachments
          .map((attachment) => `${attachment.filename}, ${attachment.byteLength} bytes`)
          .join(", ") || (sv ? "Uppgift saknas" : "Unavailable")}
      </Text>
      <Text role="status">{reminderStatus(view, locale, statuses)}</Text>
      {view?.currentOutstandingMinor !== null && view?.currentOutstandingMinor !== undefined ? (
        <Text>
          {sv ? "Nuvarande obetalda belopp" : "Current outstanding amount"},{" "}
          {formatMinorAmount(view.currentOutstandingMinor, 2, locale)} SEK
        </Text>
      ) : null}
      {view?.approval ? (
        <Text>
          {sv ? "Godkännandet gäller till" : "Approval expires at"} {view.approval.expiresAt}
        </Text>
      ) : null}
      {view?.reason ? <Text>{view.reason}</Text> : null}
      <ReminderApprovalCheck book={book} locale={locale} message={message} view={view} />
      <ReminderReplacementLink book={book} locale={locale} view={view} />
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
          operation={(client, requestOptions) =>
            client.collections.approveReminder(
              httpRequest(
                Api.groups.collections.endpoints.approveReminder,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            )
          }
        />
      ) : null}
      {view?.status === "approved" && view.approvalUsable && !view.attempt ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/${message.id}/dispatch`}
          schema={Collections.ReminderCommand}
          output={Collections.ReminderView}
          allowed={book.role === "operator"}
          label={sv ? "Skicka påminnelsen" : "Send reminder"}
          input={() => ({ messageDigest: message.digest })}
          operation={(client, requestOptions) =>
            client.collections.requestReminderDispatch(
              httpRequest(
                Api.groups.collections.endpoints.requestReminderDispatch,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            )
          }
        />
      ) : null}
      <ReminderCancellation book={book} locale={locale} message={message} view={view} />
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
          operation={(client, requestOptions) =>
            client.collections.reconcileReminder(
              httpRequest(
                Api.groups.collections.endpoints.reconcileReminder,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            )
          }
        />
      ) : null}
    </Box>
  );
}

function reminderStatus(
  view: typeof Collections.ReminderView.Type | undefined,
  locale: CommerceProps["locale"],
  statuses: Readonly<Record<typeof Collections.ReminderView.Type.status, string>>,
) {
  if (view?.resolution?.kind === "replaced")
    return locale === "sv" ? "Ersatt av en ny påminnelse" : "Replaced by a new reminder";

  if (view?.status === "approved" && !view.approvalUsable)
    return locale === "sv" ? "Godkännandet gäller inte längre" : "Approval no longer usable";

  return statuses[view?.status ?? "prepared"];
}

function ReminderReplacementLink({
  book,
  locale,
  view,
}: CommerceProps & {
  view: typeof Collections.ReminderView.Type | undefined;
}) {
  const search = useSearch({ strict: false });

  if (view?.resolution?.kind !== "replaced") return null;

  return (
    <Link
      href={`${workspacePath(book)}/sales${defaultStringifySearch({ ...search, view: "collections", reminder: view.resolution.replacementMessageId })}`}
    >
      {locale === "sv" ? "Öppna den nya påminnelsen" : "Open the new reminder"}
    </Link>
  );
}

function ReminderApprovalCheck({
  book,
  locale,
  message,
  view,
}: CommerceProps & {
  message: typeof Collections.ReminderMessage.Type;
  view: typeof Collections.ReminderView.Type | undefined;
}) {
  if (!view?.approval || view.approvalUsable || view.attempt || view.resolution) return null;

  return (
    <CommandForm
      book={book}
      locale={locale}
      path={`${commercePath(book)}/collections/reminders/${message.id}/checks`}
      schema={Collections.ReminderCommand}
      output={Collections.ReminderView}
      label={
        locale === "sv"
          ? "Kontrollera godkännandet mot aktuella uppgifter"
          : "Check approval against current facts"
      }
      input={() => ({ messageDigest: message.digest })}
      operation={(client, requestOptions) =>
        client.collections.checkReminder(
          httpRequest(
            Api.groups.collections.endpoints.checkReminder,
            { params: { ...bookScope(book), id: message.id } },
            requestOptions,
          ),
        )
      }
    />
  );
}

function ReminderCancellation({
  book,
  locale,
  message,
  view,
}: CommerceProps & {
  message: typeof Collections.ReminderMessage.Type;
  view: typeof Collections.ReminderView.Type | undefined;
}) {
  if (!view || view.attempt || view.resolution || view.status === "cancelled") return null;

  return (
    <CommandForm
      book={book}
      locale={locale}
      path={`${commercePath(book)}/collections/reminders/${message.id}/cancel`}
      schema={Collections.ReminderCommand}
      output={Collections.ReminderView}
      allowed={book.role === "operator"}
      label={locale === "sv" ? "Avbryt före leveransförsök" : "Cancel before dispatch admission"}
      input={() => ({ messageDigest: message.digest })}
      operation={(client, requestOptions) =>
        client.collections.cancelReminder(
          httpRequest(
            Api.groups.collections.endpoints.cancelReminder,
            { params: { ...bookScope(book), id: message.id } },
            requestOptions,
          ),
        )
      }
    />
  );
}

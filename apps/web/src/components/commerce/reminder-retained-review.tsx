import { bookScope } from "@/lib/contract-client";
import { useQuery } from "@tanstack/react-query";
import { defaultStringifySearch, useSearch } from "@tanstack/react-router";
import * as Collections from "@open-erp/contracts/collections";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  RetainedActionLayout,
  AssetActionMetadata,
  AssetActionSection,
  AssetActionActions,
  AssetActionNote,
} from "@open-erp/ui/components/asset-action";
import {
  ReminderBasisComparison,
  ReminderPaymentEvidence,
  ReminderPaymentLink,
  ReminderReviewAlert,
} from "@open-erp/ui/components/reminder-review";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { loanDate } from "../treasury-loan-format";
import { ReminderMessageWorkspace } from "./reminder-message-workspace";
import { checkScope, CommandForm, commerceKey, commercePath } from "./shared";

export function ReminderRetainedWorkspace({ id }: { id: string }) {
  const { book, locale } = useBookWorkspace();

  const retained = useQuery({
    queryKey: [...commerceKey(book), "reminder", id],
    refetchInterval: 2000,
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        (client) => client.collections.readReminder({ params: { ...bookScope(book), id: id } }),
        Collections.ReminderView,
        { signal },
      );

      checkScope(book, view.message.scope);

      if (view.message.id !== id) throw new Error("Reminder identity mismatch.");

      return view;
    },
  });

  return (
    <>
      <AccountingStatus locale={locale} pending={retained.isPending} error={retained.error} />
      {retained.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void retained.refetch();
          }}
        >
          Försök igen
        </Button>
      ) : null}
      {retained.data && !retained.isError ? (
        <ReminderRetainedReview
          key={`${book.id}-${retained.data.message.id}`}
          view={retained.data}
          refresh={() => {
            void retained.refetch();
          }}
        />
      ) : null}
    </>
  );
}

function reminderTime(value: string, date = true) {
  const time = new Intl.DateTimeFormat("sv", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));

  if (!date) return time;

  const day = new Intl.DateTimeFormat("sv", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Stockholm",
  })
    .format(new Date(value))
    .replaceAll(".", "");

  return `${day} ${time}`;
}

function ReminderRetainedReview(props: {
  view: typeof Collections.ReminderView.Type;
  refresh: () => void;
}) {
  const { book, locale } = useBookWorkspace();
  const search = useSearch({ strict: false });
  const { view } = props;
  const { message, current, approval } = view;
  const base = `${commercePath(book)}/collections/reminders/${encodeURIComponent(message.id)}`;
  const sales = `${workspacePath(book)}/sales`;

  const changed =
    current.outstandingMinor !== null && current.outstandingMinor !== message.outstandingMinor;

  const format = (amount: string) => formatMinorAmount(amount, 2, locale);

  const now =
    current.outstandingMinor === null ? "Uppgift saknas" : format(current.outstandingMinor);

  if (!approval || view.attempt || !changed || !view.refusal?.reasons.includes("amount_changed"))
    return <ReminderMessageWorkspace view={view} refresh={props.refresh} />;

  const recipientChanged = view.approvalBlockers.includes("recipient_changed");
  const disputeChanged = view.approvalBlockers.includes("dispute_changed");
  const preparedDisputes = message.reviewBasis?.openDisputes;
  const terminal = view.resolution;

  const payments = current.settlements.filter(
    (payment) => Date.parse(payment.committedAt) > Date.parse(approval.approvedAt),
  );

  return (
    <RetainedActionLayout
      title={`Påminnelse, ${message.invoiceNumber} skickades inte`}
      blocked="Godkännandet gäller inte längre"
      trail={[
        { label: "Försäljning", href: sales },
        { label: "Fakturor", href: `${sales}?view=invoices` },
        { label: `${message.invoiceNumber}, påminnelse` },
      ]}
    >
      <AssetActionMetadata>
        {current.customerName}, förföll {loanDate(message.dueOn, locale)}.
      </AssetActionMetadata>
      <ReminderReviewAlert>
        Beloppet ändrades efter att innehållet godkändes. Godkännandet gällde exakt det innehåll som
        godkändes, så ingen påminnelse skickades. Meddelandet nämner{" "}
        {format(message.outstandingMinor)} men obetalt belopp är nu {now}.
      </ReminderReviewAlert>
      <AssetActionSection afterAlert>GODKÄNT INNEHÅLL MOT NU</AssetActionSection>
      <ReminderBasisComparison
        approvedAt={reminderTime(approval.approvedAt)}
        checkedAt={reminderTime(current.checkedAt)}
        rows={[
          {
            label: "Obetalt belopp",
            approved: format(message.outstandingMinor),
            current: now,
            state: "Ändrat",
            changed: true,
          },
          {
            label: "Mottagare",
            approved: message.recipient.destination,
            current: current.recipient?.destination ?? "Uppgift saknas",
            state: recipientChanged ? "Ändrad" : "Oförändrad",
          },
          {
            label: "Tvist",
            approved:
              preparedDisputes === undefined
                ? "Uppgift saknas"
                : preparedDisputes === 0
                  ? "Ingen"
                  : String(preparedDisputes),
            current: current.openDisputes === 0 ? "Ingen" : String(current.openDisputes),
            state: disputeChanged ? "Ändrad" : "Oförändrad",
          },
          {
            label: "Godkännandet",
            approved: `Gällde till ${reminderTime(approval.expiresAt, false)}`,
            current: "Ogiltigt, innehållet ändrades",
            state: "Inget skickat",
            invalid: true,
          },
        ]}
      />
      <AssetActionSection afterAlert>VARFÖR BELOPPET ÄNDRADES</AssetActionSection>
      {payments.map((payment) => (
        <ReminderPaymentEvidence key={payment.receiptId}>
          <span>
            Betalning {format(payment.amountMinor)} registrerades{" "}
            {reminderTime(payment.committedAt)} på {message.invoiceNumber}
          </span>
          <ReminderPaymentLink
            href={`${sales}${defaultStringifySearch({ ...search, view: "invoices", reminder: undefined, record: message.invoiceId, kind: "invoice", stage: "payments", allocation: payment.planId })}`}
          />
        </ReminderPaymentEvidence>
      ))}
      {!payments.length ? (
        <AssetActionNote>
          Ingen senare betalning finns i fakturans betalningshistorik.
        </AssetActionNote>
      ) : null}
      <AssetActionActions>
        {!terminal && view.replacementAllowed && current.recipient ? (
          <CommandForm
            book={book}
            locale={locale}
            compact
            path={`${base}/replacement`}
            schema={Collections.ReplaceReminder}
            output={Collections.ReminderReplacement}
            allowed={book.role === "operator"}
            label={`Förbered ny påminnelse på ${now}`}
            input={() => ({
              messageDigest: message.digest,
              recipient: current.recipient && {
                partyId: current.recipient.partyId,
                revision: current.recipient.revision,
                digest: current.recipient.digest,
              },
            })}
            onSuccess={props.refresh}
          />
        ) : null}
        {!terminal ? (
          <CommandForm
            book={book}
            locale={locale}
            compact
            variant="outline"
            path={`${base}/cancel`}
            schema={Collections.ReminderCommand}
            output={Collections.ReminderView}
            allowed={book.role === "operator"}
            label="Avbryt påminnelsen"
            input={() => ({ messageDigest: message.digest })}
            onSuccess={props.refresh}
          />
        ) : null}
        {terminal?.kind === "replaced" ? (
          <Link
            href={`${sales}${defaultStringifySearch({ ...search, view: "collections", reminder: terminal.replacementMessageId })}`}
          >
            Öppna den nya påminnelsen
          </Link>
        ) : null}
      </AssetActionActions>
      {terminal?.kind === "cancelled" ? (
        <AssetActionNote status>Påminnelsen är avbruten. Inget skickades.</AssetActionNote>
      ) : null}
      {terminal?.kind === "replaced" ? (
        <AssetActionNote status>
          En ny påminnelse är förberedd och behöver ett eget godkännande.
        </AssetActionNote>
      ) : null}
      <AssetActionNote>
        Den nya påminnelsen skrivs om från fakturans uppgifter och behöver ett eget godkännande som
        gäller i 15 minuter. Ändras fakturan eller en tvist läggs till kommer samma sak att hända
        igen. En påminnelse som redan skickats ändras aldrig i efterhand.
      </AssetActionNote>
    </RetainedActionLayout>
  );
}

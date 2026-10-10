import * as Match from "effect/Match";
import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import * as Collections from "@open-erp/contracts/collections";
import * as LegalPdf from "@open-erp/contracts/legal-invoice-pdf";
import { ReminderWorkspacePart } from "@open-erp/ui/components/reminder-workspace";
import { PdfThumbnail } from "@open-erp/ui/components/pdf-thumbnail";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath, useBookWorkspace } from "@/lib/book-context";
import { authClient } from "@/lib/auth-client";
import { CommandForm, commercePath } from "./shared";

type View = typeof Collections.ReminderView.Type;

export function ReminderMessageWorkspace({ view, refresh }: { view: View; refresh: () => void }) {
  const { book, locale } = useBookWorkspace();
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptExpanded, setReceiptExpanded] = useState(false);

  const { message } = view;
  const base = `${commercePath(book)}/collections/reminders/${encodeURIComponent(message.id)}`;
  const invoiceHref = `${workspacePath(book)}/sales?view=invoices&record=${encodeURIComponent(message.invoiceId)}&kind=invoice`;
  const cancelled = view.resolution?.kind === "cancelled";

  const review =
    !view.attempt &&
    !view.resolution &&
    (view.status === "prepared" || (view.status === "approved" && view.approvalUsable));

  const command = (
    action: "dispatch" | "reconcile" | "cancel" | "checks",
    label: string,
    variant?: "outline",
  ) => (
    <CommandForm
      key={`${action}-${view.outcomeCheck?.checkpoint ?? 0}`}
      book={book}
      locale={locale}
      compact
      fullWidthSubmit
      canSubmit={action !== "reconcile" || !["admitted", "reconciling"].includes(view.status)}
      path={`${base}/${action}`}
      operation={(client, requestOptions) =>
        Match.value(action).pipe(
          Match.when("dispatch", () =>
            client.collections.requestReminderDispatch(
              httpRequest(
                Api.groups.collections.endpoints.requestReminderDispatch,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            ),
          ),
          Match.when("reconcile", () =>
            client.collections.reconcileReminder(
              httpRequest(
                Api.groups.collections.endpoints.reconcileReminder,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            ),
          ),
          Match.when("cancel", () =>
            client.collections.cancelReminder(
              httpRequest(
                Api.groups.collections.endpoints.cancelReminder,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            ),
          ),
          Match.when("checks", () =>
            client.collections.checkReminder(
              httpRequest(
                Api.groups.collections.endpoints.checkReminder,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            ),
          ),
          Match.exhaustive,
        )
      }
      schema={Collections.ReminderCommand}
      output={Collections.ReminderView}
      allowed={book.role === "operator"}
      label={label}
      variant={variant}
      input={() => ({ messageDigest: message.digest })}
      onSuccess={() => {
        setConfirmCancellation(false);
        refresh();
      }}
    />
  );

  return (
    <ReminderWorkspacePart as="section" part="page">
      <ReminderWorkspacePart as="header" part="header">
        <ReminderWorkspacePart as="nav" aria-label="Försäljning" part="trail">
          <Link href={`${workspacePath(book)}/sales`}>Försäljning</Link>
          <span>/</span>
          <Link href={`${workspacePath(book)}/sales?view=invoices`}>Fakturor</Link>
          <span>/</span>
          <ReminderWorkspacePart as="span" part="current">
            Påminnelse, {message.invoiceNumber}
          </ReminderWorkspacePart>
        </ReminderWorkspacePart>
        {view.status === "prepared" && review && !confirmCancellation ? (
          <Box display="flex" gap="sm" alignItems="center">
            <ReminderApproval view={view} refresh={refresh} />
            <Button variant="outline" onClick={() => setConfirmCancellation(true)}>
              Avbryt påminnelsen
            </Button>
          </Box>
        ) : null}
      </ReminderWorkspacePart>
      <ReminderMetadata view={view} review={review} confirmCancellation={confirmCancellation} />
      <ReminderWorkspacePart as="div" part="split">
        <ReminderWorkspacePart as="div" part="content">
          {confirmCancellation ? (
            <>
              <ReminderWorkspacePart as="h1" part="pageTitle">
                Bekräfta att påminnelsen avbryts
              </ReminderWorkspacePart>
              <span>Påminnelse för {message.invoiceNumber}.</span>
              <span>Mottagare: {message.recipient.destination}</span>
              <span>
                Belopp: {reminderDisplayAmount(message.outstandingMinor)} kr, förfallodag{" "}
                {reminderDate(message.dueOn)}.
              </span>
              <span>Utskicket har inte påbörjats.</span>
            </>
          ) : cancelled ? (
            <>
              <ReminderWorkspacePart as="h1" part="pageTitle">
                Påminnelsen är avbruten
              </ReminderWorkspacePart>
              <span>Faktura {message.invoiceNumber} finns kvar.</span>
              <span>Det godkända påminnelseförslaget har avslutats.</span>
              <span>Inget utskick påbörjades.</span>
            </>
          ) : review || showMessage ? (
            <ReminderExactMessage view={view} />
          ) : (
            <ReminderAttemptHistory
              view={view}
              showReceipt={showReceipt}
              receiptExpanded={receiptExpanded}
            />
          )}
        </ReminderWorkspacePart>
        <ReminderWorkspacePart
          as="aside"
          aria-label="Påminnelsens nästa steg"
          part="actions"
          prepared={view.status === "prepared"}
        >
          {confirmCancellation ? (
            <>
              <ReminderWorkspacePart as="h2" part="title">
                Avbryt denna påminnelse?
              </ReminderWorkspacePart>
              <span>Det godkända förslaget avbryts. Fakturan är kvar.</span>
              <span>Ett redan påbörjat eller accepterat utskick kan inte tas tillbaka här.</span>
              {command("cancel", "Bekräfta och avbryt påminnelsen")}
              <Button variant="outline" onClick={() => setConfirmCancellation(false)}>
                Behåll påminnelsen
              </Button>
            </>
          ) : cancelled ? (
            <>
              <ReminderWorkspacePart as="h2" part="title">
                Påminnelse avbruten
              </ReminderWorkspacePart>
              <span>En ny påminnelse kräver ett nytt förslag och godkännande.</span>
              <Link href={invoiceHref}>Till fakturan</Link>
            </>
          ) : (
            <ReminderNextStep
              view={view}
              command={command}
              showMessage={() => setShowMessage(true)}
              refresh={refresh}
              invoiceHref={invoiceHref}
              showReceipt={showReceipt}
              openReceipt={() => setShowReceipt(true)}
              openReceiptDetails={() => setReceiptExpanded(true)}
              cancel={() => setConfirmCancellation(true)}
            />
          )}
        </ReminderWorkspacePart>
      </ReminderWorkspacePart>
    </ReminderWorkspacePart>
  );
}

function ReminderMetadata({
  view,
  review,
  confirmCancellation,
}: {
  view: View;
  review: boolean;
  confirmCancellation: boolean;
}) {
  const { message } = view;

  return (
    <ReminderWorkspacePart
      as="div"
      part={
        view.attempt &&
        (view.outcomeCheck?.checkpoint ?? 0) === 0 &&
        view.status !== "failed" &&
        view.status !== "provider_accepted" &&
        view.status !== "delivered"
          ? "outcomeMetadata"
          : "metadata"
      }
    >
      {view.status === "prepared" && review && !confirmCancellation
        ? `Förberedd av ${message.preparedByName ?? message.preparedBy} ${reminderTime(message.preparedAt)}. Mottagare, text och bilaga granskas tillsammans.`
        : view.status === "approved" &&
            !confirmCancellation &&
            !view.attempt &&
            view.approvalUsable &&
            view.approval
          ? `Godkänt av ${view.approval.approvedByName ?? view.approval.approvedBy} ${reminderTime(view.approval.approvedAt)}. Inget utskick har påbörjats.`
          : view.attempt &&
              (view.outcomeCheck?.checkpoint ?? 0) === 0 &&
              view.status === "outcome_unknown"
            ? "? Okänt utfall. Mejlet kan ha skickats. Utred innan du försöker igen."
            : `${message.invoiceNumber}, ${reminderDisplayAmount(message.outstandingMinor)} kr. Förfallodag ${reminderDate(message.dueOn)}.`}
    </ReminderWorkspacePart>
  );
}

function ReminderApproval({ view, refresh }: { view: View; refresh: () => void }) {
  const { book, locale } = useBookWorkspace();

  return (
    <CommandForm
      book={book}
      locale={locale}
      compact
      path={`${commercePath(book)}/collections/reminders/${encodeURIComponent(view.message.id)}/approvals`}
      schema={Collections.ApproveReminder}
      output={Collections.ReminderView}
      allowed={book.role === "operator"}
      label="Godkänn utskick"
      input={() => ({ messageDigest: view.message.digest, acknowledgeExactMessage: true })}
      onSuccess={refresh}
      operation={(client, requestOptions) =>
        client.collections.approveReminder(
          httpRequest(
            Api.groups.collections.endpoints.approveReminder,
            { params: { ...bookScope(book), id: view.message.id } },
            requestOptions,
          ),
        )
      }
    />
  );
}

function ReminderExactMessage({ view }: { view: View }) {
  const { message } = view;

  return (
    <>
      <ReminderWorkspacePart as="h1" part="title">
        Det här skickas
      </ReminderWorkspacePart>
      <ReminderWorkspacePart as="div" part="card">
        <ReminderWorkspacePart as="div" part="row">
          <ReminderWorkspacePart as="span" part="muted">
            Till
          </ReminderWorkspacePart>
          <span>{message.recipient.destination}</span>
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="div" part="row">
          <ReminderWorkspacePart as="span" part="muted">
            Från
          </ReminderWorkspacePart>
          <span>{message.senderName ?? "Uppgift saknas"}</span>
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="div" part="row">
          <ReminderWorkspacePart as="span" part="muted">
            Ämne
          </ReminderWorkspacePart>
          <ReminderWorkspacePart as="span" part="subject">
            {message.subject}
          </ReminderWorkspacePart>
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="div" part="note">
          E-post med fakturan som PDF. Ingen påminnelseavgift eller ränta ingår.
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="pre" part="body">
          {message.plainText}
        </ReminderWorkspacePart>
      </ReminderWorkspacePart>
      <ReminderWorkspacePart as="h2" part="title">
        Bilaga
      </ReminderWorkspacePart>
      {message.attachments.map((attachment) => (
        <ReminderAttachment key={attachment.captureId} attachment={attachment} />
      ))}
      {message.attachments.length === 0 ? <span>Uppgift saknas</span> : null}
    </>
  );
}

function ReminderAttachment({
  attachment,
}: {
  attachment: typeof Collections.ReminderAttachment.Type;
}) {
  const { book } = useBookWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const pdf = useQuery({
    queryKey: ["reminder-attachment", book.id, attachment.captureId, attachment.sha256],
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        (client) =>
          client.legalInvoicePdfs.getLegalInvoicePdf({
            params: { ...bookScope(book), id: attachment.captureId },
          }),
        LegalPdf.LegalInvoicePdfView,
        { signal },
      );

      const artifact = view.artifact;

      if (
        !artifact ||
        artifact.captureDigest !== attachment.captureDigest ||
        artifact.sha256 !== attachment.sha256 ||
        artifact.byteLength !== attachment.byteLength
      )
        throw new Error("Bilagan stämmer inte med det godkända innehållet.");

      const bytes = Uint8Array.from(atob(artifact.contentBase64), (character) =>
        character.charCodeAt(0),
      );

      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");

      if (bytes.byteLength !== attachment.byteLength || hash !== attachment.sha256)
        throw new Error("Bilagan stämmer inte med det godkända innehållet.");

      return { artifact, bytes };
    },
  });

  async function open() {
    setOpening(true);
    setError(null);

    try {
      const retained = pdf.data ?? (await pdf.refetch().then((result) => result.data));

      if (!retained) throw new Error("Bilagan kunde inte öppnas.");
      const bytes = retained.bytes;

      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = attachment.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bilagan kunde inte öppnas.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <ReminderWorkspacePart as="div" part="attachment">
      {pdf.data ? (
        <PdfThumbnail
          content={pdf.data.artifact.contentBase64}
          filename={attachment.filename}
          locale="sv"
          compact
        />
      ) : null}
      <ReminderWorkspacePart as="div" part="attachmentDetails">
        <ReminderWorkspacePart as="span" part="subject">
          {attachment.filename}
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="span" part="caption">
          Fakturan,{" "}
          {new Intl.NumberFormat("sv", { maximumFractionDigits: 1 }).format(
            attachment.byteLength / 1000,
          )}{" "}
          kB
        </ReminderWorkspacePart>
        <Button
          variant="link"
          disabled={opening}
          onClick={() => {
            void open();
          }}
        >
          Öppna bilagan
        </Button>
        {error || pdf.error ? (
          <ReminderWorkspacePart as="span" role="alert" part="error">
            {error ?? pdf.error?.message}
          </ReminderWorkspacePart>
        ) : null}
      </ReminderWorkspacePart>
    </ReminderWorkspacePart>
  );
}

function reminderTime(value: string) {
  return new Intl.DateTimeFormat("sv", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  })
    .format(new Date(value))
    .replaceAll(".", "");
}

function reminderDate(value: string) {
  return new Intl.DateTimeFormat("sv", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Stockholm",
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replaceAll(".", "");
}

function reminderDisplayAmount(value: string) {
  return reminderAmount(value).replace(/,00$/, "");
}

function reminderAmount(value: string) {
  const minor = BigInt(value);

  return `${new Intl.NumberFormat("sv").format(minor / 100n)},${(minor % 100n).toString().padStart(2, "0")}`;
}

function ReminderAttemptHistory({
  view,
  showReceipt,
  receiptExpanded,
}: {
  view: View;
  showReceipt: boolean;
  receiptExpanded: boolean;
}) {
  const checked = (view.outcomeCheck?.checkpoint ?? 0) > 0;
  const accepted = view.status === "provider_accepted" || view.status === "delivered";

  const receipt = view.observations.find(
    (observation) => observation.kind === "accepted" || observation.kind === "delivered",
  );

  if (accepted && checked && !showReceipt)
    return (
      <>
        <ReminderWorkspacePart as="h1" part="pageTitle">
          Utredningen hittade e-posttjänstens kvittens
        </ReminderWorkspacePart>
        <span>Samma utskick: {receipt?.observationId ?? view.attempt?.id}</span>
        <span>Påbörjat {view.attempt && reminderTime(view.attempt.admittedAt)}.</span>
        <span>E-posttjänstens kvittens är kopplad.</span>
        <span>Mottagare och faktura stämmer med det godkända innehållet.</span>
      </>
    );

  if (accepted)
    return (
      <>
        <ReminderWorkspacePart as="h1" part="pageTitle">
          E-posttjänsten har accepterat påminnelsen
        </ReminderWorkspacePart>
        <span>Skickad {view.attempt && reminderTime(view.attempt.admittedAt)}.</span>
        <span>E-posttjänstens kvittens: {receipt?.observationId ?? "Uppgift saknas"}</span>
        <span>Mottagare: {view.message.recipient.destination}</span>
        <span>
          Faktura: {view.message.invoiceNumber}, {reminderAmount(view.message.outstandingMinor)} kr
        </span>
        {view.message.attachments.map((attachment) => (
          <span key={attachment.captureId}>Bilaga: {attachment.filename}</span>
        ))}
        {receiptExpanded ? (
          <details open>
            <summary>E-posttjänstens kvittens</summary>
            <Box display="grid" gap="sm">
              <span>{receipt?.observationId}</span>
              <span>{receipt && reminderTime(receipt.recordedAt)}</span>
              <span>Mottagare: {view.message.recipient.destination}</span>
            </Box>
          </details>
        ) : null}
      </>
    );

  if (view.status === "failed")
    return (
      <>
        <ReminderWorkspacePart as="h1" part="pageTitle">
          E-posttjänsten bekräftar att utskicket inte accepterades
        </ReminderWorkspacePart>
        <span>Samma utskick: {view.attempt?.id}</span>
        <span>Leverantörens definitiva besked är kopplat.</span>
        <span>Inget accepterat meddelande skapades för försöket.</span>
        <span>Kontrollera att fakturan fortfarande är obetald.</span>
      </>
    );

  if (view.attempt && checked)
    return (
      <>
        <ReminderWorkspacePart as="h1" part="pageTitle">
          Påminnelsens utfall är fortfarande okänt
        </ReminderWorkspacePart>
        <span>Samma utskick: {view.attempt.id}</span>
        <span>E-posttjänsten saknar ett definitivt svar.</span>
        <span>
          Ett tomt sökresultat eller uteblivet svar från kunden styrker inte att utskicket
          misslyckades.
        </span>
      </>
    );

  if (view.attempt)
    return (
      <>
        <ReminderWorkspacePart as="h1" part="title">
          Vad som hände
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="ol" part="timeline">
          <ReminderWorkspacePart as="li" part="timelineRow">
            <ReminderWorkspacePart as="span" part="muted">
              {reminderTime(view.message.preparedAt)}
            </ReminderWorkspacePart>
            <span>Förberedd av {view.message.preparedByName ?? view.message.preparedBy}</span>
          </ReminderWorkspacePart>
          {view.approval ? (
            <ReminderWorkspacePart as="li" part="timelineRow">
              <ReminderWorkspacePart as="span" part="muted">
                {reminderTime(view.approval.approvedAt)}
              </ReminderWorkspacePart>
              <span>Godkänd av {view.approval.approvedByName ?? view.approval.approvedBy}</span>
            </ReminderWorkspacePart>
          ) : null}
          <ReminderWorkspacePart as="li" part="timelineRow">
            <ReminderWorkspacePart as="span" part="muted">
              {reminderTime(view.attempt.admittedAt)}
            </ReminderWorkspacePart>
            <span>Utskicket började</span>
          </ReminderWorkspacePart>
          <ReminderWorkspacePart as="li" part="timelineRow">
            <ReminderWorkspacePart as="span" part="muted">
              {reminderTime(view.attempt.admittedAt)}
            </ReminderWorkspacePart>
            <span>Okänt utfall: e-posttjänsten svarade inte</span>
          </ReminderWorkspacePart>
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="h2" part="title">
          Meddelandet som godkändes
        </ReminderWorkspacePart>
        <ReminderWorkspacePart part="summary">
          Till {view.message.recipient.destination}
          <br />
          Ämne {view.message.subject}
          <br />
          {view.message.attachments.map((attachment) => (
            <span key={attachment.captureId}>
              Bilaga {attachment.filename}
              <br />
            </span>
          ))}
          Obetalt belopp {reminderAmount(view.message.outstandingMinor)} kr. Ingen avgift eller
          ränta ingår.
        </ReminderWorkspacePart>
      </>
    );

  return (
    <>
      <ReminderWorkspacePart as="h1" part="pageTitle">
        Påminnelsens godkännande gäller inte längre
      </ReminderWorkspacePart>
      <span>
        {view.approvalBlockers.includes("approval_expired")
          ? "Godkännandet har gått ut."
          : "Innehållet ändrades efter godkännandet."}
      </span>
      <span>Tidigare godkänd mottagare: {view.message.recipient.destination}</span>
      <span>Text och bilaga behöver jämföras med det aktuella förslaget.</span>
      <span>Inget nytt utskick har påbörjats.</span>
    </>
  );
}

type ReminderNextStepProps = {
  view: View;
  command: (
    action: "dispatch" | "reconcile" | "cancel" | "checks",
    label: string,
    variant?: "outline",
  ) => ReactNode;
  showMessage: () => void;
  refresh: () => void;
  invoiceHref: string;
  showReceipt: boolean;
  openReceipt: () => void;
  openReceiptDetails: () => void;
  cancel: () => void;
};

function ReminderNextStep(props: ReminderNextStepProps) {
  const { view, command, refresh } = props;
  const { book, locale } = useBookWorkspace();

  const session = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const result = await authClient.getSession();

      if (result.error) throw new Error(result.error.message ?? "Session unavailable");

      return result.data;
    },
  });

  const { message } = view;
  const base = `${commercePath(book)}/collections/reminders/${encodeURIComponent(message.id)}`;

  if (view.resolution?.kind === "replaced")
    return (
      <>
        <ReminderWorkspacePart as="h2" part="title">
          Ny granskning behövs
        </ReminderWorkspacePart>
        <Link
          href={`${workspacePath(book)}/sales?view=collections&reminder=${encodeURIComponent(view.resolution.replacementMessageId)}`}
        >
          Öppna den nya påminnelsen
        </Link>
        <span>En ny påminnelse är förberedd och behöver ett eget godkännande.</span>
      </>
    );

  if (view.status === "prepared")
    return (
      <>
        <ReminderWorkspacePart as="h2" part="title">
          Steg
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="div" part="stepRow">
          <span>1. Godkännande, {session.data?.user.name ?? "Uppgift saknas"}</span>
          <ReminderWorkspacePart as="span" part="warning">
            Väntar på dig
          </ReminderWorkspacePart>
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="div" part="stepRow">
          <span>2. Utskick</span>
          <ReminderWorkspacePart as="span" part="muted">
            Efter godkännande
          </ReminderWorkspacePart>
        </ReminderWorkspacePart>
        <ReminderWorkspacePart as="div" part="stepNote">
          Godkännandet gäller mottagare, text och bilaga. Utskicket görs i nästa steg.
        </ReminderWorkspacePart>
      </>
    );

  if (view.status === "approved" && view.approvalUsable && !view.attempt)
    return (
      <>
        <ReminderWorkspacePart as="h2" part="title">
          Godkänt innehåll
        </ReminderWorkspacePart>
        <span>Kontrollera att fakturan fortfarande är obetald innan utskicket.</span>
        <span>Ändrat innehåll kräver nytt godkännande.</span>
        {command("dispatch", "Skicka påminnelsen")}
        <Button variant="outline" onClick={props.cancel}>
          Avbryt påminnelsen
        </Button>
      </>
    );

  if (view.status === "provider_accepted" || view.status === "delivered")
    return <ReminderAcceptedActions {...props} />;

  if (view.attempt && view.status !== "failed") return <ReminderUnknownActions {...props} />;

  return (
    <>
      <ReminderWorkspacePart as="h2" part="title">
        {view.attempt ? "Ny påminnelse kan förberedas" : "! Ny granskning behövs"}
      </ReminderWorkspacePart>
      <span>
        {view.attempt
          ? `${message.preparedByName ?? message.preparedBy} granskar mottagare, text, bilaga och obetalt belopp igen.`
          : `${message.preparedByName ?? message.preparedBy} förbereder det aktuella innehållet.`}
      </span>
      <span>
        {view.approval?.approvedByName ?? view.approval?.approvedBy ?? "Godkännaren"}{" "}
        {view.attempt
          ? "måste godkänna det aktuella förslaget före ett nytt utskick."
          : "måste godkänna den nya versionen."}
      </span>
      {view.replacementAllowed && view.current.recipient ? (
        <CommandForm
          book={book}
          locale={locale}
          compact
          fullWidthSubmit
          path={`${base}/replacement`}
          schema={Collections.ReplaceReminder}
          output={Collections.ReminderReplacement}
          allowed={book.role === "operator"}
          label={view.attempt ? "Öppna för ny granskning" : "Granska aktuellt innehåll"}
          input={() => ({
            messageDigest: message.digest,
            recipient: view.current.recipient && {
              partyId: view.current.recipient.partyId,
              revision: view.current.recipient.revision,
              digest: view.current.recipient.digest,
            },
          })}
          onSuccess={refresh}
          operation={(client, requestOptions) =>
            client.collections.replaceReminder(
              httpRequest(
                Api.groups.collections.endpoints.replaceReminder,
                { params: { ...bookScope(book), id: message.id } },
                requestOptions,
              ),
            )
          }
        />
      ) : null}
      <Button disabled variant="outline">
        {view.attempt ? "Skicka igen" : "Skicka påminnelsen"}
      </Button>
      <ReminderWorkspacePart as="span" part="muted">
        {view.attempt
          ? "Spärrad tills ny granskning och nytt godkännande är klara."
          : "Spärrad tills den aktuella versionen har godkänts."}
      </ReminderWorkspacePart>
    </>
  );
}

function ReminderUnknownActions({ view, command, showMessage }: ReminderNextStepProps) {
  const checked = (view.outcomeCheck?.checkpoint ?? 0) > 0;

  return (
    <>
      <ReminderWorkspacePart as="h2" part="title">
        {checked ? "? Utredningen pågår" : "Utred och registrera"}
      </ReminderWorkspacePart>
      {checked ? (
        <>
          <span>Behåll det ursprungliga försöket och komplettera underlaget.</span>
          <span>Godkännandet ger ingen rätt att skicka ett dubbelt meddelande.</span>
        </>
      ) : (
        <span>Kontrollera e-posttjänstens uppgift om samma utskick och spara underlaget.</span>
      )}
      {command(
        "reconcile",
        checked ? "Kontrollera samma utskick igen" : "Kontrollera samma utskick",
        checked ? undefined : "outline",
      )}
      {!checked ? (
        <Button variant="outline" onClick={showMessage}>
          Visa godkänt meddelande
        </Button>
      ) : null}
      <Button disabled variant="outline">
        Skicka igen
      </Button>
      <span>
        {checked
          ? "Spärrad tills ett definitivt utfall är styrkt."
          : "Spärrad tills samma utskicks utfall är styrkt. Inte skickat kräver ny granskning och nytt godkännande."}
      </span>
    </>
  );
}

function ReminderAcceptedActions(props: ReminderNextStepProps) {
  const view = props.view;

  const checked = (view.outcomeCheck?.checkpoint ?? 0) > 0;
  const invoiceHref = props.invoiceHref;

  return (
    <>
      <ReminderWorkspacePart as="h2" part="title">
        ✓ Accepterad av e-posttjänsten
      </ReminderWorkspacePart>
      {checked && !props.showReceipt ? (
        <>
          <span>Utfallet gäller det ursprungliga utskicket.</span>
          <span>
            {view.delivered
              ? "Leverans till mottagaren är bekräftad."
              : "Leverans till inkorgen är inte styrkt. Skicka inte igen."}
          </span>
          <Button onClick={props.openReceipt}>Spara utredning och visa kvittens</Button>
        </>
      ) : (
        <>
          <span>
            {view.delivered
              ? "Leverans till mottagaren är bekräftad."
              : "Leverans till mottagarens inkorg är inte bekräftad."}
          </span>
          <span>Påminnelsen skickas inte igen.</span>
          <Button onClick={props.openReceiptDetails}>Visa kvittens</Button>
          <Link href={invoiceHref}>Till fakturan</Link>
        </>
      )}
    </>
  );
}

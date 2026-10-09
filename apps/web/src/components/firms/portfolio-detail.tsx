import type * as Firms from "@open-erp/contracts/firms";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { ClientPeriod } from "./client-period";
import { ClientBank } from "./client-bank";
import { ClientDeadline } from "./client-deadline";
import { closingLabel } from "./client-closing";
import { readinessNames, readinessHelp } from "../closing/readiness-copy";
import {
  PortfolioDetailPanel,
  PortfolioDetailSection,
  PortfolioFactList,
} from "@open-erp/ui/components/firm-portfolio";
import { rememberPortfolio } from "./portfolio-return";
import type { PortfolioRow, RequestWorkspace } from "./portfolio-model";
import type { RequestEditor } from "./access-request-dialog";
import { workspacePath } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";

export function PortfolioDetail(props: {
  row: PortfolioRow | null;
  workspace: RequestWorkspace;
  locale: Locale;
  portfolioHref: string;
  onClientEdit: (client: typeof Firms.Client.Type) => void;
  onRequestEdit: (editor: RequestEditor) => void;
}) {
  const { row, workspace, locale } = props;
  const sv = locale === "sv";

  const label = sv ? "Klientdetaljer" : "Client details";

  if (!row)
    return (
      <PortfolioDetailPanel label={label}>
        <PageCaption>
          {sv ? "Välj en klient för att se detaljer." : "Select a client to see details."}
        </PageCaption>
      </PortfolioDetailPanel>
    );

  if (row.kind === "request")
    return (
      <RequestDetail
        request={row.request}
        workspace={workspace}
        locale={locale}
        onEdit={props.onRequestEdit}
      />
    );

  return (
    <PortfolioDetailPanel
      label={label}
      eyebrow={<PageCaption>{sv ? "Bokslutsstatus" : "Closing status"}</PageCaption>}
      title={closingLabel(row.closing, locale)}
      name={row.name}
      lead={leadName(row.client.leadId, row.client.leadAvailable, workspace, sv)}
      actions={
        <>
          <Link
            href={`${workspacePath(row.client.book)}/overview`}
            onClick={() => rememberPortfolio(row.client.book, props.portfolioHref)}
          >
            {sv ? `Öppna ${row.name}` : `Open ${row.name}`}
          </Link>
          {row.facts.period && row.facts.openTasks !== null ? (
            <Link
              href={`${workspacePath(row.client.book)}/work?status=open&period=${encodeURIComponent(row.facts.period.id)}`}
              onClick={() => rememberPortfolio(row.client.book, props.portfolioHref)}
            >
              {sv ? `Att granska (${row.facts.openTasks})` : `To review (${row.facts.openTasks})`}
            </Link>
          ) : null}
          {row.client.book.role === "operator" ? (
            <Button variant="ghost" onClick={() => props.onClientEdit(row.client)}>
              {sv ? "Byt ansvarig" : "Change accountant"}
            </Button>
          ) : null}
        </>
      }
    >
      {row.closing.kind === "blocked" ? (
        <PortfolioDetailSection
          title={sv ? "Innan perioden kan låsas" : "Before locking the period"}
        >
          <PortfolioFactList
            facts={row.closing.failed.map((check) => ({
              id: check.code,
              label: readinessNames.get(check.code)?.[locale] ?? check.code,
              detail: readinessHelp.get(check.code)?.[locale] ?? check.detail,
            }))}
          />
        </PortfolioDetailSection>
      ) : null}
      <PortfolioDetailSection title={sv ? "Senaste period" : "Latest period"}>
        <ClientPeriod
          book={row.client.book}
          period={row.facts.period}
          locale={locale}
          onOpen={() => rememberPortfolio(row.client.book, props.portfolioHref)}
        />
        <PageCaption>
          {sv
            ? "Tekniska kontroller fastställer inte fullständiga böcker eller lagstadgat bokslut."
            : "Technical checks do not establish complete books or statutory readiness."}
        </PageCaption>
      </PortfolioDetailSection>
      <PortfolioDetailSection
        region={sv ? "Bankavstämning" : "Bank reconciliation"}
        title={sv ? "Bankavstämning" : "Bank reconciliation"}
      >
        <ClientBank facts={row.facts} locale={locale} />
      </PortfolioDetailSection>
      <PortfolioDetailSection region="Deadlines" title={sv ? "Nästa deadline" : "Next deadline"}>
        <ClientDeadline deadline={row.deadline} locale={locale} />
      </PortfolioDetailSection>
      <PortfolioDetailSection title={sv ? "Nästa avstämning" : "Next review"}>
        <span>{row.client.nextReviewOn ?? "—"}</span>
        {row.client.note ? <PageCaption>{row.client.note}</PageCaption> : null}
      </PortfolioDetailSection>
      <PortfolioDetailSection title={sv ? "Din bokbehörighet" : "Your book access"}>
        <span>
          {row.client.book.role === "operator"
            ? sv
              ? "Operatörsbehörighet"
              : "Operator access"
            : sv
              ? "Agentbehörighet"
              : "Agent access"}
        </span>
        <PageCaption>
          {sv
            ? "Byråmedlemskap ger inga ytterligare bokbehörigheter."
            : "Firm membership grants no additional book permissions."}
        </PageCaption>
      </PortfolioDetailSection>
    </PortfolioDetailPanel>
  );
}

function RequestDetail(props: {
  request: Extract<PortfolioRow, { kind: "request" }>["request"];
  workspace: RequestWorkspace;
  locale: Locale;
  onEdit: (editor: RequestEditor) => void;
}) {
  const { request, workspace } = props;
  const sv = props.locale === "sv";
  const manage = workspace.firm.role === "admin" || request.requestedBy === workspace.actorId;

  return (
    <PortfolioDetailPanel
      label={sv ? "Klientdetaljer" : "Client details"}
      eyebrow={<PageCaption>{sv ? "Åtkomst begärd" : "Access requested"}</PageCaption>}
      title={request.clientName}
      lead={leadName(request.leadId, request.leadAvailable, workspace, sv)}
      actions={
        manage ? (
          <>
            <Button variant="outline" onClick={() => props.onEdit({ kind: "edit", request })}>
              {sv ? "Ändra förfrågan" : "Edit request"}
            </Button>
            <Button variant="ghost" onClick={() => props.onEdit({ kind: "revoke", request })}>
              {sv ? "Återkalla förfrågan" : "Revoke request"}
            </Button>
          </>
        ) : null
      }
    >
      {request.organizationNumber ? <span>{request.organizationNumber}</span> : null}
      <PageCaption>
        {sv
          ? "En lokal förfrågan. Bokföring visas först när du har bokbehörighet."
          : "A local request. Accounting appears once you have book access."}
      </PageCaption>
      <PageCaption>
        {sv ? "Begärd" : "Requested"}{" "}
        {new Intl.DateTimeFormat(props.locale, { dateStyle: "medium" }).format(
          new Date(request.createdAt),
        )}
      </PageCaption>
    </PortfolioDetailPanel>
  );
}

export function leadName(
  id: string | null,
  available: boolean,
  workspace: RequestWorkspace,
  sv: boolean,
) {
  return available
    ? (workspace.members.find((member) => member.actorId === id)?.name ??
        (sv ? "Ingen ansvarig" : "Unassigned"))
    : sv
      ? "Ingen ansvarig"
      : "Unassigned";
}

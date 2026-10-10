import { useState } from "react";
import * as Commerce from "@open-erp/contracts/commerce";
import {
  FormColumn,
  FormText as Text,
  FormNote as PageCaption,
  FormLink as Link,
  FormAction as Button,
  FormTitle,
  PlainFacts,
  RecordHeader,
  ActionRow,
  RecordSection,
} from "@open-erp/ui/kanon/form";
import { Action, InlineAction } from "@open-erp/ui/kanon/action";
import { PanelSection, DetailPanelActions } from "@open-erp/ui/kanon/detail-panel";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { defaultStringifySearch } from "@tanstack/react-router";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";
import { RecurringDraftRecovery } from "./recurring-draft-recovery";

type Props = CommerceProps & {
  agreementId: string;
  cycleOrdinal?: string;
  jobId?: string;
  work?: string;
  returnTo?: string;
  onEdit: (mode: "schedule" | "template") => void;
};

export function RecurringDetail(props: Props) {
  const { book, locale, agreementId, cycleOrdinal } = props;
  const { work, returnTo } = props;
  const sv = locale === "sv";
  const path = `${commercePath(book)}/recurring-invoices/${encodeURIComponent(agreementId)}`;
  const sales = `${workspacePath(book)}/sales`;

  const [showRecovery, setShowRecovery] = useState(Boolean(props.jobId));

  const agreement = useQuery({
    queryKey: [...commerceKey(book), "recurring-agreement", agreementId],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(path, Recurring.RecurringAgreementView, { signal });
      checkScope(book, value.agreement.scope);

      if (value.agreement.id !== agreementId)
        throw new Error("Recurring agreement identity mismatch");

      return value;
    },
    retry: false,
  });

  const customer = useQuery({
    queryKey: [...commerceKey(book), "party", agreement.data?.agreement.customerId],
    enabled: agreement.isSuccess,
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        `${commercePath(book)}/counterparties/${encodeURIComponent(agreement.data?.agreement.customerId ?? "")}`,
        Commerce.CounterpartyRevision,
        { signal },
      );

      checkScope(book, value.scope);

      if (value.id !== agreement.data?.agreement.customerId)
        throw new Error("Recurring customer mismatch");

      return value;
    },
    retry: false,
  });

  const occurrences = useInfiniteQuery({
    queryKey: [...commerceKey(book), "recurring-occurrences", agreementId],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams();

      if (pageParam) query.set("after", pageParam);

      const result = await readAccounting(
        `${path}/occurrences?${query}`,
        Recurring.RecurringOccurrenceList,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.agreementId !== agreementId)
        throw new Error("Recurring occurrence agreement mismatch");

      return result;
    },
    getNextPageParam: (page) => page.continuation ?? undefined,
    retry: false,
  });

  const occurrence = useQuery({
    queryKey: [...commerceKey(book), "recurring-occurrence", agreementId, cycleOrdinal],
    enabled: cycleOrdinal !== undefined,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${path}/occurrences/${encodeURIComponent(cycleOrdinal ?? "")}`,
        Recurring.RecurringOccurrenceView,
        { signal },
      );

      checkScope(book, result.occurrence.scope);

      if (
        result.occurrence.agreementId !== agreementId ||
        result.occurrence.cycleOrdinal !== cycleOrdinal
      )
        throw new Error("Recurring occurrence identity mismatch");

      for (const coverage of result.coverage) {
        checkScope(book, coverage.scope);

        if (
          coverage.agreementId !== agreementId ||
          coverage.occurrenceId !== result.occurrence.id ||
          coverage.draftId !== result.occurrence.draftId
        )
          throw new Error("Recurring coverage identity mismatch");
      }

      return result;
    },
    retry: false,
  });

  const items = occurrences.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = occurrence.isError ? undefined : occurrence.data;

  return (
    <>
      <AccountingStatus
        locale={locale}
        pending={agreement.isPending || customer.isPending}
        error={agreement.error ?? customer.error}
      />
      {agreement.data ? (
        <>
          <SavedAgreement view={agreement.data} customerName={customer.data?.displayName} sv={sv} />
        </>
      ) : null}
      {showRecovery ? <RecurringDraftRecovery {...props} embedded /> : null}
      <RecordSection label={sv ? "Fakturacykler" : "Invoice cycles"}>
        <AccountingStatus
          locale={locale}
          pending={occurrences.isPending}
          error={occurrences.error}
        />
        {occurrences.isSuccess && items.length === 0 ? (
          <Text>{sv ? "Inga skapade fakturacykler" : "No materialized invoice cycles"}</Text>
        ) : null}
        {items.map((item) => (
          <PlainFacts
            key={item.occurrenceId}
            align="end"
            facts={[
              {
                label: `${sv ? "Cykel" : "Cycle"} ${item.cycleOrdinal}`,
                renderLabel: (
                  <Link
                    href={`${sales}${defaultStringifySearch({ view: "recurring", record: agreementId, cycle: item.cycleOrdinal, work, returnTo })}`}
                  >
                    {sv ? "Cykel" : "Cycle"} {item.cycleOrdinal}
                  </Link>
                ),
                value: item.issued
                  ? sv
                    ? "Utfärdad"
                    : "Issued"
                  : item.approved
                    ? sv
                      ? "Godkänd"
                      : "Approved"
                    : item.prepared
                      ? sv
                        ? "Förberedd"
                        : "Prepared"
                      : sv
                        ? "Inte förberedd"
                        : "Not prepared",
              },
            ]}
          />
        ))}
        <PageCaption>
          {sv
            ? "Förbered ett utkast och granska det före godkännande. Sparad historik bevisar inte leverans."
            : "Prepare a draft and review it before approval. Saved history does not prove delivery."}
        </PageCaption>
        {occurrences.isError ? (
          <Button variant="outline" onClick={() => void occurrences.refetch()}>
            {sv ? "Uppdatera fakturacykler" : "Refresh invoice cycles"}
          </Button>
        ) : null}
        {occurrences.hasNextPage ? (
          <Button
            variant="outline"
            disabled={occurrences.isFetchingNextPage}
            onClick={() => void occurrences.fetchNextPage()}
          >
            {sv ? "Fler fakturacykler" : "More invoice cycles"}
          </Button>
        ) : null}
      </RecordSection>
      {cycleOrdinal !== undefined ? (
        <PanelSection label={sv ? "Vald fakturacykel" : "Selected invoice cycle"}>
          <AccountingStatus
            locale={locale}
            pending={occurrence.isPending}
            error={occurrence.error}
          />
          {selected ? (
            <>
              <Text>
                {selected.occurrence.serviceInterval.serviceStartsOn} –{" "}
                {selected.occurrence.serviceInterval.serviceEndsOn}
              </Text>
              {items
                .filter((item) => item.cycleOrdinal === cycleOrdinal)
                .map((item) => (
                  <FormColumn key={item.occurrenceId}>
                    <Text>
                      {sv ? "Förberedd" : "Prepared"}:{" "}
                      {item.prepared ? (sv ? "Ja" : "Yes") : sv ? "Nej" : "No"}
                    </Text>
                    <Text>
                      {sv ? "Godkänd" : "Approved"}:{" "}
                      {item.approved ? (sv ? "Ja" : "Yes") : sv ? "Nej" : "No"}
                    </Text>
                    <Text>
                      {sv ? "Utfärdad" : "Issued"}:{" "}
                      {item.issued ? (sv ? "Ja" : "Yes") : sv ? "Nej" : "No"}
                    </Text>
                  </FormColumn>
                ))}
              <Link
                href={`${sales}${defaultStringifySearch({ view: "drafts", record: selected.occurrence.draftId, work, returnTo })}`}
              >
                {sv ? "Öppna cykelns faktura" : "Open the cycle invoice"}
              </Link>
              {selected.coverage.length === 0 ? (
                <Text>
                  {sv
                    ? "Ingen fakturerad täckning för denna cykel."
                    : "No billed coverage for this cycle."}
                </Text>
              ) : null}
              {selected.coverage.map((coverage) => (
                <FormColumn key={coverage.id}>
                  <Text>
                    {coverage.chargeComponentKey}, {coverage.documentNumber}
                  </Text>
                  <Link
                    href={`${sales}${defaultStringifySearch({ record: coverage.registerInvoiceId, kind: "invoice", stage: "payments", work, returnTo })}`}
                  >
                    {sv ? "Granska fakturans betalningar" : "Review invoice payments"}
                  </Link>
                </FormColumn>
              ))}
            </>
          ) : (
            <Button
              variant="outline"
              disabled={occurrence.isFetching}
              onClick={() => void occurrence.refetch()}
            >
              {sv ? "Försök läsa cykeln igen" : "Retry reading the cycle"}
            </Button>
          )}
        </PanelSection>
      ) : null}
      <DetailPanelActions
        primary={
          <Action
            kind="secondary"
            presentation="record"
            besidePrimary
            fill
            onClick={() => setShowRecovery((shown) => !shown)}
          >
            {sv ? "Förbered fakturautkast" : "Prepare invoice draft"}
          </Action>
        }
        secondary={
          <Action
            kind="secondary"
            presentation="record"
            fill
            onClick={() => props.onEdit("schedule")}
          >
            {sv ? "Ändra framtida cykler" : "Change future cycles"}
          </Action>
        }
        tertiary={
          <ActionRow spread padded>
            <InlineAction onClick={() => props.onEdit("template")}>
              {sv ? "Ändra fakturamall" : "Change invoice template"}
            </InlineAction>
            <InlineAction onClick={() => setShowRecovery(true)}>
              {sv ? "Pausa avtalet" : "Pause agreement"}
            </InlineAction>
          </ActionRow>
        }
      />
    </>
  );
}

function SavedAgreement(props: {
  view: Recurring.RecurringAgreementView;
  customerName?: string;
  sv: boolean;
}) {
  const sv = props.sv;

  return (
    <>
      <RecordHeader roomy>
        <PageCaption compact>{sv ? "Aktivt avtal" : "Active agreement"}</PageCaption>
        <FormTitle record>{props.view.agreement.title}</FormTitle>
        <Text compact>
          {props.customerName ??
            (sv ? "Kundnamnet är inte tillgängligt" : "Customer name unavailable")}
        </Text>
      </RecordHeader>
      <RecordSection label={sv ? "Sparat avtal" : "Saved agreement"}>
        <PlainFacts
          presentation="record"
          align="end"
          facts={[
            {
              label: sv ? "Startdatum" : "Anchor date",
              value: props.view.agreement.schedule.anchorLocalDate,
            },
            {
              label: sv ? "Intervall" : "Cadence",
              value:
                props.view.agreement.schedule.cadence.kind === "monthly"
                  ? props.view.agreement.schedule.cadence.monthInterval === "1"
                    ? sv
                      ? "Varje månad"
                      : "Every month"
                    : `${props.view.agreement.schedule.cadence.monthInterval} ${sv ? "månader" : "months"}`
                  : `${props.view.agreement.schedule.cadence.dayInterval} ${sv ? "dagar" : "days"}`,
            },
            {
              label: sv ? "Månadsregel" : "Monthly rule",
              value:
                props.view.agreement.schedule.cadence.kind === "monthly"
                  ? props.view.agreement.schedule.cadence.monthAnchorPolicy === "end_of_month"
                    ? sv
                      ? "Månadens sista dag"
                      : "Last day of month"
                    : sv
                      ? "Startdag, till månadens slut"
                      : "Anchor day, capped at month end"
                  : sv
                    ? "Gäller inte"
                    : "Not applicable",
            },
            {
              label: sv ? "Tidszon" : "Time zone",
              value: props.view.agreement.schedule.timeZone,
            },
            {
              label: sv ? "Fakturamall" : "Invoice template",
              value: props.view.revisions.length ? (
                <AgreementRevisionHistory view={props.view} sv={sv} />
              ) : sv ? (
                "Ingen mall sparad"
              ) : (
                "No saved template"
              ),
            },
          ]}
        />
        <PageCaption record>
          {sv
            ? "Cykel 1 slutar efter ett intervall. Startdagen är tjänsteperiodens början."
            : "Cycle 1 ends after one interval. The anchor starts the service period."}
        </PageCaption>
      </RecordSection>
    </>
  );
}

function AgreementRevisionHistory({
  view,
  sv,
}: {
  view: Recurring.RecurringAgreementView;
  sv: boolean;
}) {
  return (
    <details>
      <summary aria-label={sv ? "Avtalets versionshistorik" : "Agreement revision history"}>
        Revision {view.revisions.at(-1)?.revision}
      </summary>
      <FormColumn>
        {view.schedules.map((schedule) => (
          <Text key={schedule.revision}>
            {sv ? "Schema" : "Schedule"} {schedule.revision}, {sv ? "från cykel" : "from cycle"}{" "}
            {schedule.effectiveFromCycle}:{" "}
            {schedule.cadenceKind === "monthly"
              ? sv
                ? "Månader"
                : "Months"
              : sv
                ? "Dagar"
                : "Days"}
          </Text>
        ))}
        {view.revisions.map((revision) => (
          <Text key={revision.revision}>
            {sv ? "Mall" : "Template"} {revision.revision}, {sv ? "från cykel" : "from cycle"}{" "}
            {revision.effectiveFromCycle}: {revision.chargeComponentKeys.join(", ")}
          </Text>
        ))}
      </FormColumn>
    </details>
  );
}

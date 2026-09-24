import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { ArrowLeft } from "lucide-react";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { PageCaption, PageEmpty, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { InputField } from "@open-erp/ui/components/field";
import { formatMinorAmount } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { subledgerCopy } from "./copy";
import { ScheduleForm } from "./schedule-form";

type Props = {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
  locale: Locale;
  onPrepared: (id: string) => void;
  open?: boolean;
  recordId?: string;
  onOpen?: (id: string) => void;
};
export function SubledgersPanel(props: Props) {
  if (props.open) return <ScheduleWorkspace {...props} />;
  return (
    <details id="subledgers" tabIndex={-1}>
      <summary>{subledgerCopy(props.locale).title}</summary>
      <ScheduleWorkspace {...props} />
    </details>
  );
}
function ScheduleWorkspace(props: Props) {
  const { book, setup, locale } = props;
  const copy = subledgerCopy(locale);
  const client = useQueryClient();
  const [localRecord, setLocalRecord] = useState<string | null>(null);
  const selected = props.recordId ?? localRecord;
  const setSelected = (id: string | null) => {
    setLocalRecord(id);
    props.onOpen?.(id ?? "");
  };
  const [after, setAfter] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [creating, setCreating] = useState(false);
  const schedules = useQuery({
    queryKey: [...bookKey(book), "schedules", after],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/schedules${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Subledgers.SchedulePage,
        { signal },
      ),
    retry: false,
  });
  const saved = (id: string) => {
    setSelected(id);
    setCreating(false);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "schedules"] });
    void client.invalidateQueries({ queryKey: [...bookKey(book), "schedule", id] });
  };
  if (selected)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => setSelected(null)}>
            <ArrowLeft size={14} />
            {locale === "sv" ? "Alla planer" : "All schedules"}
          </Button>
        </Box>
        <ScheduleDetail key={selected} {...props} id={selected} onSaved={saved} />
      </Box>
    );
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <RecordHeading
        title={copy.title}
        action={
          <Box display="flex" gap="md" alignItems="center">
            <Button
              variant="ghost"
              disabled={schedules.isFetching}
              onClick={() => void schedules.refetch()}
            >
              {copy.refresh}
            </Button>
            {setup?.blockers.length === 0 ? (
              <Button onClick={() => setCreating(true)}>
                {locale === "sv" ? "Ny plan" : "New schedule"}
              </Button>
            ) : null}
          </Box>
        }
      />
      {creating && setup ? (
        <FormDialog
          title={locale === "sv" ? "Ny plan" : "New schedule"}
          closeLabel={locale === "sv" ? "Stäng" : "Close"}
          onClose={() => setCreating(false)}
        >
          <Box display="grid" gap="lg">
            <ScheduleForm book={book} setup={setup} locale={locale} onSaved={saved} />
          </Box>
        </FormDialog>
      ) : null}
      {after ? (
        <Box>
          <Button variant="ghost" onClick={() => setAfter(null)}>
            {copy.first}
          </Button>
        </Box>
      ) : null}
      <AccountingStatus locale={locale} pending={schedules.isPending} error={schedules.error} />
      {schedules.data ? (
        <>
          {schedules.data.items.length === 0 ? (
            <PageEmpty
              title={locale === "sv" ? "Inga sparade planer" : "No saved schedules"}
              detail={
                locale === "sv"
                  ? "Lägg till en tillgång eller periodisering med belopp, konton och bokföringsdatum."
                  : "Add an asset or deferral with amounts, accounts and posting dates."
              }
            />
          ) : (
            <DataTable
              title={copy.title}
              narrow="stack"
              columns={[
                { id: "name", label: copy.name },
                { id: "kind", label: copy.kind },
                { id: "revision", label: copy.revision },
              ]}
              rows={schedules.data.items.map((schedule) => ({
                id: schedule.id,
                cells: [
                  <RecordOpen key="name" onClick={() => setSelected(schedule.id)}>
                    {schedule.name}
                  </RecordOpen>,
                  schedule.kind === "asset" ? copy.asset : copy.deferral,
                  schedule.revision,
                ],
              }))}
            />
          )}
          {schedules.data.next ? (
            <Box>
              <Button size="xl" variant="outline" onClick={() => setAfter(schedules.data.next)}>
                {copy.next}
              </Button>
            </Box>
          ) : null}
        </>
      ) : null}
      {!props.open ? (
        <Disclosure title={locale === "sv" ? "Öppna med referens" : "Open by reference"}>
          <Box
            as="form"
            display="grid"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();
              const id = new FormData(event.currentTarget).get("scheduleId");
              if (!Schema.is(Accounting.Identifier)(id)) {
                setInvalid(true);
                return;
              }
              setInvalid(false);
              setSelected(id);
            }}
          >
            <InputField label="ID" name="scheduleId" required pattern="[a-z][a-z0-9_\-]{2,127}" />
            <Box>
              <Button type="submit" size="xl" variant="outline">
                {copy.load}
              </Button>
            </Box>
            <Text role="status">{invalid ? copy.invalid : ""}</Text>
          </Box>
        </Disclosure>
      ) : null}
      <Disclosure
        title={locale === "sv" ? "Omfattning och begränsningar" : "Scope and limitations"}
      >
        <Text>{copy.warning}</Text>
        <Text>{copy.unsupported}</Text>
      </Disclosure>
    </Box>
  );
}

function ScheduleDetail(props: Props & { id: string; onSaved: (id: string) => void }) {
  const { book, setup, locale, id } = props;
  const copy = subledgerCopy(locale);
  const [editing, setEditing] = useState(false);
  const keys = useRef(new Map<string, string>());
  const schedule = useQuery({
    queryKey: [...bookKey(book), "schedule", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/schedules/${id}`,
        Subledgers.ScheduleView,
        { signal },
      );
      if (
        [result.current, ...result.revisions].some(
          (revision) =>
            revision.scheduleId !== id ||
            revision.scope.bookId !== book.id ||
            revision.scope.entityId !== book.entityId,
        )
      ) {
        throw new Error("Schedule response identity or scope mismatch");
      }
      return result;
    },
    retry: false,
  });
  const prepare = useMutation({
    mutationFn: async (input: typeof Subledgers.PrepareScheduleOccurrence.Type) => {
      const path = `${bookPath(book)}/schedules/${id}/prepare`;
      const result = await readAccounting(
        path,
        Subledgers.SchedulePreparation,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
      if (
        result.scheduleId !== id ||
        result.revisionDigest !== input.expectedDigest ||
        result.ordinal !== input.ordinal
      ) {
        throw new Error("Schedule preparation identity mismatch");
      }
      return result;
    },
    onSuccess: (_result, input) => {
      // A confirmed command may be followed by a fresh dependency check. Keep keys after errors.
      keys.current.delete(`${bookPath(book)}/schedules/${id}/prepare:${JSON.stringify(input)}`);
      void schedule.refetch();
    },
  });
  const view = schedule.data;
  const stateLabels = {
    unprepared: copy.unprepared,
    prepared: copy.preparedState,
    posted: copy.posted,
    reversed: copy.reversed,
    conflicted: copy.conflicted,
  };
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={schedule.isPending} error={schedule.error} />
      {schedule.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={schedule.isFetching}
            onClick={() => {
              void schedule.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
      ) : null}
      {view ? (
        <>
          <RecordHeading
            title={view.current.terms.name}
            subtitle={`${view.current.terms.kind === "asset" ? copy.asset : copy.deferral} · ${copy.revision} ${view.current.revision}`}
            action={
              view.revisionAllowed && setup?.blockers.length === 0 ? (
                <Button onClick={() => setEditing(true)}>
                  {locale === "sv" ? "Redigera plan" : "Edit schedule"}
                </Button>
              ) : undefined
            }
          />
          <RecordSummary>
            <RecordFact label={locale === "sv" ? "Anskaffningsvärde" : "Source cost"}>
              {formatMinorAmount(view.current.terms.costMinor, view.current.currencyScale, locale)}{" "}
              {view.current.currency}
            </RecordFact>
            <RecordFact label={locale === "sv" ? "Bokfört" : "Recognized"}>
              {formatMinorAmount(view.recognizedMinor, view.current.currencyScale, locale)}{" "}
              {view.current.currency}
            </RecordFact>
            <RecordFact label={locale === "sv" ? "Återstående" : "Remaining"}>
              {formatMinorAmount(view.remainingMinor, view.current.currencyScale, locale)}{" "}
              {view.current.currency}
            </RecordFact>
          </RecordSummary>
          <PageCaption>{view.current.terms.rationale}</PageCaption>
          <ScheduleBasisNotice basis={view.postingBasis} locale={locale} />
          <DataTable
            title={copy.occurrence}
            narrow="stack"
            columns={[
              { id: "ordinal", label: copy.occurrence },
              { id: "date", label: copy.date },
              { id: "period", label: copy.period },
              { id: "amount", label: locale === "sv" ? "Belopp" : "Amount", numeric: true },
              { id: "state", label: copy.state },
              { id: "actions", label: copy.review },
            ]}
            rows={view.occurrences.map((occurrence) => ({
              id: String(occurrence.ordinal),
              cells: [
                occurrence.ordinal,
                occurrence.postingDate,
                periodName(occurrence.accountingPeriodId, setup, locale),
                formatMinorAmount(occurrence.amountMinor, view.current.currencyScale, locale),
                <Box key="state" display="grid" gap="sm">
                  <Text>{stateLabels[occurrence.state]}</Text>
                  <Text>{occurrence.voucherId}</Text>
                  <Text>{occurrence.reversalVoucherId}</Text>
                </Box>,
                <Box key="actions" display="grid" gap="sm" width="fit">
                  {occurrence.state === "unprepared" || occurrence.state === "prepared" ? (
                    <Button
                      size="xl"
                      variant="outline"
                      disabled={prepare.isPending || view.postingBasis?.supported !== true}
                      onClick={() =>
                        prepare.mutate({
                          expectedDigest: view.current.digest,
                          ordinal: occurrence.ordinal,
                        })
                      }
                    >
                      {locale === "sv" ? "Förbered förslag" : "Prepare proposal"}
                    </Button>
                  ) : null}
                  {occurrence.changeSetId ? (
                    <Button
                      size="xl"
                      variant="ghost"
                      onClick={() => {
                        if (occurrence.changeSetId) props.onPrepared(occurrence.changeSetId);
                      }}
                    >
                      {copy.review} · {occurrence.ordinal}
                    </Button>
                  ) : null}
                </Box>,
              ],
            }))}
          />
          <AccountingStatus
            locale={locale}
            write
            pending={prepare.isPending}
            error={prepare.error}
          />
          {prepare.data ? (
            <Box role="status" display="grid" gap="md">
              <Text>{copy.prepared}</Text>
              <Text>{prepare.data.changeSetId}</Text>
              <Box>
                <Button
                  size="xl"
                  onClick={() => {
                    if (prepare.data) props.onPrepared(prepare.data.changeSetId);
                  }}
                >
                  {copy.review}
                </Button>
              </Box>
            </Box>
          ) : null}
          <Disclosure title={locale === "sv" ? "Underlag och referenser" : "Source and references"}>
            <EvidenceInspector
              book={book}
              locale={locale}
              reference={{
                evidenceId: view.current.terms.evidenceId,
                sha256: view.current.sourceSha256,
                locator: view.current.sourceKey,
              }}
            />
            <Text>
              {view.current.scheduleId} · {view.current.digest}
            </Text>
            <Text>{copy.balanceHelp}</Text>
          </Disclosure>
          <details>
            <summary>{copy.history}</summary>
            <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
              {view.revisions.map((revision) => (
                <Box key={revision.digest} display="grid" gap="md" minWidth="zero">
                  <Text>
                    {copy.revision} {revision.revision} · {revision.createdAt}
                  </Text>
                  <Text>{revision.digest}</Text>
                  <Text>
                    {copy.evidence}: {revision.terms.evidenceId}
                  </Text>
                  <Text>
                    {copy.rationale}: {revision.terms.rationale}
                  </Text>
                  <Text>
                    {copy.cost}: {revision.terms.costMinor} · {copy.residual}:{" "}
                    {revision.terms.residualMinor}
                  </Text>
                  <Text>
                    {copy.debit}: {revision.terms.debitAccountId} · {copy.credit}:{" "}
                    {revision.terms.creditAccountId} · {copy.series}: {revision.terms.series}
                  </Text>
                  <DataTable
                    title={`${copy.revision} ${revision.revision}`}
                    narrow="stack"
                    columns={[
                      { id: "date", label: copy.date },
                      { id: "period", label: copy.period },
                      { id: "amount", label: locale === "sv" ? "Belopp" : "Amount", numeric: true },
                    ]}
                    rows={revision.occurrences.map((occurrence) => ({
                      id: String(occurrence.ordinal),
                      cells: [
                        occurrence.postingDate,
                        occurrence.accountingPeriodId,
                        occurrence.amountMinor,
                      ],
                    }))}
                  />
                </Box>
              ))}
            </Box>
          </details>
          {editing && view.revisionAllowed && setup ? (
            <FormDialog
              title={locale === "sv" ? "Redigera plan" : "Edit schedule"}
              closeLabel={locale === "sv" ? "Stäng" : "Close"}
              onClose={() => setEditing(false)}
            >
              <ScheduleForm
                key={view.current.digest}
                book={book}
                setup={setup}
                locale={locale}
                current={view.current}
                onSaved={(id) => {
                  setEditing(false);
                  props.onSaved(id);
                }}
              />
            </FormDialog>
          ) : null}
          {!view.revisionAllowed ? <PageCaption>{copy.frozen}</PageCaption> : null}
        </>
      ) : null}
    </Box>
  );
}

function ScheduleBasisNotice({
  basis,
  locale,
}: {
  basis: typeof Subledgers.SchedulePostingBasis.Type | undefined;
  locale: Locale;
}) {
  const copy = subledgerCopy(locale);
  let message = copy.basisUnknown;
  if (basis) {
    message = copy.basisStandalone;
    if (!basis.supported) message = copy.basisBlocked;
    else if (basis.mode === "linked_basis") message = copy.basisLinked;
  }
  return (
    <Box role="status" display="grid" gap="sm">
      <Text>{message}</Text>
      {basis?.basisVoucherId ? (
        <Text>
          {copy.basisVoucher}: {basis.basisVoucherId}
        </Text>
      ) : null}
      {basis?.basisDigest ? (
        <Text>
          {copy.basisDigest}: {basis.basisDigest}
        </Text>
      ) : null}
    </Box>
  );
}

function periodName(
  id: string,
  setup: typeof Accounting.BookSetup.Type | undefined,
  locale: Locale,
) {
  const period = setup?.periods.find((item) => item.id === id);
  return period
    ? `${period.startsOn} – ${period.endsOn}`
    : locale === "sv"
      ? "Period ej tillgänglig"
      : "Period unavailable";
}

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
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { decimalToMinor, formatMinorAmount, minorToDecimal } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { CommandForm } from "@/components/commerce/shared";
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
            <RecordFact label={copy.remaining}>
              {formatMinorAmount(view.remainingMinor, view.current.currencyScale, locale)}{" "}
              {view.current.currency}
            </RecordFact>
            <RecordFact label={copy.carrying}>
              {view.carryingMinor
                ? `${formatMinorAmount(view.carryingMinor, view.current.currencyScale, locale)} ${view.current.currency}`
                : locale === "sv"
                  ? "Ej fastställt"
                  : "Not established"}
            </RecordFact>
            <RecordFact label={copy.impairment}>
              {formatMinorAmount(view.netImpairmentMinor, view.current.currencyScale, locale)}{" "}
              {view.current.currency}
            </RecordFact>
          </RecordSummary>
          <PageCaption>{view.current.terms.rationale}</PageCaption>
          <ScheduleBasisNotice basis={view.postingBasis} locale={locale} />
          {view.impairments.length ? (
            <DataTable
              title={copy.impairmentHistory}
              narrow="stack"
              columns={[
                { id: "date", label: copy.date },
                { id: "amount", label: copy.impairment, numeric: true },
                { id: "carrying", label: copy.carrying, numeric: true },
                { id: "voucher", label: copy.voucher },
              ]}
              rows={view.impairments.map((impairment) => ({
                id: impairment.id,
                cells: [
                  impairment.postingDate,
                  formatMinorAmount(
                    impairment.impairmentMinor,
                    view.current.currencyScale,
                    locale,
                  ),
                  formatMinorAmount(
                    impairment.postImpairmentCarryingMinor,
                    view.current.currencyScale,
                    locale,
                  ),
                  impairment.postingReceipt.voucherId,
                ],
              }))}
            />
          ) : null}
          <ScheduleAmendmentPanel
            key={view.current.digest}
            book={book}
            setup={setup}
            locale={locale}
            view={view}
            onChanged={() => void schedule.refetch()}
          />
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

function ScheduleAmendmentPanel(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
  locale: Locale;
  view: typeof Subledgers.ScheduleView.Type;
  onChanged: () => void;
}) {
  const { book, locale } = props;
  const copy = subledgerCopy(locale);
  const current = props.view.current;
  const occurrences = props.view.occurrences;
  const suffixStart = occurrences.findIndex(
    (occurrence) => occurrence.state === "unprepared" || occurrence.state === "prepared",
  );
  const suffix = suffixStart < 0 ? [] : occurrences.slice(suffixStart);
  const prefix = suffixStart < 0 ? [] : occurrences.slice(0, suffixStart);
  const hasCompleteSuffix =
    suffixStart >= 0 &&
    suffix.length > 0 &&
    suffix.every(
      (occurrence) => occurrence.state === "unprepared" || occurrence.state === "prepared",
    );
  const hasPrefixConflict = prefix.some((occurrence) => occurrence.state === "conflicted");
  const hasReversedPrefix = prefix.some((occurrence) => occurrence.state === "reversed");
  const linkedBasis = props.view.postingBasis?.mode === "linked_basis";
  const commonAvailable =
    linkedBasis &&
    props.view.postingBasis?.supported === true &&
    props.view.impairments.length === 0 &&
    hasCompleteSuffix &&
    !hasPrefixConflict &&
    props.setup !== undefined;
  const dateAvailable = commonAvailable && !hasReversedPrefix;
  const [estimateCount, setEstimateCount] = useState(Math.max(1, suffix.length));
  const periodOptions = (props.setup?.periods ?? []).map((period) => ({
    value: period.id,
    label: `${period.startsOn} – ${period.endsOn}`,
    disabled: period.locked,
  }));
  const path = `${bookPath(book)}/schedules/${encodeURIComponent(current.scheduleId)}`;

  if (book.role !== "operator") return <PageCaption>{copy.amendmentOnlyOperator}</PageCaption>;

  return (
    <Disclosure title={copy.amendment}>
      <Box display="grid" gap="lg" minWidth="zero">
        <ScheduleAmendmentReadout
          view={props.view}
          locale={locale}
          linkedBasis={linkedBasis}
          hasCompleteSuffix={hasCompleteSuffix}
          hasReversedPrefix={hasReversedPrefix}
        />
        {props.view.impairments.length ? (
          <Text role="alert">{copy.amendmentAfterImpairment}</Text>
        ) : null}
        {dateAvailable ? (
          <ScheduleDateAmendmentForm
            book={book}
            locale={locale}
            path={path}
            schedule={props.view}
            suffix={suffix}
            suffixStart={suffixStart}
            periodOptions={periodOptions}
            onChanged={props.onChanged}
          />
        ) : null}
        {commonAvailable ? (
          <ScheduleEstimateAmendmentForm
            book={book}
            locale={locale}
            path={path}
            schedule={props.view}
            suffix={suffix}
            suffixStart={suffixStart}
            periodOptions={periodOptions}
            estimateCount={estimateCount}
            setEstimateCount={setEstimateCount}
            onChanged={props.onChanged}
          />
        ) : null}
      </Box>
    </Disclosure>
  );
}

function amendmentKindLabel(
  kind:
    | "future_dates_v1"
    | "remaining_estimate_v1"
    | "remaining_lifetime_v1"
    | "impairment_v1"
    | undefined,
  locale: Locale,
  none: string,
) {
  if (kind === "future_dates_v1") return locale === "sv" ? "Framtida datum" : "Future dates";
  if (kind === "remaining_estimate_v1")
    return locale === "sv" ? "Återstående uppskattning" : "Remaining estimate";
  if (kind === "remaining_lifetime_v1")
    return locale === "sv" ? "Återstående livslängd" : "Remaining lifetime";
  if (kind === "impairment_v1") return locale === "sv" ? "Nedskrivning" : "Impairment";
  return none;
}

function amendmentBlockerMessage(
  basis: typeof Subledgers.SchedulePostingBasis.Type | undefined,
  locale: Locale,
) {
  if (!basis || basis.supported) return undefined;
  const copy = subledgerCopy(locale);
  if (basis.blocker === "basis_reversed_or_corrected" || basis.blocker === "basis_mismatch")
    return copy.amendmentBlockerBasis;
  if (basis.blocker === "estimate_history_changed") return copy.amendmentBlockerEstimate;
  if (basis.blocker === "disposed") return copy.amendmentBlockerDisposed;
  return copy.amendmentBlockerUnknown;
}

function ScheduleAmendmentReadout(props: {
  view: typeof Subledgers.ScheduleView.Type;
  locale: Locale;
  linkedBasis: boolean;
  hasCompleteSuffix: boolean;
  hasReversedPrefix: boolean;
}) {
  const { view, locale } = props;
  const copy = subledgerCopy(locale);
  const current = view.current;
  const amendment = current.amendment;
  const kind = amendment?.kind;
  const kindLabel = amendmentKindLabel(kind, locale, copy.amendmentNone);
  const basisDigest = view.postingBasis?.basisDigest ?? amendment?.basisDigest;
  const futureMinor =
    amendment && "remainingMinor" in amendment.input
      ? amendment.input.remainingMinor
      : amendment?.kind === "impairment_v1"
        ? amendment.input.futureMinor
        : undefined;
  const reversedMinor =
    amendment && "reversedMinor" in amendment ? amendment.reversedMinor : undefined;
  const blockerMessage = amendmentBlockerMessage(view.postingBasis, locale);
  const conflictLabel = view.occurrences
    .filter((occurrence) => occurrence.state === "conflicted")
    .map((occurrence) => occurrence.ordinal)
    .join(", ");
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{copy.amendmentNotice}</Text>
      <RecordSummary>
        <RecordFact label={copy.amendmentKind}>{kindLabel}</RecordFact>
        <RecordFact label={copy.basisDigest}>{basisDigest ?? "—"}</RecordFact>
        <RecordFact label={copy.recognized}>
          {formatMinorAmount(view.recognizedMinor, current.currencyScale, locale)}{" "}
          {current.currency}
        </RecordFact>
        <RecordFact label={copy.future}>
          {futureMinor
            ? `${formatMinorAmount(futureMinor, current.currencyScale, locale)} ${current.currency}`
            : locale === "sv"
              ? "Ej separat bevarad"
              : "Not separately retained"}
        </RecordFact>
        <RecordFact label={copy.remaining}>
          {formatMinorAmount(view.remainingMinor, current.currencyScale, locale)} {current.currency}
        </RecordFact>
        {reversedMinor ? (
          <RecordFact label={copy.reversedFace}>
            {formatMinorAmount(reversedMinor, current.currencyScale, locale)} {current.currency}
          </RecordFact>
        ) : null}
      </RecordSummary>
      {amendment?.basisScheduleDigest ? (
        <Text>
          {copy.amendmentScheduleDigest}: {amendment.basisScheduleDigest}
        </Text>
      ) : null}
      {blockerMessage ? <Text role="alert">{blockerMessage}</Text> : null}
      {conflictLabel ? (
        <Text role="alert">
          {copy.amendmentStalePrefix} ({conflictLabel})
        </Text>
      ) : null}
      {props.hasReversedPrefix ? <Text role="alert">{copy.amendmentDatePrefix}</Text> : null}
      {!props.linkedBasis ? <Text role="alert">{copy.amendmentNoBasis}</Text> : null}
      {props.linkedBasis && !props.hasCompleteSuffix ? (
        <Text role="alert">{copy.amendmentNoSuffix}</Text>
      ) : null}
    </Box>
  );
}

function ScheduleDateAmendmentForm(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  path: string;
  schedule: typeof Subledgers.ScheduleView.Type;
  suffix: (typeof Subledgers.OccurrenceState.Type)[];
  suffixStart: number;
  periodOptions: { value: string; label: string; disabled: boolean }[];
  onChanged: () => void;
}) {
  const { book, locale } = props;
  const copy = subledgerCopy(locale);
  const current = props.schedule.current;
  const futureMinor =
    current.amendment && "remainingMinor" in current.amendment.input
      ? current.amendment.input.remainingMinor
      : undefined;
  return (
    <CommandForm
      book={book}
      locale={locale}
      path={`${props.path}/future-dates`}
      schema={Subledgers.AmendScheduleFutureDates}
      output={Subledgers.ScheduleRevision}
      label={copy.amendmentDate}
      recoveryId={`${current.scheduleId}:future-dates`}
      input={(fields) => ({
        expectedDigest: current.digest,
        expectedBasisDigest: props.schedule.postingBasis?.basisDigest ?? "",
        firstOrdinal: props.suffixStart + 1,
        remainingMinor:
          decimalToMinor(fieldText(fields, "remainingMinor"), current.currencyScale) ??
          fieldText(fields, "remainingMinor"),
        periods: props.suffix.map((_, index) => ({
          postingDate: fields.get(`date_${index}`),
          accountingPeriodId: fields.get(`period_${index}`),
        })),
        reviewEvidenceId: fields.get("reviewEvidenceId"),
        rationale: fields.get("rationale"),
      })}
      onSuccess={props.onChanged}
      validate={(result, input) => {
        if (
          result.scheduleId !== current.scheduleId ||
          result.previousDigest !== input.expectedDigest ||
          result.amendment?.basisDigest !== input.expectedBasisDigest
        ) {
          throw new Error("Schedule amendment response identity mismatch");
        }
      }}
    >
      <Box display="grid" gap="lg" minWidth="zero">
        <Text>{copy.amendmentDateHelp}</Text>

        <Text>
          {copy.amendmentFirst}: {props.suffixStart + 1}
        </Text>
        <InputField
          label={copy.future}
          name="remainingMinor"
          inputMode="decimal"
          required
          defaultValue={futureMinor ? minorToDecimal(futureMinor, current.currencyScale) : ""}
        />
        <Box display="grid" gap="md" minWidth="zero">
          <Text>{copy.amendmentPeriods}</Text>
          {props.suffix.map((occurrence, index) => (
            <Box
              key={occurrence.ordinal}
              display="grid"
              columns={2}
              gap="md"
              padding="md"
              borderWidth="thin"
              borderColor="default"
              borderRadius="control"
            >
              <InputField
                label={`${copy.date} ${occurrence.ordinal}`}
                name={`date_${index}`}
                type="date"
                required
                defaultValue={occurrence.postingDate}
              />
              <SelectField
                label={`${copy.period} ${occurrence.ordinal}`}
                name={`period_${index}`}
                options={props.periodOptions}
                defaultValue={occurrence.accountingPeriodId}
                required
              />
            </Box>
          ))}
        </Box>
        <InputField
          label={copy.amendmentReviewEvidence}
          name="reviewEvidenceId"
          required
          pattern="[a-z][a-z0-9_-]{2,127}"
        />
        <TextareaField
          label={copy.amendmentRationale}
          name="rationale"
          required
          rows={3}
          maxLength={2000}
        />
      </Box>
    </CommandForm>
  );
}

function ScheduleEstimateAmendmentForm(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  path: string;
  schedule: typeof Subledgers.ScheduleView.Type;
  suffix: (typeof Subledgers.OccurrenceState.Type)[];
  suffixStart: number;
  periodOptions: { value: string; label: string; disabled: boolean }[];
  estimateCount: number;
  setEstimateCount: (count: number) => void;
  onChanged: () => void;
}) {
  const { book, locale } = props;
  const copy = subledgerCopy(locale);
  const current = props.schedule.current;
  const futureMinor =
    current.amendment && "remainingMinor" in current.amendment.input
      ? current.amendment.input.remainingMinor
      : undefined;
  const residualMinor =
    current.amendment && current.amendment.kind !== "future_dates_v1"
      ? current.amendment.input.residualMinor
      : current.terms.residualMinor;
  return (
    <CommandForm
      book={book}
      locale={locale}
      path={`${props.path}/estimates`}
      schema={Subledgers.AmendScheduleEstimate}
      output={Subledgers.ScheduleRevision}
      label={copy.amendmentEstimate}
      recoveryId={`${current.scheduleId}:estimates`}
      input={(fields) => ({
        expectedDigest: current.digest,
        expectedBasisDigest: props.schedule.postingBasis?.basisDigest ?? "",
        firstOrdinal: props.suffixStart + 1,
        remainingMinor:
          decimalToMinor(fieldText(fields, "remainingMinor"), current.currencyScale) ??
          fieldText(fields, "remainingMinor"),
        residualMinor:
          decimalToMinor(fieldText(fields, "residualMinor"), current.currencyScale) ??
          fieldText(fields, "residualMinor"),
        installments: Array.from({ length: props.estimateCount }, (_, index) => ({
          postingDate: fields.get(`estimate_date_${index}`),
          accountingPeriodId: fields.get(`estimate_period_${index}`),
          amountMinor:
            decimalToMinor(fieldText(fields, `estimate_amount_${index}`), current.currencyScale) ??
            fieldText(fields, `estimate_amount_${index}`),
        })),
        reviewEvidenceId: fields.get("reviewEvidenceId"),
        rationale: fields.get("rationale"),
      })}
      onNewCommand={() => props.setEstimateCount(Math.max(1, props.suffix.length))}
      onSuccess={props.onChanged}
      validate={(result, input) => {
        if (
          result.scheduleId !== current.scheduleId ||
          result.previousDigest !== input.expectedDigest ||
          result.amendment?.basisDigest !== input.expectedBasisDigest
        ) {
          throw new Error("Schedule amendment response identity mismatch");
        }
      }}
    >
      <Box display="grid" gap="lg" minWidth="zero">
        <Text>{copy.amendmentEstimateHelp}</Text>
        <Text>
          {copy.amendmentFirst}: {props.suffixStart + 1}
        </Text>
        <Box display="grid" columns={2} gap="lg">
          <InputField
            label={copy.future}
            name="remainingMinor"
            inputMode="decimal"
            required
            defaultValue={futureMinor ? minorToDecimal(futureMinor, current.currencyScale) : ""}
          />
          <InputField
            label={copy.amendmentResidual}
            name="residualMinor"
            inputMode="decimal"
            required
            defaultValue={minorToDecimal(residualMinor, current.currencyScale)}
          />
        </Box>
        <Box display="grid" gap="md" minWidth="zero">
          <Text>{copy.amendmentInstallments}</Text>
          {Array.from({ length: props.estimateCount }, (_, index) => {
            const occurrence = props.suffix[index];
            return (
              <Box
                key={index}
                display="grid"
                columns={2}
                gap="md"
                padding="md"
                borderWidth="thin"
                borderColor="default"
                borderRadius="control"
              >
                <InputField
                  label={`${copy.date} ${props.suffixStart + index + 1}`}
                  name={`estimate_date_${index}`}
                  type="date"
                  required
                  defaultValue={occurrence?.postingDate}
                />
                <SelectField
                  label={`${copy.period} ${props.suffixStart + index + 1}`}
                  name={`estimate_period_${index}`}
                  options={props.periodOptions}
                  defaultValue={occurrence?.accountingPeriodId}
                  required
                />
                <InputField
                  label={`${copy.amount} ${props.suffixStart + index + 1}`}
                  name={`estimate_amount_${index}`}
                  inputMode="decimal"
                  required
                  defaultValue={
                    occurrence ? minorToDecimal(occurrence.amountMinor, current.currencyScale) : ""
                  }
                />
              </Box>
            );
          })}
          <Box display="flex" gap="md" flexWrap="wrap">
            <Button
              type="button"
              variant="outline"
              disabled={props.estimateCount >= 120 - props.suffixStart}
              onClick={() => props.setEstimateCount(props.estimateCount + 1)}
            >
              {copy.amendmentAdd}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={props.estimateCount <= 1}
              onClick={() => props.setEstimateCount(props.estimateCount - 1)}
            >
              {copy.amendmentRemove}
            </Button>
          </Box>
        </Box>
        <InputField
          label={copy.amendmentReviewEvidence}
          name="reviewEvidenceId"
          required
          pattern="[a-z][a-z0-9_-]{2,127}"
        />
        <TextareaField
          label={copy.amendmentRationale}
          name="rationale"
          required
          rows={3}
          maxLength={2000}
        />
      </Box>
    </CommandForm>
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

function fieldText(fields: FormData, name: string) {
  const value = fields.get(name);
  return typeof value === "string" ? value : "";
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

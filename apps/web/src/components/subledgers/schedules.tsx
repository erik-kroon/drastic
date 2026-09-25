import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { ArrowLeft } from "lucide-react";
import { RecordHeading, RecordSummary, RecordFact, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageCaption, PageEmpty, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { Disclosure, WorkflowSteps } from "@open-erp/ui/components/workflow";
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
          <AssetImpairmentPanel
            book={book}
            setup={setup}
            locale={locale}
            schedule={view}
          />
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

function AssetImpairmentPanel(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
  locale: Locale;
  schedule: typeof Subledgers.ScheduleView.Type;
}) {
  const copy = subledgerCopy(props.locale);
  if (props.book.role !== "operator")
    return <PageCaption>{copy.impairmentOperatorOnly}</PageCaption>;
  return <OperatorAssetImpairmentPanel {...props} />;
}

function OperatorAssetImpairmentPanel(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
  locale: Locale;
  schedule: typeof Subledgers.ScheduleView.Type;
}) {
  const { book, locale, schedule } = props;
  const copy = subledgerCopy(locale);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const basisEnabled = schedule.postingBasis?.mode === "linked_basis";
  const basisPath = `${bookPath(book)}/subledger-controls/bases/${encodeURIComponent(schedule.current.scheduleId)}`;
  const basis = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "basis", schedule.current.scheduleId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(basisPath, Controls.SubledgerBasis, { signal });
      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.input.scheduleId !== schedule.current.scheduleId ||
        result.digest !== schedule.postingBasis?.basisDigest
      ) {
        throw new Error("Impairment carrying basis identity mismatch");
      }
      return result;
    },
    enabled: basisEnabled,
    retry: false,
  });
  const reviews = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "impairment-reviews", schedule.current.scheduleId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/subledger-controls/impairments/for-schedule/${encodeURIComponent(schedule.current.scheduleId)}`,
        Controls.AssetImpairmentReviewList,
        { signal },
      );
      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.scheduleId !== schedule.current.scheduleId ||
        result.impairments.some((effect) => effect.scheduleId !== schedule.current.scheduleId)
      ) {
        throw new Error("Impairment review list identity mismatch");
      }
      return result;
    },
    retry: false,
  });
  const suffix = completeImpairmentSuffix(schedule);
  const expectedBasisDigest = schedule.postingBasis?.basisDigest ?? null;
  const basisReady =
    basis.data !== undefined &&
    expectedBasisDigest !== null &&
    basis.data.digest === expectedBasisDigest &&
    schedule.postingBasis?.supported === true;
  let blocker: string | undefined;
  if (schedule.current.terms.kind !== "asset") blocker = copy.impairmentAssetOnly;
  else if (schedule.disposal) blocker = copy.impairmentDisposed;
  else if (schedule.postingBasis?.mode !== "linked_basis") blocker = copy.impairmentBasisRequired;
  else if (schedule.postingBasis.supported !== true) blocker = copy.amendmentBlockerBasis;
  else if (!basisReady) blocker = copy.impairmentBasisUnavailable;
  else if (!suffix.complete) blocker = copy.impairmentSuffixRequired;
  else if (props.setup === undefined) blocker = copy.impairmentSetupUnavailable;
  else if (
    schedule.carryingMinor === null ||
    BigInt(schedule.carryingMinor) <= 0n
  ) {
    blocker = copy.impairmentCarryingUnavailable;
  }
  return (
    <Disclosure title={copy.impairmentWorkflow}>
      <Box display="grid" gap="lg" minWidth="zero">
        <PageCaption>{copy.impairmentWorkflowHelp}</PageCaption>
        <AssetImpairmentReviewLookup
          locale={locale}
          onOpen={(id) => setSelectedReviewId(id)}
        />
        {selectedReviewId ? (
          <AssetImpairmentReviewDetail
            key={selectedReviewId}
            book={book}
            locale={locale}
            schedule={schedule}
            id={selectedReviewId}
            onBack={() => setSelectedReviewId(null)}
            onOpen={(id) => setSelectedReviewId(id)}
          />
        ) : (
          <>
            <AccountingStatus
              locale={locale}
              pending={reviews.isPending || (basisEnabled && basis.isPending)}
              error={basis.error ?? reviews.error}
            />
            {blocker ? <Text role="alert">{blocker}</Text> : null}
            {!blocker && props.setup && basis.data ? (
              <AssetImpairmentPrepareForm
                key={`${schedule.current.digest}:${basis.data.digest}`}
                book={book}
                setup={props.setup}
                locale={locale}
                schedule={schedule}
                basis={basis.data}
                suffix={suffix.occurrences}
                suffixStart={suffix.start}
                onPrepared={setSelectedReviewId}
              />
            ) : null}
            <Box>
              <Button
                variant="outline"
                disabled={reviews.isFetching}
                onClick={() => void reviews.refetch()}
              >
                {copy.impairmentRefresh}
              </Button>
            </Box>
            {reviews.data ? (
              <AssetImpairmentReviewList
                locale={locale}
                reviews={reviews.data}
                onOpen={setSelectedReviewId}
              />
            ) : null}
          </>
        )}
      </Box>
    </Disclosure>
  );
}

function AssetImpairmentReviewLookup(props: { locale: Locale; onOpen: (id: string) => void }) {
  const copy = subledgerCopy(props.locale);
  const [invalid, setInvalid] = useState(false);
  return (
    <Box
      as="form"
      display="grid"
      gap="md"
      onSubmit={(event) => {
        event.preventDefault();
        const id = new FormData(event.currentTarget).get("impairmentReviewId");
        if (!Schema.is(Accounting.Identifier)(id)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        props.onOpen(id);
      }}
    >
      <InputField
        label={copy.impairmentReviewId}
        name="impairmentReviewId"
        required
        pattern="[a-z][a-z0-9_\-]{2,127}"
      />
      <Box>
        <Button type="submit" variant="outline">
          {copy.impairmentLoad}
        </Button>
      </Box>
      <Text role="status">{invalid ? copy.impairmentLoadInvalid : ""}</Text>
    </Box>
  );
}

function AssetImpairmentReviewList(props: {
  locale: Locale;
  reviews: typeof Controls.AssetImpairmentReviewList.Type;
  onOpen: (id: string) => void;
}) {
  const copy = subledgerCopy(props.locale);
  const executed = new Set(props.reviews.impairments.map((effect) => effect.reviewId));
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      {props.reviews.items.length ? (
        <DataTable
          title={copy.impairmentReviews}
          narrow="stack"
          columns={[
            { id: "created", label: copy.created },
            { id: "postingDate", label: copy.date },
            { id: "decision", label: copy.impairmentDecisionKey },
            { id: "state", label: copy.state },
            { id: "action", label: copy.impairmentOpen },
          ]}
          rows={props.reviews.items.map((review) => ({
            id: review.id,
            cells: [
              review.createdAt,
              review.postingDate,
              review.decisionKey,
              executed.has(review.id) ? copy.impairmentExecuted : copy.impairmentReviewRetained,
              <Button
                key="action"
                type="button"
                variant="outline"
                onClick={() => props.onOpen(review.id)}
              >
                {copy.impairmentOpen}
              </Button>,
            ],
          }))}
        />
      ) : (
        <Text>{copy.impairmentNoReviews}</Text>
      )}
      <PageCaption>{copy.impairmentCoverage}</PageCaption>
    </Box>
  );
}

function completeImpairmentSuffix(schedule: typeof Subledgers.ScheduleView.Type) {
  const start = schedule.occurrences.findIndex(
    (occurrence) => occurrence.state === "unprepared" || occurrence.state === "prepared",
  );
  const occurrences = start < 0 ? [] : schedule.occurrences.slice(start);
  return {
    start,
    occurrences,
    complete:
      start >= 0 &&
      occurrences.length > 0 &&
      occurrences.every(
        (occurrence) => occurrence.state === "unprepared" || occurrence.state === "prepared",
      ),
  };
}

function AssetImpairmentPrepareForm(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  schedule: typeof Subledgers.ScheduleView.Type;
  basis: typeof Controls.SubledgerBasis.Type;
  suffix: (typeof Subledgers.OccurrenceState.Type)[];
  suffixStart: number;
  onPrepared: (id: string) => void;
}) {
  const { book, locale, schedule } = props;
  const copy = subledgerCopy(locale);
  const current = schedule.current;
  const initialCount = Math.max(1, props.suffix.length);
  const [decisionKey, setDecisionKey] = useState(`impair_${crypto.randomUUID()}`);
  const [count, setCount] = useState(initialCount);
  const [impairmentText, setImpairmentText] = useState("");
  const [residualText, setResidualText] = useState(
    minorToDecimal(current.terms.residualMinor, current.currencyScale),
  );
  const [installmentAmounts, setInstallmentAmounts] = useState(() =>
    Array.from({ length: initialCount }, (_, index) =>
      props.suffix[index] ? minorToDecimal(props.suffix[index].amountMinor, current.currencyScale) : "",
    ),
  );
  const futureMinor = impairmentFutureMinor(
    schedule.carryingMinor,
    impairmentText,
    residualText,
    current.currencyScale,
  );
  const installmentTotal = sumPositiveMinor(installmentAmounts, current.currencyScale);
  const ordinaryAccountIds = new Set([
    current.terms.debitAccountId,
    current.terms.creditAccountId,
    ...props.basis.lines.map((line) => line.accountId),
  ]);
  const priorContraAccounts = new Set(
    schedule.impairments.map((effect) => effect.accumulatedImpairmentAccountId),
  );
  const retainedContraAccount = schedule.impairments.at(-1)?.accumulatedImpairmentAccountId;
  const accountOptions = (include: (accountId: string) => boolean) => [
    { value: "", label: copy.impairmentChooseAccount },
    ...props.setup.accounts
      .filter(
        (account) =>
          account.active &&
          !ordinaryAccountIds.has(account.id) &&
          include(account.id),
      )
      .map((account) => ({
        value: account.id,
        label: `${account.code} · ${account.name}`,
      })),
  ];
  const periodOptions = [
    { value: "", label: copy.impairmentChoosePeriod },
    ...props.setup.periods.map((period) => ({
      value: period.id,
      label: `${period.startsOn} – ${period.endsOn}`,
      disabled: period.locked,
    })),
  ];
  const money = (amount: string) =>
    `${formatMinorAmount(amount, current.currencyScale, locale)} ${current.currency}`;
  return (
    <CommandForm
      book={book}
      locale={locale}
      path={`${bookPath(book)}/subledger-controls/impairments/prepare`}
      schema={Subledgers.PrepareAssetImpairment}
      output={Controls.AssetImpairmentReview
      }
      label={copy.impairmentPrepare}
      recoveryId={`${current.scheduleId}:impairment:prepare`}
      input={(fields) => ({
        profile: "synthetic_asset_impairment_v1",
        scheduleId: current.scheduleId,
        decisionKey: fieldText(fields, "decisionKey"),
        expectedDigest: current.digest,
        expectedBasisDigest: props.basis.digest,
        postingDate: fieldText(fields, "postingDate"),
        accountingPeriodId: fieldText(fields, "accountingPeriodId"),
        series: fieldText(fields, "series"),
        lossAccountId: fieldText(fields, "lossAccountId"),
        accumulatedImpairmentAccountId: fieldText(fields, "accumulatedImpairmentAccountId"),
        impairmentMinor: decimalInputMinor(impairmentText, current.currencyScale) ?? "",
        futureMinor: futureMinor ?? "",
        residualMinor: decimalInputMinor(residualText, current.currencyScale) ?? "",
        installments: Array.from({ length: count }, (_, index) => ({
          postingDate: fieldText(fields, `impairmentDate_${index}`),
          accountingPeriodId: fieldText(fields, `impairmentPeriod_${index}`),
          amountMinor:
            decimalInputMinor(installmentAmounts[index] ?? "", current.currencyScale) ?? "",
        })),
        evidenceId: fieldText(fields, "evidenceId"),
        reviewEvidenceId: fieldText(fields, "reviewEvidenceId"),
        rationale: fieldText(fields, "rationale"),
        taxAssessment: "not_applicable",
        acknowledgeSyntheticOnly: true,
      })}
      onSuccess={(review) => props.onPrepared(review.id)}
      onNewCommand={() => {
        setDecisionKey(`impair_${crypto.randomUUID()}`);
        setCount(initialCount);
        setImpairmentText("");
        setResidualText(minorToDecimal(current.terms.residualMinor, current.currencyScale));
        setInstallmentAmounts(
          Array.from({ length: initialCount }, (_, index) =>
            props.suffix[index]
              ? minorToDecimal(props.suffix[index].amountMinor, current.currencyScale)
              : "",
          ),
        );
      }}
      validate={(review) => {
        if (
          review.input.scheduleId !== current.scheduleId ||
          review.input.expectedDigest !== current.digest ||
          review.input.expectedBasisDigest !== props.basis.digest ||
          review.basis.schedule.digest !== current.digest ||
          review.basis.carryingBasis.digest !== props.basis.digest ||
          review.proposedRevision.previousDigest !== current.digest
        ) {
          throw new Error("Impairment preparation binding mismatch");
        }
      }}
    >
      <Box display="grid" gap="lg" minWidth="zero">
        <Text>{copy.impairmentPrepareHelp}</Text>
        <RecordSummary>
          <RecordFact label={copy.basisDigest}>{props.basis.digest}</RecordFact>
          <RecordFact label={copy.impairmentCurrentCarrying}>
            {schedule.carryingMinor ? money(schedule.carryingMinor) : "—"}
          </RecordFact>
          <RecordFact label={copy.impairmentFutureRequired}>
            {futureMinor ? money(futureMinor) : "—"}
          </RecordFact>
        </RecordSummary>
        <Box display="grid" columns={1} columnsAtLg={2} gap="lg">
          <InputField
            label={copy.impairmentDecisionKey}
            name="decisionKey"
            value={decisionKey}
            onChange={(event) => setDecisionKey(event.currentTarget.value)}
            required
            minLength={8}
            maxLength={128}
            pattern="[a-zA-Z0-9_\-]{8,128}"
          />
          <InputField
            label={copy.impairmentAmount}
            name="impairmentMinor"
            value={impairmentText}
            onChange={(event) => setImpairmentText(event.currentTarget.value)}
            inputMode="decimal"
            required
          />
        </Box>
        <Box display="grid" columns={1} columnsAtLg={2} gap="lg">
          <SelectField
            label={copy.impairmentLossAccount}
            name="lossAccountId"
            options={accountOptions((accountId) => !priorContraAccounts.has(accountId))}
            required
          />
          <SelectField
            label={copy.impairmentContraAccount}
            name="accumulatedImpairmentAccountId"
            defaultValue={retainedContraAccount ?? ""}
            options={accountOptions(
              (accountId) => !priorContraAccounts.has(accountId) || accountId === retainedContraAccount,
            )}
            required
          />
        </Box>
        <Box display="grid" columns={1} columnsAtLg={3} gap="lg">
          <InputField
            label={copy.impairmentPostingDate}
            name="postingDate"
            type="date"
            required
          />
          <SelectField
            label={copy.impairmentPostingPeriod}
            name="accountingPeriodId"
            options={periodOptions}
            required
          />
          <InputField
            label={copy.series}
            name="series"
            defaultValue={current.terms.series}
            required
            pattern="[A-Z0-9]{1,16}"
          />
        </Box>
        <Box display="grid" gap="md" minWidth="zero">
          <Text>{copy.impairmentFutureSuffix}</Text>
          {Array.from({ length: count }, (_, index) => {
            const occurrence = props.suffix[index];
            return (
              <Box
                key={index}
                as="fieldset"
                display="grid"
                columns={1}
                columnsAtLg={3}
                gap="md"
                minWidth="zero"
                padding="md"
                borderWidth="thin"
                borderColor="default"
                borderRadius="control"
              >
                <legend>{copy.impairmentInstallment} {props.suffixStart + index + 1}</legend>
                <InputField
                  label={copy.date}
                  name={`impairmentDate_${index}`}
                  type="date"
                  defaultValue={occurrence?.postingDate}
                  required
                />
                <SelectField
                  label={copy.period}
                  name={`impairmentPeriod_${index}`}
                  defaultValue={occurrence?.accountingPeriodId}
                  options={periodOptions}
                  required
                />
                <InputField
                  label={copy.amount}
                  name={`impairmentAmount_${index}`}
                  value={installmentAmounts[index] ?? ""}
                  onChange={(event) =>
                    setInstallmentAmounts((amounts) =>
                      amounts.map((amount, amountIndex) =>
                        amountIndex === index ? event.currentTarget.value : amount,
                      ),
                    )
                  }
                  inputMode="decimal"
                  required
                />
              </Box>
            );
          })}
          <Box display="flex" gap="md" flexWrap="wrap">
            <Button
              type="button"
              variant="outline"
              disabled={count >= 120 - props.suffixStart}
              onClick={() => {
                setCount((value) => value + 1);
                setInstallmentAmounts((amounts) => [...amounts, ""]);
              }}
            >
              {copy.amendmentAdd}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={count <= 1}
              onClick={() => {
                setCount((value) => value - 1);
                setInstallmentAmounts((amounts) => amounts.slice(0, -1));
              }}
            >
              {copy.amendmentRemove}
            </Button>
          </Box>
          <InputField
            label={copy.impairmentResidual}
            name="residualMinor"
            value={residualText}
            onChange={(event) => setResidualText(event.currentTarget.value)}
            inputMode="decimal"
            required
          />
          <Text role="status">
            {installmentTotal && futureMinor
              ? installmentTotal === futureMinor
                ? copy.impairmentInstallmentTotalMatches
                : `${copy.impairmentInstallmentTotalMismatch} ${money(installmentTotal)} / ${money(futureMinor)}`
              : copy.impairmentInstallmentTotalPending}
          </Text>
        </Box>
        <Box display="grid" columns={1} columnsAtLg={2} gap="lg">
          <InputField
            label={copy.impairmentSourceEvidence}
            name="evidenceId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <InputField
            label={copy.impairmentReviewEvidence}
            name="reviewEvidenceId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
        </Box>
        <TextareaField
          label={copy.impairmentRationale}
          name="rationale"
          required
          rows={3}
          maxLength={2000}
        />
        <Box as="label" display="flex" alignItems="start" gap="md">
          <input type="checkbox" required />
          <Text>{copy.impairmentAcknowledge}</Text>
        </Box>
      </Box>
    </CommandForm>
  );
}

function decimalInputMinor(value: string, scale: number) {
  return value.trim() ? decimalToMinor(value, scale) : null;
}

function impairmentFutureMinor(
  carryingMinor: string | null,
  impairmentText: string,
  residualText: string,
  scale: number,
) {
  if (carryingMinor === null) return null;
  const impairmentMinor = decimalInputMinor(impairmentText, scale);
  const residualMinor = decimalInputMinor(residualText, scale);
  if (
    impairmentMinor === null ||
    residualMinor === null ||
    BigInt(impairmentMinor) <= 0n
  ) {
    return null;
  }
  const future = BigInt(carryingMinor) - BigInt(impairmentMinor) - BigInt(residualMinor);
  return future > 0n ? future.toString() : null;
}

function sumPositiveMinor(values: readonly string[], scale: number) {
  let total = 0n;
  for (const value of values) {
    const minor = decimalInputMinor(value, scale);
    if (minor === null || BigInt(minor) <= 0n) return null;
    total += BigInt(minor);
  }
  return total.toString();
}

function AssetImpairmentReviewDetail(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  schedule: typeof Subledgers.ScheduleView.Type;
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const { book, locale, id, schedule } = props;
  const copy = subledgerCopy(locale);
  const path = `${bookPath(book)}/subledger-controls/impairments/${encodeURIComponent(id)}`;
  const review = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "impairment-review", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Controls.AssetImpairmentReviewView, { signal });
      const retained = result.impairment;
      if (
        result.review.id !== id ||
        result.review.scope.bookId !== book.id ||
        result.review.scope.entityId !== book.entityId ||
        result.review.input.scheduleId !== schedule.current.scheduleId ||
        result.review.basis.schedule.scheduleId !== schedule.current.scheduleId ||
        result.review.postingPlan.scope.bookId !== book.id ||
        result.review.postingPlan.scope.entityId !== book.entityId ||
        result.approvals.some(
          (approval) =>
            approval.reviewId !== id ||
            approval.reviewDigest !== result.review.digest ||
            approval.scope.bookId !== book.id ||
            approval.scope.entityId !== book.entityId,
        ) ||
        (retained !== null &&
          (retained.reviewId !== id ||
            retained.reviewDigest !== result.review.digest ||
            retained.scheduleId !== schedule.current.scheduleId))
      ) {
        throw new Error("Impairment review identity mismatch");
      }
      return result;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const data = review.data;
  const approval = data?.approvals.at(-1);
  const approvalCurrent = approval !== undefined && Date.parse(approval.expiresAt) > Date.now();
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box display="flex" gap="md" flexWrap="wrap">
        <Button type="button" variant="ghost" onClick={props.onBack}>
          {copy.impairmentBack}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={review.isFetching}
          onClick={() => void review.refetch()}
        >
          {copy.impairmentRefresh}
        </Button>
      </Box>
      <AssetImpairmentReviewLookup locale={locale} onOpen={props.onOpen} />
      <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
      {data ? (
        <>
          <WorkflowSteps
            label={copy.impairmentWorkflow}
            current={data.impairment ? 2 : approvalCurrent ? 1 : 0}
            labels={[copy.impairmentPrepared, copy.impairmentApproved, copy.impairmentExecuted]}
          />
          <RecordHeading
            title={`${copy.impairmentReview} ${data.review.id}`}
            subtitle={`${copy.impairmentReviewDigest} ${data.review.digest}`}
          />
          <RecordSummary>
            <RecordFact label={copy.state}>
              {data.impairment
                ? copy.impairmentExecuted
                : approvalCurrent
                  ? copy.impairmentApproved
                  : copy.impairmentPrepared}
            </RecordFact>
            <RecordFact label={copy.basisDigest}>{data.review.basis.carryingBasis.digest}</RecordFact>
            <RecordFact label={copy.impairmentCurrentCarrying}>
              {formatMinorAmount(
                data.review.basis.currentCarryingMinor,
                data.review.proposedRevision.currencyScale,
                locale,
              )}{" "}
              {data.review.proposedRevision.currency}
            </RecordFact>
            <RecordFact label={copy.impairmentPostCarrying}>
              {formatMinorAmount(
                data.review.basis.postImpairmentCarryingMinor,
                data.review.proposedRevision.currencyScale,
                locale,
              )}{" "}
              {data.review.proposedRevision.currency}
            </RecordFact>
          </RecordSummary>
          <PageCaption>{copy.impairmentAuthorizationRead}</PageCaption>
          <AssetImpairmentReviewFacts book={book} review={data.review} locale={locale} />
          <AssetImpairmentApprovalHistory
            locale={locale}
            approvals={data.approvals}
            effect={data.impairment}
          />
          {!data.impairment ? (
            <AssetImpairmentReviewActions
              book={book}
              locale={locale}
              id={id}
              review={data.review}
              approval={approval}
              approvalCurrent={approvalCurrent}
              approvalCount={data.approvals.length}
              busy={review.isFetching}
            />
          ) : null}
          <AssetImpairmentConsequences
            locale={locale}
            review={data.review}
            effect={data.impairment}
            disposal={schedule.disposal}
          />
        </>
      ) : null}
    </Box>
  );
}

function AssetImpairmentReviewFacts(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  review: typeof Controls.AssetImpairmentReview.Type;
}) {
  const { book, locale, review } = props;
  const copy = subledgerCopy(locale);
  const scale = review.proposedRevision.currencyScale;
  const money = (amount: string) =>
    `${formatMinorAmount(amount, scale, locale)} ${review.proposedRevision.currency}`;
  const lines = review.postingPlan.groups.flatMap((group) =>
    group.actions.flatMap((action) =>
      action.lines.map((line) => ({
        action,
        line,
      })),
    ),
  );
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <RecordSection title={copy.impairmentBasis}>
        <Text>
          {copy.basisDigest}: {review.basis.carryingBasis.digest}
        </Text>
        <Text>
          {copy.amendmentScheduleDigest}: {review.basis.schedule.digest}
        </Text>
        <Text>
          {copy.impairmentDecisionKey}: {review.input.decisionKey}
        </Text>
        <Text>
          {copy.impairmentPostingDate}: {review.input.postingDate} · {copy.period}:{" "}
          {review.input.accountingPeriodId} · {copy.series}: {review.input.series}
        </Text>
        <Text>
          {copy.impairmentLossAccount}: {review.input.lossAccountId} ·{" "}
          {copy.impairmentContraAccount}: {review.input.accumulatedImpairmentAccountId}
        </Text>
        <Text>
          {copy.impairment}: {money(review.input.impairmentMinor)} · {copy.future}:{" "}
          {money(review.basis.futureMinor)} · {copy.impairmentResidual}:{" "}
          {money(review.input.residualMinor)}
        </Text>
        <Text>{review.input.rationale}</Text>
        <EvidenceInspector
          book={book}
          locale={locale}
          reference={{
            evidenceId: review.input.evidenceId,
            sha256: review.basis.sourceSha256,
            locator: review.input.evidenceId,
          }}
        />
        <EvidenceInspector
          book={book}
          locale={locale}
          reference={{
            evidenceId: review.input.reviewEvidenceId,
            sha256: review.basis.reviewSha256,
            locator: review.input.reviewEvidenceId,
          }}
        />
      </RecordSection>
      <RecordSection title={copy.impairmentProposedLines}>
        <Text>
          {copy.impairmentChangeSet}: {review.postingPlan.id} · {copy.digest}:{" "}
          {review.postingPlan.planDigest}
        </Text>
        <DataTable
          title={copy.impairmentProposedLines}
          narrow="stack"
          columns={[
            { id: "account", label: copy.debit },
            { id: "debit", label: copy.impairmentCurrentCarrying, numeric: true },
            { id: "credit", label: copy.impairmentPostCarrying, numeric: true },
            { id: "description", label: copy.impairmentReview },
          ]}
          rows={lines.map(({ action, line }) => ({
            id: `${action.eventId}:${line.lineId}`,
            cells: [line.accountId, money(line.debitMinor), money(line.creditMinor), line.description],
          }))}
        />
      </RecordSection>
      <RecordSection title={copy.impairmentFutureSuffix}>
        <DataTable
          title={copy.impairmentFutureSuffix}
          narrow="stack"
          columns={[
            { id: "date", label: copy.date },
            { id: "period", label: copy.period },
            { id: "amount", label: copy.amount, numeric: true },
          ]}
          rows={review.input.installments.map((installment, index) => ({
            id: String(index + 1),
            cells: [installment.postingDate, installment.accountingPeriodId, money(installment.amountMinor)],
          }))}
        />
        <Text>
          {copy.digest}: {review.proposedRevision.digest}
        </Text>
      </RecordSection>
    </Box>
  );
}

function AssetImpairmentApprovalHistory(props: {
  locale: Locale;
  approvals: readonly (typeof Controls.AssetImpairmentApproval.Type)[];
  effect: typeof Controls.AssetImpairment.Type | null;
}) {
  const copy = subledgerCopy(props.locale);
  return (
    <RecordSection title={copy.impairmentApprovals}>
      {props.approvals.length ? (
        <DataTable
          title={copy.impairmentApprovals}
          narrow="stack"
          columns={[
            { id: "approval", label: copy.impairmentApproval },
            { id: "actor", label: copy.impairmentApprovalActor },
            { id: "expires", label: copy.impairmentApprovalExpiry },
            { id: "digest", label: copy.digest },
            { id: "state", label: copy.state },
          ]}
          rows={props.approvals.map((approval) => ({
            id: approval.id,
            cells: [
              approval.id,
              approval.actorId,
              approval.expiresAt,
              approval.digest,
              props.effect?.approvalId === approval.id
                ? copy.impairmentApprovalUsed
                : Date.parse(approval.expiresAt) <= Date.now()
                  ? copy.impairmentExpired
                  : copy.impairmentCurrent,
            ],
          }))}
        />
      ) : (
        <Text>{copy.impairmentNoApprovals}</Text>
      )}
    </RecordSection>
  );
}

function AssetImpairmentReviewActions(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  id: string;
  review: typeof Controls.AssetImpairmentReview.Type;
  approval: typeof Controls.AssetImpairmentApproval.Type | undefined;
  approvalCurrent: boolean;
  approvalCount: number;
  busy: boolean;
}) {
  const { book, locale, review } = props;
  const copy = subledgerCopy(locale);
  const path = `${bookPath(book)}/subledger-controls/impairments/${encodeURIComponent(props.id)}`;
  return (
    <RecordSection title={copy.impairmentActions}>
      <Text>{copy.impairmentApprovalHelp}</Text>
      {!props.approvalCurrent ? (
        <CommandForm
          key={`approve:${review.digest}:${props.approvalCount}`}
          book={book}
          locale={locale}
          path={`${path}/approve`}
          schema={Controls.ApproveAssetImpairment
          }
          output={Controls.AssetImpairmentApproval
          }
          label={copy.impairmentApprove}
          recoveryId={`${props.id}:impairment:approve`}
          allowed={book.role === "operator" && !props.busy}
          input={() => ({ version: 1, digest: review.digest, acknowledgeSyntheticOnly: true })}
          onSuccess={(approval) => {
            if (approval.reviewId !== props.id || approval.reviewDigest !== review.digest)
              throw new Error("Impairment approval binding mismatch");
          }}
        >
          <Box as="label" display="flex" alignItems="start" gap="md">
            <input type="checkbox" required />
            <Text>{copy.impairmentApproveAcknowledge}</Text>
          </Box>
        </CommandForm>
      ) : null}
      {props.approval ? (
        <Text>
          {copy.impairmentApproval}: {props.approval.id} · {copy.impairmentApprovalActor}:{" "}
          {props.approval.actorId} · {copy.impairmentApprovalExpiry}: {props.approval.expiresAt}
        </Text>
      ) : null}
      {props.approvalCurrent ? (
        <CommandForm
          key={`execute:${review.digest}:${props.approvalCount}`}
          book={book}
          locale={locale}
          path={`${path}/execute`}
          schema={Controls.ExecuteAssetImpairment
          }
          output={Controls.AssetImpairment
          }
          label={copy.impairmentExecute}
          recoveryId={`${props.id}:impairment:execute`}
          allowed={book.role === "operator" && !props.busy}
          input={() => ({
            version: 1,
            digest: review.digest,
            approvalId: props.approval?.id ?? "",
            acknowledgeSyntheticOnly: true,
          })}
          onSuccess={(effect) => {
            if (
              effect.reviewId !== props.id ||
              effect.reviewDigest !== review.digest ||
              effect.approvalId !== props.approval?.id
            ) {
              throw new Error("Impairment execution binding mismatch");
            }
          }}
        >
          <Box as="label" display="flex" alignItems="start" gap="md">
            <input type="checkbox" required />
            <Text>{copy.impairmentExecuteAcknowledge}</Text>
          </Box>
        </CommandForm>
      ) : null}
    </RecordSection>
  );
}

function AssetImpairmentConsequences(props: {
  locale: Locale;
  review: typeof Controls.AssetImpairmentReview.Type;
  effect: typeof Controls.AssetImpairment.Type | null;
  disposal: typeof Subledgers.AssetDisposal.Type | null | undefined;
}) {
  const { locale, review, effect, disposal } = props;
  const copy = subledgerCopy(locale);
  const scale = review.proposedRevision.currencyScale;
  const currency = review.proposedRevision.currency;
  const money = (amount: string) => `${formatMinorAmount(amount, scale, locale)} ${currency}`;
  const ordinaryAccumulated = addMinorStrings(
    effect?.openingAccumulatedMinor ?? "0",
    effect?.recognizedMinor ?? "0",
  );
  const grossRows = effect
    ? review.basis.carryingBasis.lines
        .filter((line) => BigInt(line.debitMinor) > 0n)
        .map((line) => ({
          id: `gross:${line.lineId}`,
          cells: [copy.impairmentGrossCredit, line.accountId, money(line.debitMinor)],
        }))
    : [];
  const disposalRows = effect
    ? [
        ...grossRows,
        {
          id: "ordinary",
          cells: [
            copy.impairmentOrdinaryDebit,
            review.basis.schedule.terms.creditAccountId,
            money(ordinaryAccumulated),
          ],
        },
        {
          id: "impairment",
          cells: [
            copy.impairmentContraDebit,
            effect.accumulatedImpairmentAccountId,
            money(effect.netImpairmentMinor),
          ],
        },
        {
          id: "carrying",
          cells: [
            copy.impairmentCarryingLoss,
            copy.impairmentDisposalLossAccount,
            money(effect.postImpairmentCarryingMinor),
          ],
        },
      ]
    : [];
  return (
    <>
      <RecordSection title={copy.impairmentControl}>
        {effect ? (
          <>
            <Text role="status">{copy.impairmentControlEffect}</Text>
            <RecordSummary>
              <RecordFact label={copy.impairmentContraAccount}>
                {effect.accumulatedImpairmentAccountId}
              </RecordFact>
              <RecordFact label={copy.impairment}>
                {money(effect.netImpairmentMinor)}
              </RecordFact>
              <RecordFact label={copy.carrying}>
                {money(effect.postImpairmentCarryingMinor)}
              </RecordFact>
            </RecordSummary>
            <Text>
              {copy.impairmentReceipt}: {effect.postingReceipt.id} · {copy.voucher}:{" "}
              {effect.postingReceipt.voucherId} · {effect.postingReceipt.committedAt}
            </Text>
            <Text>{copy.impairmentControlCoverage}</Text>
          </>
        ) : (
          <Text>{copy.impairmentNoControlEffect}</Text>
        )}
      </RecordSection>
      <RecordSection title={copy.impairmentDisposal}>
        {effect ? (
          <>
            <Text>{copy.impairmentDisposalAtExecution}</Text>
            <DataTable
              title={copy.impairmentDisposalAtExecution}
              narrow="stack"
              columns={[
                { id: "consequence", label: copy.impairmentConsequence },
                { id: "account", label: copy.debit },
                { id: "amount", label: copy.amount, numeric: true },
              ]}
              rows={disposalRows}
            />
            <Text>{copy.impairmentFreshDisposal}</Text>
          </>
        ) : (
          <Text>{copy.impairmentNoDisposalEffect}</Text>
        )}
        {disposal ? (
          <Box role="status" display="grid" gap="sm">
            <Text>{copy.impairmentDisposalCommitted}</Text>
            <Text>
              {copy.voucher}: {disposal.postingReceipt.voucherId} · {copy.impairmentReceipt}:{" "}
              {disposal.postingReceipt.id}
            </Text>
            <Text>
              {copy.impairmentContraDebit}: {money(disposal.impairmentMinorReleased ?? "0")} ·{" "}
              {copy.impairmentCarryingLoss}: {money(disposal.carryingMinorReleased)}
            </Text>
          </Box>
        ) : null}
      </RecordSection>
    </>
  );
}

function addMinorStrings(...values: string[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
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

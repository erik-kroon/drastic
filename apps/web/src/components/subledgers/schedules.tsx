import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import { PageEmpty, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { InputField } from "@open-erp/ui/components/field";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { subledgerCopy } from "./copy";
import { ScheduleForm } from "./schedule-form";
import { ScheduleEvidence } from "./schedule-evidence";

type Props = {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
  locale: Locale;
  onPrepared: (id: string) => void;
  open?: boolean;
};
export function SubledgersPanel(props: Props) {
  const { book, setup, locale, onPrepared } = props;
  const copy = subledgerCopy(locale);
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
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
  return (
    <details open={props.open} id="subledgers" tabIndex={-1}>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <RecordHeading
          title={copy.title}
          action={
            setup?.blockers.length === 0 ? (
              <Button onClick={() => setCreating(true)}>{copy.create}</Button>
            ) : undefined
          }
        />
        {creating && setup ? (
          <FormDialog
            title={copy.create}
            closeLabel={locale === "sv" ? "Stäng" : "Close"}
            onClose={() => setCreating(false)}
          >
            <Box display="grid" gap="lg">
              <ScheduleForm book={book} setup={setup} locale={locale} onSaved={saved} />
              <ScheduleEvidence book={book} locale={locale} />
            </Box>
          </FormDialog>
        ) : null}
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button
            size="xl"
            variant="outline"
            disabled={schedules.isFetching}
            onClick={() => {
              void schedules.refetch();
            }}
          >
            {copy.refresh}
          </Button>
          {after ? (
            <Button size="xl" variant="ghost" onClick={() => setAfter(null)}>
              {copy.first}
            </Button>
          ) : null}
        </Box>
        <AccountingStatus locale={locale} pending={schedules.isPending} error={schedules.error} />
        {schedules.data ? (
          <>
            {schedules.data.items.length === 0 ? (
              <PageEmpty title={copy.empty} />
            ) : (
              <DataTable
                title={copy.title}
                narrow="stack"
                columns={[
                  { id: "name", label: copy.name },
                  { id: "source", label: copy.sourceKey },
                  { id: "revision", label: copy.revision },
                  { id: "action", label: copy.load },
                ]}
                rows={schedules.data.items.map((schedule) => ({
                  id: schedule.id,
                  cells: [
                    <RecordOpen key="name" onClick={() => setSelected(schedule.id)}>
                      {schedule.name}
                    </RecordOpen>,
                    schedule.sourceKey,
                    schedule.revision,
                    <Button
                      key={schedule.id}
                      size="xl"
                      variant="outline"
                      onClick={() => setSelected(schedule.id)}
                    >
                      {copy.load} · {schedule.name}
                    </Button>,
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
        <Disclosure
          title={locale === "sv" ? "Omfattning och begränsningar" : "Scope and limitations"}
        >
          <Text>{copy.warning}</Text>
          <Text>{copy.unsupported}</Text>
        </Disclosure>
        {selected ? (
          <ScheduleDetail
            key={selected}
            book={book}
            setup={setup}
            locale={locale}
            onPrepared={onPrepared}
            id={selected}
            onSaved={saved}
          />
        ) : null}
      </Box>
    </details>
  );
}

function ScheduleDetail(props: Props & { id: string; onSaved: (id: string) => void }) {
  const { book, setup, locale, id } = props;
  const copy = subledgerCopy(locale);
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
      {view ? (
        <>
          <Heading>{view.current.terms.name}</Heading>
          <Text>
            {view.current.scheduleId} · {copy.revision} {view.current.revision} ·{" "}
            {view.current.currency}
          </Text>
          <Text>
            {copy.digest}: {view.current.digest}
          </Text>
          <Text>
            {copy.recognized}: {view.recognizedMinor}
          </Text>
          <Text>
            {copy.remaining}: {view.remainingMinor}
          </Text>
          <Text>{copy.balanceHelp}</Text>
          <ScheduleBasisNotice basis={view.postingBasis} locale={locale} />
          <EvidenceInspector
            book={book}
            locale={locale}
            reference={{
              evidenceId: view.current.terms.evidenceId,
              sha256: view.current.sourceSha256,
              locator: view.current.sourceKey,
            }}
          />
          <DataTable
            title={copy.occurrence}
            narrow="stack"
            columns={[
              { id: "ordinal", label: copy.occurrence },
              { id: "date", label: copy.date },
              { id: "period", label: copy.period },
              { id: "amount", label: copy.amount, numeric: true },
              { id: "state", label: copy.state },
              { id: "actions", label: copy.review },
            ]}
            rows={view.occurrences.map((occurrence) => ({
              id: String(occurrence.ordinal),
              cells: [
                occurrence.ordinal,
                occurrence.postingDate,
                occurrence.accountingPeriodId,
                occurrence.amountMinor,
                <Box key="state" display="grid" gap="sm">
                  <Text>{stateLabels[occurrence.state]}</Text>
                  <Text>{occurrence.voucherId}</Text>
                  <Text>{occurrence.reversalVoucherId}</Text>
                </Box>,
                <Box key="actions" display="grid" gap="sm">
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
                      {copy.prepare} · {occurrence.ordinal}
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
                      { id: "amount", label: copy.amount, numeric: true },
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
          {view.revisionAllowed && setup?.blockers.length === 0 ? (
            <details>
              <summary>{copy.revise}</summary>
              <Box paddingBlock="lg">
                <ScheduleForm
                  key={view.current.digest}
                  book={book}
                  setup={setup}
                  locale={locale}
                  current={view.current}
                  onSaved={props.onSaved}
                />
              </Box>
            </details>
          ) : (
            <Text>{copy.frozen}</Text>
          )}
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

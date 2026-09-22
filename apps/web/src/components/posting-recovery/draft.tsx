import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { ArrowRight } from "lucide-react";
import {
  EntryRow,
  EntryTotals,
  Disclosure,
  WorkflowSurface,
} from "@open-erp/ui/components/workflow";
import { Label } from "@open-erp/ui/components/label";
import { Heading, Text } from "@open-erp/ui/components/typography";
import {
  SavedPostingOutcome,
  SavedPostingRequestsPanel,
  useSavedPostingRequests,
} from "./saved-requests";
import { sendSavedPostingCommand } from "./request";
import { postingCopy } from "./copy";
import { decimalToMinor, formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import { bookKey } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function PostingDraft({
  book,
  setup,
  locale,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const evidenceForm = useRef<HTMLFormElement>(null);
  const [inputError, setInputError] = useState("");
  const posting = postingCopy(locale);
  const requests = useSavedPostingRequests(book);
  const client = useQueryClient();
  const [retainedEvidence, setRetainedEvidence] = useState<typeof Accounting.Evidence.Type | null>(
    null,
  );
  const evidence = useMutation({
    mutationFn: (payload: typeof Accounting.CreateEvidence.Type) => {
      if (!requests.data || requests.isError) throw new Error(posting.unknown);
      return sendSavedPostingCommand({
        book,
        actorId: requests.data.actorId,
        command: { operation: "create_evidence", input: payload },
        storageMessage: posting.storage,
      });
    },
    onSuccess: (saved) => {
      if (
        saved.outcome?.state === "committed" &&
        Schema.is(Accounting.Evidence)(saved.outcome.result)
      )
        setRetainedEvidence(saved.outcome.result);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
    },
  });
  return (
    <Box id="journal-draft" tabIndex={-1} display="grid" gap="md">
      <Box display="grid" gap="xl" minWidth="zero">
        <WorkflowSurface>
          <Box
            as="form"
            ref={evidenceForm}
            display="grid"
            gap="lg"
            onSubmit={(event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              const decoded = Schema.decodeUnknownOption(Accounting.CreateEvidence)({
                title: fields.get("title"),
                content: fields.get("content"),
                origin: fields.get("origin"),
                mediaType: "text/plain",
              });
              if (decoded._tag === "None") {
                setInputError(copy.journal_invalid);
                return;
              }
              setInputError("");
              evidence.mutate(decoded.value);
            }}
          >
            <Box display="grid" gap="sm">
              <Heading>
                {retainedEvidence ? copy.workspace_source_saved : copy.journal_evidence}
              </Heading>
              <Text tone="muted">
                {retainedEvidence ? retainedEvidence.title : copy.journal_evidence_help}
              </Text>
            </Box>
            {!retainedEvidence ? (
              <>
                <Box
                  as="fieldset"
                  disabled={
                    evidence.isPending ||
                    retainedEvidence !== null ||
                    requests.isPending ||
                    requests.isError
                  }
                  borderWidth="none"
                  padding="none"
                  margin="none"
                  minWidth="zero"
                  display="grid"
                  gap="lg"
                >
                  <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
                    <InputField
                      label={copy.journal_title_field}
                      name="title"
                      placeholder={copy.workspace_source_title_example}
                      required
                      maxLength={2000}
                    />
                    <InputField
                      label={copy.journal_origin}
                      name="origin"
                      placeholder={copy.workspace_source_origin_example}
                      required
                      maxLength={2000}
                    />
                  </Box>
                  <Box display="grid" gap="sm" minWidth="zero">
                    <Label htmlFor="evidence-content">{copy.journal_content}</Label>
                    <Box
                      display="grid"
                      minWidth="zero"
                      borderWidth="thin"
                      borderColor="default"
                      borderRadius="control"
                      backgroundColor="surface"
                      padding="md"
                    >
                      <textarea
                        id="evidence-content"
                        name="content"
                        placeholder={copy.workspace_source_content_example}
                        rows={7}
                        cols={16}
                        required
                        maxLength={65536}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Button type="submit" size="xl">
                      {posting.saveEvidence} <ArrowRight size={16} aria-hidden="true" />
                    </Button>
                  </Box>
                </Box>
              </>
            ) : null}
            {inputError ? <Text role="status">{inputError}</Text> : null}
            {evidence.isPending ? <Text role="status">{posting.pending}</Text> : null}
            {evidence.isError ? (
              <Text role="alert">
                {posting.commandUnknown} {evidence.error.message}
              </Text>
            ) : null}
            {evidence.data && !retainedEvidence ? (
              <SavedPostingOutcome saved={evidence.data} locale={locale} />
            ) : null}
            {retainedEvidence ? (
              <Box role="status" display="grid" gap="sm">
                <Disclosure title={copy.workspace_source_details}>
                  <Text tone="muted">{retainedEvidence.origin}</Text>
                  <Text tone="muted">
                    {retainedEvidence.id} · SHA-256: {retainedEvidence.sha256}
                  </Text>
                </Disclosure>
                <Box>
                  <Button
                    size="xl"
                    variant="outline"
                    onClick={() => {
                      setRetainedEvidence(null);
                      evidence.reset();
                      setInputError("");
                      evidenceForm.current?.reset();
                    }}
                  >
                    {posting.anotherEvidence}
                  </Button>
                </Box>
              </Box>
            ) : null}
          </Box>
        </WorkflowSurface>
        {retainedEvidence ? (
          <WorkflowSurface>
            <JournalForm
              key={retainedEvidence.id}
              book={book}
              setup={setup}
              evidenceId={retainedEvidence.id}
              locale={locale}
              onPrepared={onPrepared}
            />
          </WorkflowSurface>
        ) : null}
        <Disclosure title={posting.savedTitle}>
          <SavedPostingRequestsPanel
            book={book}
            locale={locale}
            accounts={setup.accounts}
            onPrepared={onPrepared}
            onEvidence={setRetainedEvidence}
          />
        </Disclosure>
      </Box>
    </Box>
  );
}

function JournalForm(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  evidenceId: string;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const { book, setup, locale, onPrepared } = props;
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const requests = useSavedPostingRequests(book);
  const posting = postingCopy(locale);
  const nextLine = useRef(3);
  const [lines, setLines] = useState([
    { id: 1, debit: "", credit: "" },
    { id: 2, debit: "", credit: "" },
  ]);
  const [eventKey] = useState(() => `journal_${crypto.randomUUID()}`);
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = metadata.data?.currencyScale;
  const parsed =
    scale === undefined
      ? []
      : lines.map((line) => ({
          debit: decimalToMinor(line.debit, scale),
          credit: decimalToMinor(line.credit, scale),
        }));
  const amountsValid =
    parsed.length === lines.length &&
    parsed.every((line) => line.debit !== null && line.credit !== null);
  const debitTotal = parsed.reduce((sum, line) => sum + BigInt(line.debit ?? "0"), 0n);
  const creditTotal = parsed.reduce((sum, line) => sum + BigInt(line.credit ?? "0"), 0n);
  const balanced = amountsValid && debitTotal > 0n && debitTotal === creditTotal;
  const [inputError, setInputError] = useState("");
  const prepare = useMutation({
    mutationFn: (payload: typeof Accounting.PrepareJournal.Type) => {
      if (!requests.data || requests.isError) throw new Error(posting.unknown);
      return sendSavedPostingCommand({
        book,
        actorId: requests.data.actorId,
        command: { operation: "prepare_journal", input: payload },
        storageMessage: posting.storage,
      });
    },
    onSuccess: (saved) => {
      if (
        saved.outcome?.state === "committed" &&
        Schema.is(Accounting.ChangeSet)(saved.outcome.result)
      ) {
        const plan = saved.outcome.result;
        client.setQueryData([...bookKey(book), "change-set", plan.id], plan);
        onPrepared(plan.id);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
    },
  });
  function submit(form: HTMLFormElement) {
    if (scale === undefined || !amountsValid) {
      setInputError(copy.workspace_amount_invalid);
      return;
    }
    const fields = new FormData(form);
    const decoded = Schema.decodeUnknownOption(Accounting.PrepareJournal)({
      kind: "manual_journal",
      evidenceId: props.evidenceId,
      taxAssessment: "not_applicable",
      eventKey: fields.get("eventKey"),
      accountingPeriodId: fields.get("period"),
      postingDate: fields.get("date"),
      series: fields.get("series"),
      description: fields.get("description"),
      rationale: fields.get("rationale"),
      lines: lines.map((line) => ({
        accountId: fields.get(`account-${line.id}`),
        debitMinor: decimalToMinor(line.debit, scale),
        creditMinor: decimalToMinor(line.credit, scale),
        description: fields.get(`description-${line.id}`) || fields.get("description"),
      })),
    });
    if (decoded._tag === "None") {
      setInputError(copy.journal_invalid);
      return;
    }
    const journal = decoded.value;
    const debit = journal.lines.reduce((total, line) => total + BigInt(line.debitMinor), 0n);
    const credit = journal.lines.reduce((total, line) => total + BigInt(line.creditMinor), 0n);
    if (
      debit === 0n ||
      debit !== credit ||
      journal.lines.some(
        (line) => (BigInt(line.debitMinor) === 0n) === (BigInt(line.creditMinor) === 0n),
      )
    ) {
      setInputError(copy.journal_balance_error);
      return;
    }
    setInputError("");
    prepare.mutate(journal);
  }
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
    >
      <Heading>{copy.journal_prepare}</Heading>
      {metadata.isError ? <Text role="alert">{copy.workspace_currency_unavailable}</Text> : null}
      {metadata.isError ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              void metadata.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      <Text tone="muted">{copy.journal_manual_scope}</Text>
      <Box
        as="fieldset"
        disabled={
          scale === undefined ||
          metadata.isError ||
          prepare.isPending ||
          prepare.data?.outcome?.state === "committed" ||
          requests.isPending ||
          requests.isError
        }
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <SelectField
            label={copy.journal_period}
            name="period"
            required
            options={setup.periods.map((period) => ({
              value: period.id,
              label: `${period.startsOn} – ${period.endsOn}${period.locked ? ` · ${copy.journal_locked}` : ""}`,
              disabled: period.locked,
            }))}
          />
          <InputField label={copy.journal_date} name="date" type="date" required />
          <InputField
            label={copy.journal_series}
            name="series"
            defaultValue="A"
            required
            pattern="[A-Z0-9]{1,16}"
            maxLength={16}
          />
          <InputField
            label={copy.journal_description}
            name="description"
            required
            maxLength={2000}
          />
        </Box>
        <InputField label={copy.journal_rationale} name="rationale" required maxLength={2000} />
        <Disclosure title={copy.workspace_reference_details}>
          {" "}
          <InputField
            label={copy.journal_event}
            name="eventKey"
            defaultValue={eventKey}
            required
            pattern="[a-zA-Z0-9_\-]{1,128}"
            maxLength={128}
            aria-describedby="event-help"
          />
          <Text id="event-help" tone="muted">
            {copy.journal_event_help}
          </Text>
        </Disclosure>
        {lines.map((line, index) => (
          <EntryRow
            key={line.id}
            label={`${copy.journal_line} ${index + 1}`}
            detail={
              <>
                <InputField
                  label={copy.workspace_line_note}
                  name={`description-${line.id}`}
                  maxLength={2000}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={lines.length <= 2}
                  aria-label={`${copy.journal_remove_line} ${index + 1}`}
                  onClick={() => setLines(lines.filter((item) => item.id !== line.id))}
                >
                  {copy.journal_remove_line}
                </Button>
              </>
            }
          >
            <SelectField
              label={copy.journal_account}
              name={`account-${line.id}`}
              required
              options={setup.accounts.map((account) => ({
                value: account.id,
                label: `${account.code} · ${account.name}`,
                disabled: !account.active,
              }))}
            />
            <InputField
              label={`${copy.workspace_debit} (${book.currency})`}
              name={`debit-${line.id}`}
              inputMode="decimal"
              placeholder={scale === 0 ? "0" : `0.${"0".repeat(scale ?? 2)}`}
              value={line.debit}
              maxLength={45}
              onChange={(event) =>
                setLines(
                  lines.map((item) =>
                    item.id === line.id ? { ...item, debit: event.target.value } : item,
                  ),
                )
              }
            />
            <InputField
              label={`${copy.workspace_credit} (${book.currency})`}
              name={`credit-${line.id}`}
              inputMode="decimal"
              placeholder={scale === 0 ? "0" : `0.${"0".repeat(scale ?? 2)}`}
              value={line.credit}
              maxLength={45}
              onChange={(event) =>
                setLines(
                  lines.map((item) =>
                    item.id === line.id ? { ...item, credit: event.target.value } : item,
                  ),
                )
              }
            />
          </EntryRow>
        ))}
        {scale !== undefined ? (
          <EntryTotals>
            <Box display="grid" gap="sm">
              <Text tone="muted">{copy.workspace_debit}</Text>
              <Text>
                {formatMinorAmount(debitTotal.toString(), scale, locale)} {book.currency}
              </Text>
            </Box>
            <Box display="grid" gap="sm">
              <Text tone="muted">{copy.workspace_credit}</Text>
              <Text>
                {formatMinorAmount(creditTotal.toString(), scale, locale)} {book.currency}
              </Text>
            </Box>
            <Box display="grid" gap="sm">
              <Text tone="muted">
                {balanced ? copy.workspace_balanced : copy.workspace_difference}
              </Text>
              <Text>
                {amountsValid
                  ? `${formatMinorAmount((debitTotal - creditTotal).toString(), scale, locale)} ${book.currency}`
                  : copy.workspace_amount_invalid}
              </Text>
            </Box>
          </EntryTotals>
        ) : null}
        <Box display="flex" flexWrap="wrap" gap="lg">
          <Button
            type="button"
            size="xl"
            variant="outline"
            disabled={lines.length >= 500}
            onClick={() => {
              setLines([...lines, { id: nextLine.current, debit: "", credit: "" }]);
              nextLine.current += 1;
            }}
          >
            {copy.journal_add_line}
          </Button>
          <Button type="submit" size="xl" disabled={!balanced}>
            {posting.savePrepare} <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </Box>
      </Box>
      {inputError ? <Text role="status">{inputError}</Text> : null}
      {prepare.isPending ? <Text role="status">{posting.pending}</Text> : null}
      {prepare.isError ? (
        <Text role="alert">
          {posting.commandUnknown} {prepare.error.message}
        </Text>
      ) : null}
      {prepare.data ? <SavedPostingOutcome saved={prepare.data} locale={locale} /> : null}
    </Box>
  );
}

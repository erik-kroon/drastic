import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Label } from "@open-erp/ui/components/label";
import { Heading, Text } from "@open-erp/ui/components/typography";
import {
  SavedPostingOutcome,
  SavedPostingRequestsPanel,
  useSavedPostingRequests,
} from "./saved-requests";
import { sendSavedPostingCommand } from "./request";
import { postingCopy } from "./copy";
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
    <Box id="journal-draft" tabIndex={-1} display="grid" gap="2xl">
      <details>
        <summary>{posting.savedTitle}</summary>
        <SavedPostingRequestsPanel
          book={book}
          locale={locale}
          accounts={setup.accounts}
          onPrepared={onPrepared}
          onEvidence={setRetainedEvidence}
        />
      </details>
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
        <Heading>{copy.journal_evidence}</Heading>
        <Text tone="muted">{copy.journal_evidence_help}</Text>
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
          <InputField label={copy.journal_title_field} name="title" required maxLength={2000} />
          <InputField label={copy.journal_origin} name="origin" required maxLength={2000} />
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
                rows={6}
                cols={16}
                required
                maxLength={65536}
              />
            </Box>
          </Box>
          <Box>
            <Button type="submit" size="xl">
              {posting.saveEvidence}
            </Button>
          </Box>
        </Box>
        <Text role="status">{inputError}</Text>
        {evidence.isPending ? <Text role="status">{posting.pending}</Text> : null}
        {evidence.isError ? (
          <Text role="alert">
            {posting.commandUnknown} {evidence.error.message}
          </Text>
        ) : null}
        {evidence.data ? <SavedPostingOutcome saved={evidence.data} locale={locale} /> : null}
        {retainedEvidence ? (
          <Box role="status" display="grid" gap="sm">
            <Text>
              {copy.journal_retained}: {retainedEvidence.id}
            </Text>
            <Text tone="muted">SHA-256: {retainedEvidence.sha256}</Text>
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
      {retainedEvidence ? (
        <JournalForm
          key={retainedEvidence.id}
          book={book}
          setup={setup}
          evidenceId={retainedEvidence.id}
          locale={locale}
          onPrepared={onPrepared}
        />
      ) : null}
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
  const [lines, setLines] = useState([1, 2]);
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
      lines: lines.map((id) => ({
        accountId: fields.get(`account-${id}`),
        debitMinor: fields.get(`debit-${id}`),
        creditMinor: fields.get(`credit-${id}`),
        description: fields.get(`description-${id}`),
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
      <Text>{copy.journal_units}</Text>
      <Text tone="muted">{copy.journal_manual_scope}</Text>
      <Box
        as="fieldset"
        disabled={
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
        <InputField
          label={copy.journal_event}
          name="eventKey"
          required
          pattern="[a-zA-Z0-9_\-]{1,128}"
          maxLength={128}
          aria-describedby="event-help"
        />
        <Text id="event-help" tone="muted">
          {copy.journal_event_help}
        </Text>
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
        {lines.map((id, index) => (
          <Box
            as="fieldset"
            key={id}
            borderWidth="thin"
            borderColor="default"
            borderRadius="surface"
            padding="lg"
            margin="none"
            minWidth="zero"
            display="grid"
            gap="lg"
          >
            <legend>
              {copy.journal_line} {index + 1}
            </legend>
            <SelectField
              label={copy.journal_account}
              name={`account-${id}`}
              required
              options={setup.accounts.map((account) => ({
                value: account.id,
                label: `${account.code} · ${account.name}`,
                disabled: !account.active,
              }))}
            />
            <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
              <InputField
                label={copy.journal_debit}
                name={`debit-${id}`}
                inputMode="numeric"
                pattern="(0|[1-9][0-9]{0,37})"
                defaultValue="0"
                required
                maxLength={38}
              />
              <InputField
                label={copy.journal_credit}
                name={`credit-${id}`}
                inputMode="numeric"
                pattern="(0|[1-9][0-9]{0,37})"
                defaultValue="0"
                required
                maxLength={38}
              />
            </Box>
            <InputField
              label={copy.journal_description}
              name={`description-${id}`}
              required
              maxLength={2000}
            />
            <Box>
              <Button
                type="button"
                size="xl"
                variant="ghost"
                disabled={lines.length <= 2}
                onClick={() => setLines(lines.filter((line) => line !== id))}
              >
                {copy.journal_remove_line} {index + 1}
              </Button>
            </Box>
          </Box>
        ))}
        <Box display="flex" flexWrap="wrap" gap="lg">
          <Button
            type="button"
            size="xl"
            variant="outline"
            disabled={lines.length >= 500}
            onClick={() => {
              setLines([...lines, nextLine.current]);
              nextLine.current += 1;
            }}
          >
            {copy.journal_add_line}
          </Button>
          <Button type="submit" size="xl">
            {posting.savePrepare}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
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

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { SealedAction } from "@/components/journal-review";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { postingCopy } from "./copy";
import {
  readSavedPostingRequest,
  runSavedPostingRequest,
  savedPostingPath,
  sendSavedPostingCommand,
} from "./request";

export function useSavedPostingRequests(
  book: typeof Accounting.Book.Type,
  after: string | null = null,
) {
  return useQuery({
    queryKey: [...bookKey(book), "posting-saved", "list", after],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${savedPostingPath(book)}${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Recovery.SavedPostingRequests,
        { signal },
      );
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId)
        throw new Error("Response scope mismatch");
      return result;
    },
    retry: false,
  });
}

export function SavedPostingOutcome({
  saved,
  locale,
}: {
  saved: typeof Recovery.SavedPostingRequest.Type;
  locale: Locale;
}) {
  const copy = postingCopy(locale);
  return (
    <Box role="status" display="grid" gap="sm" minWidth="zero">
      <Text>
        {saved.outcome === null
          ? copy.savedUnknown
          : saved.outcome.state === "committed"
            ? copy.savedCommitted
            : copy.savedRefused}
      </Text>
      <Text>
        {copy.requestKey}: {saved.request.key}
      </Text>
      <Text>
        {copy.checked}: {saved.checkedAt}
      </Text>
      {saved.outcome?.state === "refused" ? (
        <Text>
          {saved.outcome.refusal.code}: {saved.outcome.refusal.message}
        </Text>
      ) : null}
      {saved.outcome ? (
        <details>
          <summary>{copy.outcome}</summary>
          <Box overflow="auto" minWidth="zero" tabIndex={0} role="region" aria-label={copy.outcome}>
            <pre>{JSON.stringify(saved.outcome, null, 2)}</pre>
          </Box>
        </details>
      ) : null}
    </Box>
  );
}

export function SavedPostingRequestsPanel(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  accounts: typeof Accounting.BookSetup.Type.accounts;
  onPrepared: (id: string) => void;
  onEvidence: (evidence: typeof Accounting.Evidence.Type) => void;
}) {
  const { book, locale } = props;
  const copy = postingCopy(locale);
  const [after, setAfter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useSavedPostingRequests(book, after);
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.savedTitle}</Heading>
      <Text>{copy.savedHelp}</Text>
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button
          size="xl"
          variant="outline"
          disabled={list.isFetching}
          onClick={() => {
            void list.refetch();
          }}
        >
          {copy.refresh}
        </Button>
        {after ? (
          <Button size="xl" variant="outline" onClick={() => setAfter(null)}>
            {copy.newestRequests}
          </Button>
        ) : null}
      </Box>
      {list.isPending ? <Text role="status">{copy.pending}</Text> : null}
      {list.isError ? <Text role="alert">{copy.unknown}</Text> : null}
      {list.data && !list.isError ? (
        <>
          <Text>
            {copy.checked}: {list.data.checkedAt}
          </Text>
          {list.data.items.length === 0 ? <Text>{copy.savedEmpty}</Text> : null}
          {list.data.items.map((item) => (
            <Box key={item.key} display="grid" gap="sm" minWidth="zero">
              <Text>
                {item.operation} · {item.savedAt} · {item.actorId}
              </Text>
              <Text>
                {copy.requestKey}: {item.key}
              </Text>
              <Text>
                {item.state === "unknown"
                  ? copy.savedUnknown
                  : item.state === "committed"
                    ? copy.savedCommitted
                    : copy.savedRefused}
              </Text>
              <Box>
                <Button size="xl" variant="outline" onClick={() => setSelected(item.key)}>
                  {copy.inspect}
                </Button>
              </Box>
            </Box>
          ))}
          {list.data.next ? (
            <Box>
              <Button size="xl" variant="outline" onClick={() => setAfter(list.data?.next ?? null)}>
                {copy.olderRequests}
              </Button>
            </Box>
          ) : null}
        </>
      ) : null}
      {selected ? (
        <SavedRequestDetail
          key={selected}
          {...props}
          requestKey={selected}
          onSelected={setSelected}
        />
      ) : null}
    </Box>
  );
}

type SavedDetailProps = {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  requestKey: string;
  onSelected: (key: string) => void;
  accounts: typeof Accounting.BookSetup.Type.accounts;
  onPrepared: (id: string) => void;
  onEvidence: (evidence: typeof Accounting.Evidence.Type) => void;
};

function SavedRequestDetail(props: SavedDetailProps) {
  const copy = postingCopy(props.locale);
  const detail = useQuery({
    queryKey: [...bookKey(props.book), "posting-saved", props.requestKey],
    queryFn: ({ signal }) => readSavedPostingRequest(props.book, props.requestKey, signal),
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.savedCommand}</Heading>
      {detail.isPending ? <Text role="status">{copy.pending}</Text> : null}
      {detail.isError ? (
        <>
          <Text role="alert">
            {copy.unknown} {detail.error.message}
          </Text>
          <Box>
            <Button
              size="xl"
              variant="outline"
              onClick={() => {
                void detail.refetch();
              }}
            >
              {copy.refresh}
            </Button>
          </Box>
        </>
      ) : null}
      {detail.data && !detail.isError ? (
        <SavedRequestActions
          {...props}
          saved={detail.data}
          refreshing={detail.isFetching}
          onRefresh={() => {
            void detail.refetch();
          }}
        />
      ) : null}
    </Box>
  );
}

function matchesSavedPlan(
  book: typeof Accounting.Book.Type,
  command: typeof Recovery.SavedPostingCommand.Type,
  plan: typeof Recovery.PostingRecovery.Type | undefined,
) {
  if (command.operation !== "approve_change" && command.operation !== "execute_change") return true;
  return (
    plan !== undefined &&
    plan.scope.bookId === book.id &&
    plan.scope.entityId === book.entityId &&
    plan.plan.id === command.id &&
    plan.plan.planDigest === command.input.planDigest
  );
}

function SavedRequestActions(
  props: SavedDetailProps & {
    saved: typeof Recovery.SavedPostingRequest.Type;
    refreshing: boolean;
    onRefresh: () => void;
  },
) {
  const { book, locale, saved } = props;
  const copy = postingCopy(locale);
  const client = useQueryClient();
  const [reviewed, setReviewed] = useState(false);
  const command = saved.command;
  const proposalId =
    command.operation === "approve_change" || command.operation === "execute_change"
      ? command.id
      : null;
  const plan = useQuery({
    queryKey: [...bookKey(book), "posting-recovery", "saved-review", proposalId],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/posting-recovery/${encodeURIComponent(proposalId ?? "")}`,
        Recovery.PostingRecovery,
        { signal },
      ),
    enabled: proposalId !== null,
    retry: false,
  });
  const run = useMutation({
    mutationFn: (newRequest: boolean) =>
      newRequest
        ? sendSavedPostingCommand({
            book,
            actorId: saved.request.actorId,
            command,
            storageMessage: copy.storage,
            replaceTerminal: true,
          })
        : runSavedPostingRequest(book, saved),
    onSuccess: (result) => {
      client.setQueryData([...bookKey(book), "posting-saved", result.request.key], result);
      setReviewed(false);
      props.onSelected(result.request.key);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
    },
  });
  const planReady =
    proposalId === null ||
    (!plan.isError && !plan.isFetching && matchesSavedPlan(book, command, plan.data));
  const busy = props.refreshing || run.isPending;
  const authorityAllowed =
    (command.operation !== "approve_change" && command.operation !== "revoke_approval") ||
    book.role === "operator";
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={busy}
          onClick={() => {
            run.reset();
            setReviewed(false);
            props.onRefresh();
            if (proposalId !== null) void plan.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {run.isError ? (
        <Text role="alert">
          {copy.commandUnknown} {run.error.message}
        </Text>
      ) : null}
      {run.isPending ? <Text role="status">{copy.pending}</Text> : null}
      <SavedPostingOutcome saved={saved} locale={locale} />
      <Text>
        {copy.commandDigest}: {saved.request.requestDigest}
      </Text>
      <Text>
        {copy.commandKey}: {saved.request.commandKey}
      </Text>
      <Box
        overflow="auto"
        minWidth="zero"
        tabIndex={0}
        role="region"
        aria-label={copy.savedCommand}
      >
        <pre>{JSON.stringify(saved.command, null, 2)}</pre>
      </Box>
      {proposalId ? (
        <>
          {plan.isError ? <Text role="alert">{copy.unknown}</Text> : null}
          {plan.data && !plan.isError ? (
            <SavedProposalContent
              book={book}
              current={plan.data}
              locale={locale}
              accounts={props.accounts}
            />
          ) : null}
          <Box>
            <Button size="xl" variant="outline" onClick={() => props.onPrepared(proposalId)}>
              {copy.open}
            </Button>
          </Box>
        </>
      ) : null}
      {!saved.sameActor ? (
        <Text>{copy.otherActor}</Text>
      ) : saved.outcome?.state !== "committed" ? (
        <>
          {saved.outcome?.state === "refused" ? <Text>{copy.terminalHelp}</Text> : null}
          <Box as="label" display="flex" gap="md" alignItems="center">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            {copy.replayCheck}
          </Box>
          <Box>
            <Button
              size="xl"
              disabled={!reviewed || busy || !planReady || !authorityAllowed}
              onClick={() => run.mutate(saved.outcome?.state === "refused")}
            >
              {saved.outcome?.state === "refused" ? copy.newRequest : copy.run}
            </Button>
          </Box>
        </>
      ) : null}
      <SavedRequestResult
        saved={saved}
        locale={locale}
        onPrepared={props.onPrepared}
        onEvidence={props.onEvidence}
      />
    </Box>
  );
}

function SavedProposalContent(props: {
  book: typeof Accounting.Book.Type;
  current: typeof Recovery.PostingRecovery.Type;
  locale: Locale;
  accounts: typeof Accounting.BookSetup.Type.accounts;
}) {
  const copy = postingCopy(props.locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>
        {copy[props.current.summary.postingStatus]} · {copy.checked}: {props.current.checkedAt}
      </Text>
      {props.current.validation.blocker ? (
        <Text>{props.current.validation.blocker.message}</Text>
      ) : null}
      {props.current.plan.groups.flatMap((group) =>
        group.actions.map((action) => (
          <SealedAction
            key={`${group.id}/${action.eventId}/${action.occurrenceKey}`}
            book={props.book}
            action={action}
            locale={props.locale}
            setupAccounts={props.accounts}
          />
        )),
      )}
    </Box>
  );
}

function SavedRequestResult(props: {
  saved: typeof Recovery.SavedPostingRequest.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
  onEvidence: (evidence: typeof Accounting.Evidence.Type) => void;
}) {
  const copy = postingCopy(props.locale);
  if (props.saved.outcome?.state !== "committed") return null;
  const result = props.saved.outcome.result;
  if (
    props.saved.command.operation === "prepare_journal" &&
    Schema.is(Accounting.ChangeSet)(result)
  )
    return (
      <Box>
        <Button size="xl" onClick={() => props.onPrepared(result.id)}>
          {copy.open}
        </Button>
      </Box>
    );
  if (props.saved.command.operation === "create_evidence" && Schema.is(Accounting.Evidence)(result))
    return (
      <Box>
        <Button size="xl" onClick={() => props.onEvidence(result)}>
          {copy.resumeEvidence}
        </Button>
      </Box>
    );
  return null;
}

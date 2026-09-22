import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { postingCopy } from "./copy";

export function PostingRecoveryPanel({
  book,
  locale,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = postingCopy(locale);
  const [after, setAfter] = useState<string | null>(null);
  const recovery = useQuery({
    queryKey: [...bookKey(book), "posting-recovery", "list", after],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/posting-recovery${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Recovery.RecoveryList,
        { signal },
      ),
    retry: false,
  });
  return (
    <Box as="section" id="posting-recovery" tabIndex={-1} display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.title}</Heading>
      <Text>{copy.help}</Text>
      <Box display="flex" gap="md" flexWrap="wrap">
        <Button
          size="xl"
          variant="outline"
          disabled={recovery.isFetching}
          onClick={() => {
            void recovery.refetch();
          }}
        >
          {copy.refresh}
        </Button>
        {after ? (
          <Button size="xl" variant="outline" onClick={() => setAfter(null)}>
            {copy.newest}
          </Button>
        ) : null}
      </Box>
      {recovery.isError ? <Text role="alert">{copy.unknown}</Text> : null}
      {recovery.isPending ? <Text role="status">{copy.pending}</Text> : null}
      {recovery.data && !recovery.isError ? (
        <>
          <Text tone="muted">
            {copy.checked}: {recovery.data.checkedAt} · {copy.sequence}: {recovery.data.sequence}
          </Text>
          {recovery.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
          {recovery.data.items.map((item) => (
            <Box
              key={item.changeSetId}
              display="grid"
              gap="sm"
              padding="lg"
              backgroundColor="surface"
              borderRadius="surface"
              minWidth="zero"
            >
              <Text>{item.description}</Text>
              <Text>{copy[item.postingStatus]}</Text>
              <Text>ID: {item.changeSetId}</Text>
              <Text tone="muted">
                {item.createdAt} · {copy.createdBy}: {item.createdBy}
              </Text>
              <Box>
                <Button size="xl" variant="outline" onClick={() => onPrepared(item.changeSetId)}>
                  {copy.open}
                </Button>
              </Box>
            </Box>
          ))}
          {recovery.data.next ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                onClick={() => setAfter(recovery.data?.next ?? null)}
              >
                {copy.older}
              </Button>
            </Box>
          ) : null}
        </>
      ) : null}
      <RequestLookup book={book} locale={locale} onPrepared={onPrepared} />
    </Box>
  );
}

function RequestLookup({
  book,
  locale,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = postingCopy(locale);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const lookup = useQuery({
    queryKey: [...bookKey(book), "posting-recovery", "request", key],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/posting-requests/${encodeURIComponent(key)}`,
        Recovery.RecoveredPostingRequest,
        { signal },
      ),
    enabled: key !== "",
    retry: false,
  });
  const receipt = lookup.isError ? undefined : lookup.data;
  const proposalId =
    receipt?.state === "committed"
      ? "changeSetId" in receipt.result
        ? receipt.result.changeSetId
        : receipt.result.id
      : null;
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Heading>{copy.requestTitle}</Heading>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("key");
          if (!Schema.is(Accounting.IdempotencyHeaders.fields["idempotency-key"])(value)) {
            setError(copy.invalidKey);
            return;
          }
          setError("");
          if (key === value) void lookup.refetch();
          else setKey(value);
        }}
      >
        <InputField label={copy.requestKey} name="key" required minLength={8} maxLength={128} />
        <Box>
          <Button type="submit" size="xl" variant="outline" disabled={lookup.isFetching}>
            {copy.recover}
          </Button>
        </Box>
        {error ? <Text role="alert">{error}</Text> : null}
      </Box>
      {lookup.isError ? <Text role="alert">{copy.unknown}</Text> : null}
      {receipt ? (
        <Box role="status" display="grid" gap="sm">
          <Text>{receipt.state === "committed" ? copy.committed : copy.notObserved}</Text>
          <Text>
            {copy.checked}: {receipt.checkedAt}
          </Text>
          {receipt.state === "committed" ? (
            <Text>
              {receipt.operation} · {receipt.actorId} · {receipt.recordedAt}
            </Text>
          ) : null}
          {proposalId ? (
            <Box>
              <Button size="xl" variant="outline" onClick={() => onPrepared(proposalId)}>
                {copy.open}
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

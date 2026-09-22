import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Closing from "@open-erp/contracts/closing";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { closingCopy } from "./copy";
import { FamilyInventoryFields, readFamilyDecisions } from "./inventory";
import { ClosingReview, ClosingFacts, ClosingHistoryPanel } from "./review";

export function ClosingPanel({
  book,
  setup,
  locale,
  open = false,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
  locale: Locale;
  open?: boolean;
}) {
  const copy = closingCopy(locale);
  const [periodId, setPeriodId] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [error, setError] = useState("");
  return (
    <details open={open} id="technical-closing" tabIndex={-1}>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.title}</Heading>
        <Text>{copy.warning}</Text>
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("periodId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setError(copy.invalid);
              return;
            }
            setError("");
            setPeriodId(id);
            setProposalId("");
          }}
        >
          <InputField
            label={copy.period}
            name="periodId"
            required
            suggestions={setup?.periods.map((period) => period.id)}
          />
          <Box>
            <Button type="submit" variant="outline" size="xl">
              {copy.load}
            </Button>
          </Box>
        </Box>
        {periodId ? (
          <PeriodClosing
            key={`${book.id}:${periodId}`}
            book={book}
            periodId={periodId}
            locale={locale}
            onPrepared={setProposalId}
          />
        ) : null}
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("proposalId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setError(copy.invalid);
              return;
            }
            setError("");
            setProposalId(id);
          }}
        >
          <InputField label={copy.proposalId} name="proposalId" required />
          <Box>
            <Button type="submit" variant="outline" size="xl">
              {copy.loadProposal}
            </Button>
          </Box>
        </Box>
        <Text role="status">{error}</Text>
        {proposalId ? (
          <ClosingReview
            key={`${book.id}:${proposalId}`}
            book={book}
            id={proposalId}
            locale={locale}
          />
        ) : null}
      </Box>
    </details>
  );
}

function PeriodClosing({
  book,
  periodId,
  locale,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  periodId: string;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = closingCopy(locale);
  const keys = useRef(new Map<string, string>());
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const path = `${bookPath(book)}/periods/${encodeURIComponent(periodId)}`;
  const readiness = useQuery({
    queryKey: [...bookKey(book), "closing-readiness", periodId],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${path}/closing-readiness`, Closing.ClosingReadiness, {
        signal,
      });
      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.periodId !== periodId
      )
        throw new Error("Closing scope mismatch");
      return result;
    },
  });
  const inventory = useMutation({
    mutationFn: (input: typeof Closing.DeclareClosingInventory.Type) => {
      const endpoint = `${path}/closing-source-inventories`;
      return readAccounting(
        endpoint,
        Closing.ClosingInventory,
        mutationOptions(endpoint, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookKey(book) }),
  });
  const prepare = useMutation({
    mutationFn: (input: typeof Closing.PrepareClosing.Type) => {
      const endpoint = `${path}/closing-proposals`;
      return readAccounting(
        endpoint,
        Closing.ClosingProposal,
        mutationOptions(endpoint, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (result) => onPrepared(result.id),
  });
  const basis = readiness.data;
  const ready = readiness.isSuccess && !readiness.isFetching && !inventory.isPending;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={readiness.isPending} error={readiness.error} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={readiness.isFetching}
          onClick={() => {
            void readiness.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {basis ? (
        <>
          <Text>
            {periodId} · {basis.startsOn} – {basis.endsOn} ·{" "}
            {basis.locked ? copy.locked : copy.open}
          </Text>
          <ClosingFacts basis={basis} locale={locale} />
          {book.role === "operator" ? (
            <Box
              as="form"
              display="grid"
              gap="md"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                const accountValue = values.get("accountIds");
                if (typeof accountValue !== "string") {
                  setError(copy.invalid);
                  return;
                }
                const accountIds = accountValue.trim();
                const result = Schema.decodeUnknownOption(Closing.DeclareClosingInventory)({
                  evidenceId: values.get("evidenceId"),
                  bankAccountIds: accountIds ? accountIds.split(",").map((id) => id.trim()) : [],
                  families: readFamilyDecisions(values),
                });
                if (result._tag === "None") {
                  setError(copy.invalid);
                  return;
                }
                setError("");
                inventory.mutate(result.value);
              }}
            >
              <Heading>{copy.inventory}</Heading>
              <Text>{copy.inventoryHelp}</Text>
              <InputField
                name="accountIds"
                label={copy.bankAccounts}
                disabled={inventory.isPending}
              />
              <InputField
                name="evidenceId"
                label={copy.evidence}
                required
                disabled={inventory.isPending}
              />
              <FamilyInventoryFields locale={locale} disabled={inventory.isPending} />
              <label>
                <input type="checkbox" required disabled={inventory.isPending} />{" "}
                {copy.confirmInventory}
              </label>
              <Box>
                <Button type="submit" variant="outline" size="xl" disabled={inventory.isPending}>
                  {copy.declare}
                </Button>
              </Box>
              <AccountingStatus
                write
                locale={locale}
                pending={inventory.isPending}
                error={inventory.error}
              />
              {inventory.data ? (
                <Text role="status">
                  {copy.declared}: {inventory.data.id}
                </Text>
              ) : null}
            </Box>
          ) : null}
          <Box
            as="form"
            display="grid"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();
              const result = Schema.decodeUnknownOption(Closing.PrepareClosing)({
                action: basis.locked ? "reopen" : "close",
                reason: new FormData(event.currentTarget).get("reason"),
              });
              if (result._tag === "None") {
                setError(copy.invalid);
                return;
              }
              setError("");
              prepare.mutate(result.value);
            }}
          >
            <Text>{copy.prepareHelp}</Text>
            {basis.locked ? <Text>{copy.reopenHelp}</Text> : null}
            <InputField
              label={copy.reason}
              name="reason"
              required
              maxLength={2000}
              disabled={prepare.isPending}
            />
            <Box>
              <Button
                type="submit"
                size="xl"
                disabled={
                  !ready || prepare.isPending || (!basis.locked && !basis.technicalCloseAllowed)
                }
              >
                {basis.locked ? copy.reopen : copy.close}
              </Button>
            </Box>
            <AccountingStatus
              write
              locale={locale}
              pending={prepare.isPending}
              error={prepare.error}
            />
            <Text role="status">{error}</Text>
          </Box>
          <ClosingHistoryPanel book={book} periodId={periodId} locale={locale} />
        </>
      ) : null}
    </Box>
  );
}

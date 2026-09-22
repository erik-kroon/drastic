import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import * as Review from "@open-erp/contracts/accountant-review";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { reviewCopy } from "./copy";
import { ReviewPackInspector } from "./inspector";

const Draft = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  openingExplanation: Review.PrepareReviewPack.fields.openingExplanation,
  openingEvidenceIds: Review.PrepareReviewPack.fields.openingEvidenceIds,
  accountantNotes: Review.PrepareReviewPack.fields.accountantNotes,
  excludedSources: Review.PrepareReviewPack.fields.excludedSources,
});

export function AccountantReviewPanel({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const copy = reviewCopy(locale);
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  return (
    <details id="accountant-review" tabIndex={-1}>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.title}</Heading>
        <Text>{copy.intro}</Text>
        <Text>{copy.warning}</Text>
        <PreparePack key={book.id} book={book} locale={locale} onCreated={setId} />
        <RetainedPacks book={book} locale={locale} onSelected={setId} />
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("packId");
            if (!Schema.is(Accounting.Identifier)(value)) {
              setError(copy.invalid);
              return;
            }
            setError("");
            setId(value);
          }}
        >
          <InputField name="packId" label={copy.packId} required />
          <Box>
            <Button type="submit" variant="outline" size="xl">
              {copy.load}
            </Button>
          </Box>
          <Text role="status">{error}</Text>
        </Box>
        {id ? (
          <ReviewPackInspector key={`${book.id}:${id}`} book={book} id={id} locale={locale} />
        ) : null}
      </Box>
    </details>
  );
}

function PreparePack({
  book,
  locale,
  onCreated,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onCreated: (id: string) => void;
}) {
  const copy = reviewCopy(locale);
  const keys = useRef(new Map<string, string>());
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const prepare = useMutation({
    mutationFn: async (draft: typeof Draft.Type) => {
      const reportPath = `${bookPath(book)}/report-snapshots`;
      const report = await readAccounting(
        reportPath,
        Reports.ReportSnapshot,
        mutationOptions(
          reportPath,
          JSON.stringify({
            kind: "trial_balance_v1",
            startsOn: draft.startsOn,
            endsOn: draft.endsOn,
          }),
          keys.current,
        ),
      );
      if (
        report.scope.bookId !== book.id ||
        report.scope.entityId !== book.entityId ||
        report.startsOn !== draft.startsOn ||
        report.endsOn !== draft.endsOn
      )
        throw new Error("Report scope mismatch");
      const path = `${bookPath(book)}/accountant-review-packs`;
      const input: typeof Review.PrepareReviewPack.Type = {
        reportId: report.id,
        openingExplanation: draft.openingExplanation,
        openingEvidenceIds: draft.openingEvidenceIds,
        accountantNotes: draft.accountantNotes,
        excludedSources: draft.excludedSources,
      };
      const result = await readAccounting(
        path,
        Review.ReviewPackView,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
      if (
        result.pack.scope.bookId !== book.id ||
        result.pack.scope.entityId !== book.entityId ||
        result.pack.report.id !== report.id
      )
        throw new Error("Review pack scope mismatch");
      return result.pack.id;
    },
    onSuccess: async (id) => {
      onCreated(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...bookKey(book), "accountant-review-list"] }),
        queryClient.invalidateQueries({ queryKey: [...bookKey(book), "accountant-review", id] }),
      ]);
    },
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const evidence = fields.get("openingEvidenceIds");
        const source = fields.get("excludedName");
        const reason = fields.get("excludedReason");
        const decoded = Schema.decodeUnknownOption(Draft)({
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
          openingExplanation: fields.get("openingExplanation"),
          accountantNotes: fields.get("accountantNotes"),
          openingEvidenceIds:
            typeof evidence === "string" && evidence.trim()
              ? evidence.split(",").map((id) => id.trim())
              : [],
          excludedSources: source || reason ? [{ name: source, reason }] : [],
        });
        if (decoded._tag === "None" || decoded.value.startsOn > decoded.value.endsOn) {
          setError(copy.invalid);
          return;
        }
        setError("");
        prepare.mutate(decoded.value);
      }}
    >
      <Text>{copy.openingWarning}</Text>
      <Box
        as="fieldset"
        disabled={prepare.isPending}
        borderWidth="none"
        padding="none"
        margin="none"
        display="grid"
        gap="lg"
        minWidth="zero"
      >
        <Box display="flex" flexWrap="wrap" gap="md">
          <InputField type="date" name="startsOn" label={copy.startsOn} required />
          <InputField type="date" name="endsOn" label={copy.endsOn} required />
        </Box>
        <InputField name="openingExplanation" label={copy.opening} required maxLength={2000} />
        <InputField name="openingEvidenceIds" label={copy.openingEvidence} />
        <InputField name="accountantNotes" label={copy.notes} required maxLength={2000} />
        <InputField name="excludedName" label={copy.exclusionName} maxLength={2000} />
        <InputField name="excludedReason" label={copy.exclusionReason} maxLength={2000} />
        <Text>{copy.retry}</Text>
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button type="submit" size="xl">
            {copy.create}
          </Button>
          {prepare.isSuccess || prepare.isError ? (
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => {
                keys.current.clear();
                prepare.reset();
              }}
            >
              {copy.another}
            </Button>
          ) : null}
        </Box>
      </Box>
      <Text role="status">{error}</Text>
      <AccountingStatus write locale={locale} pending={prepare.isPending} error={prepare.error} />
      {prepare.data ? (
        <Text role="status">
          {copy.created}: {prepare.data}
        </Text>
      ) : null}
    </Box>
  );
}

function RetainedPacks({
  book,
  locale,
  onSelected,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onSelected: (id: string) => void;
}) {
  const copy = reviewCopy(locale);
  const list = useInfiniteQuery({
    queryKey: [...bookKey(book), "accountant-review-list"],
    initialPageParam: "",
    retry: false,
    queryFn: ({ pageParam, signal }) =>
      readAccounting(
        `${bookPath(book)}/accountant-review-packs${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Review.ReviewPackList,
        { signal },
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const packs = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <details>
      <summary>{copy.retained}</summary>
      <Box display="grid" gap="md" paddingBlock="lg">
        <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
        {list.isSuccess && packs.length === 0 ? <Text>{copy.empty}</Text> : null}
        {packs.map((pack) => (
          <Box key={pack.id} display="grid" gap="sm">
            <Text>
              {pack.startsOn} – {pack.endsOn} · {copy.sequence}: {pack.sequence} · {pack.createdAt}
            </Text>
            <Text>{pack.id}</Text>
            <Box>
              <Button variant="outline" size="xl" onClick={() => onSelected(pack.id)}>
                {copy.load}
              </Button>
            </Box>
          </Box>
        ))}
        {list.hasNextPage ? (
          <Box>
            <Button
              variant="outline"
              size="xl"
              disabled={list.isFetchingNextPage}
              onClick={() => {
                void list.fetchNextPage();
              }}
            >
              {copy.next}
            </Button>
          </Box>
        ) : null}
      </Box>
    </details>
  );
}

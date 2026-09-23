import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import * as Review from "@open-erp/contracts/accountant-review";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { ArrowLeft, Plus } from "lucide-react";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DataTable } from "@open-erp/ui/components/data-table";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageCaption, RecordToggle } from "@open-erp/ui/components/accounting-page";
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

export function AccountantReviewPanel(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  open?: boolean;
  recordId?: string;
  onOpen?: (id: string) => void;
}) {
  const { book, locale } = props;
  const copy = reviewCopy(locale);
  const [local, setLocal] = useState("");
  const selected = props.recordId ?? local;
  const select = props.onOpen ?? setLocal;
  if (selected && selected !== "new")
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => select("")}>
            <ArrowLeft size={14} />
            {locale === "sv" ? "Alla granskningspaket" : "All review packs"}
          </Button>
        </Box>
        <ReviewPackInspector
          key={`${book.id}:${selected}`}
          book={book}
          id={selected}
          locale={locale}
        />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={copy.title}
        subtitle={copy.intro}
        action={
          <Button onClick={() => select("new")}>
            <Plus size={14} />
            {locale === "sv" ? "Nytt granskningspaket" : "New review pack"}
          </Button>
        }
      />
      <RetainedPacks book={book} locale={locale} onSelected={select} />
      <PageCaption>{copy.warning}</PageCaption>
      {selected === "new" ? (
        <FormDialog
          title={locale === "sv" ? "Nytt granskningspaket" : "New review pack"}
          closeLabel={locale === "sv" ? "Stäng" : "Close"}
          onClose={() => select("")}
        >
          <PreparePack key={book.id} book={book} locale={locale} onCreated={select} />
        </FormDialog>
      ) : null}
    </Box>
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
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  const period = setup.data?.periods.at(-1);
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
        <RecordSection title={locale === "sv" ? "Period" : "Period"}>
          <Box display="grid" columns={2} gap="lg" key={period?.id}>
            <InputField
              type="date"
              name="startsOn"
              label={copy.startsOn}
              required
              defaultValue={period?.startsOn}
            />
            <InputField
              type="date"
              name="endsOn"
              label={copy.endsOn}
              required
              defaultValue={period?.endsOn}
            />
          </Box>
        </RecordSection>
        <TextareaField
          rows={3}
          name="openingExplanation"
          label={copy.opening}
          required
          maxLength={2000}
        />
        <details>
          <summary>
            {locale === "sv" ? "Underlagsreferenser (valfritt)" : "Evidence references (optional)"}
          </summary>
          <Box paddingBlock="lg">
            <InputField name="openingEvidenceIds" label={copy.openingEvidence} />
          </Box>
        </details>
        <TextareaField
          rows={3}
          name="accountantNotes"
          label={copy.notes}
          required
          maxLength={2000}
        />
        <details>
          <summary>
            {locale === "sv" ? "Undantagna underlag (valfritt)" : "Excluded sources (optional)"}
          </summary>
          <Box display="grid" columns={2} gap="lg" paddingBlock="lg">
            <InputField name="excludedName" label={copy.exclusionName} maxLength={2000} />
            <InputField name="excludedReason" label={copy.exclusionReason} maxLength={2000} />
          </Box>
        </details>
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
    <Box display="grid" gap="md">
      <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
      {list.isSuccess && packs.length === 0 ? <Text>{copy.empty}</Text> : null}
      {packs.length ? (
        <DataTable
          title={copy.retained}
          narrow="stack"
          columns={[
            { id: "period", label: locale === "sv" ? "Period" : "Period" },
            { id: "created", label: locale === "sv" ? "Skapat" : "Created" },
            { id: "sequence", label: copy.sequence },
          ]}
          rows={packs.map((pack) => ({
            id: pack.id,
            cells: [
              <RecordToggle key="open" expanded={false} onClick={() => onSelected(pack.id)}>
                {pack.startsOn} – {pack.endsOn}
              </RecordToggle>,
              new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(pack.createdAt),
              ),
              pack.sequence,
            ],
          }))}
        />
      ) : null}
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
  );
}

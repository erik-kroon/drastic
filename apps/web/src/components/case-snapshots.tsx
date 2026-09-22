import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cases from "@open-erp/contracts/cases";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { CaseContextPanel } from "@/components/case-context";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function CaseSnapshots({
  book,
  locale,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [inputError, setInputError] = useState("");
  return (
    <details id="case-snapshots" tabIndex={-1}>
      <summary>{copy.case_title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.case_title}</Heading>
        <Box padding="lg" backgroundColor="muted" borderRadius="surface">
          <Text>{copy.case_warning}</Text>
        </Box>
        <CaptureCases book={book} locale={locale} onCaptured={setSnapshotId} />
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("snapshotId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setInputError(copy.journal_invalid);
              return;
            }
            setInputError("");
            setSnapshotId(id);
          }}
        >
          <InputField
            label={copy.case_snapshot_id}
            name="snapshotId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.case_resume}
            </Button>
          </Box>
          <Text role="status">{inputError}</Text>
        </Box>
        {snapshotId ? (
          <CapturedCases
            key={snapshotId}
            book={book}
            snapshotId={snapshotId}
            locale={locale}
            onPrepared={onPrepared}
          />
        ) : null}
      </Box>
    </details>
  );
}

function CaptureCases({
  book,
  locale,
  onCaptured,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onCaptured: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");
  const capture = useMutation({
    mutationFn: (payload: typeof Cases.PrepareCaseSnapshot.Type) => {
      const path = `${bookPath(book)}/case-snapshots`;
      return readAccounting(
        path,
        Cases.CaseSnapshot,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: (snapshot) => onCaptured(snapshot.id),
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const caseId = new FormData(event.currentTarget).get("caseId");
        const decoded = Schema.decodeUnknownOption(Cases.PrepareCaseSnapshot)(
          caseId === "" ? {} : { caseId },
        );
        if (decoded._tag === "None") {
          setInputError(copy.journal_invalid);
          return;
        }
        setInputError("");
        capture.mutate(decoded.value);
      }}
    >
      <Heading>{copy.case_capture}</Heading>
      <Text tone="muted">{copy.case_capture_help}</Text>
      <InputField
        label={copy.case_optional_id}
        name="caseId"
        pattern="[a-z][a-z0-9_\-]{2,127}"
        disabled={capture.isPending || capture.isSuccess}
      />
      <Box>
        <Button type="submit" size="xl" disabled={capture.isPending || capture.isSuccess}>
          {copy.case_capture}
        </Button>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus write locale={locale} pending={capture.isPending} error={capture.error} />
      {capture.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>{copy.case_captured}</Text>
          <Text>
            {copy.case_snapshot_id}: {capture.data.id} · {copy.report_sequence}:{" "}
            {capture.data.sequence}
          </Text>
          <Box>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                capture.reset();
                keys.current.clear();
              }}
            >
              {copy.case_new}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function CapturedCases({
  book,
  snapshotId,
  locale,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  snapshotId: string;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const [caseId, setCaseId] = useState<string | null>(null);
  const cases = useInfiniteQuery({
    queryKey: [...bookKey(book), "case-snapshot", snapshotId],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const page = await readAccounting(
        `${bookPath(book)}/case-snapshots/${encodeURIComponent(snapshotId)}/cases?maxItems=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Cases.CasePage,
        { signal },
      );
      if (
        page.snapshot.id !== snapshotId ||
        page.snapshot.scope.bookId !== book.id ||
        page.snapshot.scope.entityId !== book.entityId
      )
        throw new Error("Case snapshot scope mismatch");
      return page;
    },
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const first = cases.data?.pages[0];
  const loaded = cases.data?.pages.flatMap((page) => page.items) ?? [];
  const state = {
    proposed: copy.case_proposed,
    posted: copy.case_posted,
    reversed: copy.case_reversed,
  };
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.case_snapshot}</Heading>
      <AccountingStatus locale={locale} pending={cases.isPending} error={cases.error} />
      {cases.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={cases.isFetching}
            onClick={() => {
              void cases.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      {first ? (
        <>
          <SnapshotFacts snapshot={first.snapshot} locale={locale} />
          <Text role="status">
            {copy.case_loaded}: {loaded.length} / {first.snapshot.totals.cases} ·{" "}
            {copy.case_remaining}: {cases.data?.pages.at(-1)?.remaining}
          </Text>
          <DataTable
            title={copy.case_title}
            narrow="stack"
            columns={[
              { id: "case", label: copy.case_id },
              { id: "event", label: copy.case_event },
              { id: "state", label: copy.case_state },
              { id: "plans", label: copy.case_total_plans },
              { id: "vouchers", label: copy.journal_voucher },
              { id: "debit", label: copy.journal_debit, numeric: true },
              { id: "credit", label: copy.journal_credit, numeric: true },
            ]}
            rows={loaded.map((entry) => ({
              id: entry.id,
              cells: [
                <Box key={entry.id} display="grid" gap="sm">
                  <Button
                    size="xl"
                    variant="outline"
                    aria-expanded={caseId === entry.id}
                    aria-controls="case-detail"
                    onClick={() => {
                      setCaseId(entry.id);
                      requestAnimationFrame(() => document.getElementById("case-detail")?.focus());
                    }}
                  >
                    {copy.case_inspect}
                  </Button>
                  <Text>{entry.id}</Text>
                </Box>,
                entry.eventKey,
                state[entry.state],
                entry.planCount,
                entry.voucherCount,
                entry.financialState.postedDebitMinor,
                entry.financialState.postedCreditMinor,
              ],
            }))}
          />
          {loaded.length === 0 ? <Text>{copy.case_empty}</Text> : null}
          {cases.hasNextPage ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                disabled={cases.isFetching}
                onClick={() => {
                  void cases.fetchNextPage();
                }}
              >
                {copy.case_more}
              </Button>
            </Box>
          ) : null}
          <Box id="case-detail" tabIndex={-1} minWidth="zero">
            {caseId ? (
              <CaseContextPanel
                key={caseId}
                book={book}
                snapshotId={snapshotId}
                caseId={caseId}
                locale={locale}
                onPrepared={onPrepared}
              />
            ) : null}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

function SnapshotFacts({
  snapshot,
  locale,
}: {
  snapshot: typeof Cases.CaseSnapshot.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>
        {copy.case_snapshot_id}: {snapshot.id} · {copy.report_sequence}: {snapshot.sequence}
      </Text>
      <Text tone="muted">
        {copy.case_captured_at}: {snapshot.capturedAt} / {snapshot.preparedBy}
      </Text>
      <Text tone="muted">
        {copy.journal_profile}: {snapshot.profile} · {snapshot.profileVersion} · writer_epoch:{" "}
        {snapshot.writerEpoch}
      </Text>
      {snapshot.selectedCaseId ? (
        <Text>
          {copy.case_id}: {snapshot.selectedCaseId}
        </Text>
      ) : null}
      <Text>{copy.case_warning}</Text>
      <Text tone="muted">{snapshot.coverage.reason}</Text>
      <Text>{copy.case_gross}</Text>
      <DataTable
        title={copy.case_totals}
        narrow="stack"
        columns={[
          { id: "cases", label: copy.case_total_cases },
          { id: "proposed", label: copy.case_proposed },
          { id: "posted", label: copy.case_posted },
          { id: "reversed", label: copy.case_reversed },
          { id: "plans", label: copy.case_total_plans },
          { id: "debit", label: copy.journal_debit, numeric: true },
          { id: "credit", label: copy.journal_credit, numeric: true },
        ]}
        rows={[
          {
            id: "snapshot-total",
            cells: [
              snapshot.totals.cases,
              snapshot.totals.proposedCases,
              snapshot.totals.postedCases,
              snapshot.totals.reversedCases,
              snapshot.totals.plans,
              snapshot.totals.postedDebitMinor,
              snapshot.totals.postedCreditMinor,
            ],
          },
        ]}
      />
    </Box>
  );
}

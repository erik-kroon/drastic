import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as PeriodWork from "@open-erp/contracts/period-work";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { readAccounting } from "@/lib/accounting-api";
import {
  advancePeriodWork,
  cancelPeriodWork,
  periodWorkPath,
  periodWorkQueryOptions,
} from "@/lib/period-work";
import type { Locale } from "@/paraglide/runtime";
import { periodWorkCopy } from "./copy";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function PeriodWorkPanel({
  locale,
  manifestId,
  onOpen,
}: {
  locale: Locale;
  manifestId: string;
  onOpen: (manifestId: string) => void;
}) {
  const { book } = useBookWorkspace();
  const copy = periodWorkCopy(locale);
  const client = useQueryClient();
  const advanceKeys = useRef(new Map<string, string>());
  const cancelKeys = useRef(new Map<string, string>());
  const [bounded, setBounded] = useState("10");
  const [manifestInput, setManifestInput] = useState("");

  const progress = useQuery(periodWorkQueryOptions(book, manifestId));

  // Both commands answer with the same projection as the read, so a confirmed
  // pass is displayed rather than waited for. The response is checked against
  // the book and the run it claims before it is stored.
  const run = useMutation({
    mutationFn: async (input: { path: string; request: RequestInit }) => {
      const result = await readAccounting(
        input.path,
        PeriodWork.PeriodWorkRunProgress,
        input.request,
      );

      if (
        result.scope.entityId !== book.entityId ||
        result.scope.bookId !== book.id ||
        result.manifestId !== manifestId
      )
        throw new Error(copy.identityMismatch);

      return result;
    },
    onSuccess: (result) => {
      client.setQueryData(periodWorkQueryOptions(book, result.manifestId).queryKey, result);
    },
  });

  const boundedCount = Number(bounded);
  // The bound on one pass belongs to the owning operation, not to this page: an
  // out-of-range count is refused there and its reason is shown as it arrived.
  const boundedValid = Number.isInteger(boundedCount) && boundedCount >= 1;
  const view = progress.isError ? undefined : progress.data;
  const selected = manifestId !== "";

  return (
    <Box
      as="section"
      id="period-work"
      tabIndex={-1}
      display="grid"
      gap="lg"
      minWidth="zero"
      aria-busy={progress.isFetching}
    >
      <Heading>{copy.title}</Heading>
      <Text tone="muted">{copy.help}</Text>
      {!selected ? (
        <Box display="grid" gap="md" maxWidth="content">
          <Text tone="muted">{copy.manifestHelp}</Text>
          <Box
            as="form"
            display="grid"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();
              onOpen(manifestInput.trim());
            }}
          >
            <InputField
              label={copy.manifest}
              name="manifest"
              value={manifestInput}
              maxLength={128}
              onChange={(event) => setManifestInput(event.currentTarget.value)}
            />
            <Box display="flex">
              <Button type="submit" variant="outline">
                {copy.open}
              </Button>
            </Box>
          </Box>
          <PageCaption>{copy.openHelp}</PageCaption>
        </Box>
      ) : null}
      <Box display="flex" gap="md" flexWrap="wrap">
        <Button
          variant="ghost"
          disabled={!selected || progress.isFetching}
          onClick={() => {
            void progress.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={progress.isPending} error={progress.error} />
      {progress.isError && selected ? <Text role="alert">{errorText(progress.error)}</Text> : null}
      {view ? (
        <Box display="grid" gap="lg" minWidth="zero">
          <Box role="status" display="grid" gap="sm">
            <Text>{copy.notReconciled}</Text>
            <Text tone="muted">
              {view.populationComplete ? copy.populationComplete : copy.populationIncomplete}
            </Text>
          </Box>
          <DataTable
            title={copy.counts}
            narrow="stack"
            columns={[
              { id: "state", label: copy.stateColumn },
              { id: "count", label: copy.selected, numeric: true },
            ]}
            rows={[
              { id: "visited", cells: [copy.visited, String(view.counts.visited)] },
              { id: "total", cells: [copy.selected, String(view.counts.total)] },
              { id: "pending", cells: [copy.pending, String(view.counts.pending)] },
              {
                id: "waitingPredecessor",
                cells: [copy.waitingPredecessor, String(view.counts.waitingPredecessor)],
              },
              { id: "needsReview", cells: [copy.needsReview, String(view.counts.needsReview)] },
              { id: "prepared", cells: [copy.prepared, String(view.counts.prepared)] },
              { id: "recovered", cells: [copy.recovered, String(view.counts.recovered)] },
              { id: "committed", cells: [copy.committed, String(view.counts.committed)] },
              { id: "refused", cells: [copy.refusedState, String(view.counts.refused)] },
            ]}
          />
          {view.children.length ? (
            <DataTable
              title={copy.work}
              narrow="stack"
              columns={[
                { id: "work", label: copy.work },
                { id: "state", label: copy.stateColumn },
                { id: "owner", label: copy.owner },
                { id: "plan", label: copy.plan },
                { id: "batch", label: copy.batch },
                { id: "missing", label: copy.missing },
                { id: "refused", label: copy.refused },
              ]}
              rows={view.children.map((child) => ({
                id: child.workIdentity,
                cells: [
                  child.workIdentity,
                  copy.childState(child.state),
                  child.routedOwner ?? "—",
                  child.planId ?? "—",
                  child.batchId ?? "—",
                  child.missingFacts && child.missingFacts.length
                    ? child.missingFacts.join(", ")
                    : "—",
                  child.refusalReason ?? "—",
                ],
              }))}
            />
          ) : (
            <PageEmpty title={copy.empty} detail={copy.none} />
          )}
          <Box display="flex" gap="md" flexWrap="wrap" alignItems="end">
            <InputField
              label={copy.advanceCount}
              name="boundedCount"
              type="number"
              min={1}
              value={bounded}
              onChange={(event) => setBounded(event.currentTarget.value)}
            />
            <Button
              variant="outline"
              disabled={!view || !boundedValid || run.isPending}
              onClick={() => {
                run.mutate({
                  path: `${periodWorkPath(book, manifestId)}/advance`,
                  request: advancePeriodWork(book, manifestId, boundedCount, advanceKeys.current),
                });
              }}
            >
              {copy.advance}
            </Button>
            <Button
              variant="outline"
              disabled={!view || run.isPending}
              onClick={() => {
                if (!view) return;

                run.mutate({
                  path: `${periodWorkPath(book, manifestId)}/cancel`,
                  request: cancelPeriodWork(book, manifestId, view.digest, cancelKeys.current),
                });
              }}
            >
              {copy.cancel}
            </Button>
          </Box>
          <PageCaption>{copy.advanceHelp}</PageCaption>
          <PageCaption>{copy.cancelHelp}</PageCaption>
          {run.isError ? <Text role="alert">{errorText(run.error)}</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}

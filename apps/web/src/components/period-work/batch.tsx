import { useCommandKeys } from "@/lib/command-keys";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as PeriodWork from "@open-erp/contracts/period-work";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { Badge } from "@open-erp/ui/components/badge";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { Text } from "@open-erp/ui/components/typography";
import { useBookWorkspace } from "@/lib/book-context";
import { readAccounting } from "@/lib/accounting-api";
import {
  approvePeriodWorkBatch,
  executePeriodWorkBatch,
  periodWorkQueryOptions,
  preparePeriodWorkBatch,
  type PeriodWorkCommand,
} from "@/lib/period-work";
import { periodWorkCopy } from "./copy";
import type { Locale } from "@/paraglide/runtime";

type Child = typeof PeriodWork.PeriodWorkChildProgress.Type;

type Batch = typeof PeriodWork.ApprovalBatch.Type;

type Execution = typeof PeriodWork.PeriodWorkExecutionResult.Type;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why a child cannot be a batch member, or `null` when it can.
 *
 * These are the published rules read from the child's own retained record, the
 * same record the owning operation reads them from: a member is a prepared child
 * with a sealed plan, a routed owner and that owner's review. Nothing here decides
 * eligibility. It reports what the record already says, so any disagreement is the
 * server's refusal to make and this page's job to display.
 */
function memberBlocker(child: Child, copy: ReturnType<typeof periodWorkCopy>) {
  if (child.state === "waiting_predecessor") return copy.batchNotWaiting;

  if (child.state !== "prepared" || child.planId === undefined) return copy.batchNotPrepared;

  if (child.routedOwner === undefined || child.ownerReviewId === undefined)
    return copy.batchNoOwner;

  return null;
}

export function PeriodWorkBatch(props: {
  locale: Locale;
  manifestId: string;
  children: ReadonlyArray<Child>;
  maximumMembers: number;
  onChanged: () => void;
}) {
  const { book } = useBookWorkspace();
  const copy = periodWorkCopy(props.locale);
  const manifestId = props.manifestId;
  const client = useQueryClient();
  const sealKeys = useCommandKeys();
  const approveKeys = useCommandKeys();
  const executeKeys = useCommandKeys();
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [bounded, setBounded] = useState("10");

  const operator = book.role === "operator";
  const rows = props.children.map((child) => ({ child, blocked: memberBlocker(child, copy) }));

  const eligible = new Set(
    rows.filter((row) => row.blocked === null).map((row) => row.child.workIdentity),
  );

  const chosen = selected.filter((identity) => eligible.has(identity)).sort();
  const boundedCount = Number(bounded);

  const seal = useMutation({
    mutationFn: async (command: PeriodWorkCommand) => {
      const sealed = await readAccounting(command.path, PeriodWork.ApprovalBatch, command.request);

      if (
        sealed.scope.entityId !== book.entityId ||
        sealed.scope.bookId !== book.id ||
        sealed.manifestId !== manifestId
      )
        throw new Error(copy.identityMismatch);

      return sealed;
    },
    onSuccess: (sealed) => {
      setBatch(sealed);
      setExecution(null);
      setAcknowledged(false);
      props.onChanged();
    },
  });

  const approve = useMutation({
    mutationFn: async (input: { command: PeriodWorkCommand; batchId: string }) => {
      const approved = await readAccounting(
        input.command.path,
        PeriodWork.ApprovalBatch,
        input.command.request,
      );

      if (approved.id !== input.batchId) throw new Error(copy.identityMismatch);

      return approved;
    },
  });

  const execute = useMutation({
    mutationFn: async (input: { command: PeriodWorkCommand; batchId: string }) => {
      const result = await readAccounting(
        input.command.path,
        PeriodWork.PeriodWorkExecutionResult,
        input.command.request,
      );

      if (result.batchId !== input.batchId || result.manifestId !== manifestId)
        throw new Error(copy.identityMismatch);

      return result;
    },
    onSuccess: (result) => {
      setExecution(result);
      // A committed member is no longer prepared, so the table this selection was
      // built from is stale.
      void client.invalidateQueries({
        queryKey: periodWorkQueryOptions(book, manifestId).queryKey,
      });
      setSelected([]);
      props.onChanged();
    },
  });

  const boundedValid = Number.isInteger(boundedCount) && boundedCount >= 1;
  const canSeal = operator && chosen.length > 0 && chosen.length <= props.maximumMembers;
  const canApprove = operator && batch !== null && acknowledged && approve.isIdle;
  const canExecute = operator && batch !== null && boundedValid && execute.isIdle;

  return (
    <Disclosure title={copy.batchTitle}>
      <Box display="grid" gap="lg" minWidth="zero">
        <Text tone="muted">{copy.batchHelp}</Text>
        {operator ? null : <Text tone="muted">{copy.batchOperatorOnly}</Text>}

        <Box display="grid" gap="md" minWidth="zero">
          <Text>{copy.batchSelect}</Text>
          <Text tone="muted">{copy.batchSelectHelp}</Text>
          {rows.length ? (
            <DataTable
              title={copy.batchSelect}
              narrow="stack"
              columns={[
                { id: "select", label: copy.batchSelect },
                { id: "work", label: copy.work },
                { id: "owner", label: copy.owner },
                { id: "plan", label: copy.plan },
                { id: "blocked", label: copy.stateColumn },
              ]}
              rows={rows.map(({ child, blocked }) => ({
                id: child.workIdentity,
                cells: [
                  blocked === null ? (
                    <input
                      key="select"
                      type="checkbox"
                      name={`member-${child.workIdentity}`}
                      aria-label={`${copy.batchSelect}: ${child.workIdentity}`}
                      checked={selected.includes(child.workIdentity)}
                      onChange={(event) => {
                        const { checked } = event.currentTarget;

                        setSelected((current) =>
                          checked
                            ? [...current, child.workIdentity]
                            : current.filter((item) => item !== child.workIdentity),
                        );
                      }}
                    />
                  ) : (
                    <Text key="select" tone="muted">
                      —
                    </Text>
                  ),
                  child.workIdentity,
                  child.routedOwner ?? "—",
                  child.planId ?? "—",
                  blocked ?? "—",
                ],
              }))}
            />
          ) : (
            <PageEmpty title={copy.batchNoMembers} />
          )}
          <PageCaption>
            {chosen.length} {copy.batchSelected}, {copy.batchMaximum(props.maximumMembers)}
          </PageCaption>
          <Box display="flex">
            <Button
              variant="outline"
              disabled={!canSeal || seal.isPending}
              onClick={() => {
                seal.mutate(preparePeriodWorkBatch(book, manifestId, chosen, sealKeys.current));
              }}
            >
              {copy.batchSeal}
            </Button>
          </Box>
          {seal.isError ? <Text role="alert">{errorText(seal.error)}</Text> : null}
        </Box>

        {batch ? (
          <Box display="grid" gap="md" minWidth="zero" id="period-work-batch">
            <Text>{copy.batchSealed}</Text>
            <DataTable
              title={copy.batchMembers}
              narrow="stack"
              columns={[
                { id: "work", label: copy.work },
                { id: "owner", label: copy.owner },
                { id: "plan", label: copy.plan },
                { id: "review", label: copy.review },
              ]}
              rows={batch.members.map((member) => ({
                id: member.workIdentity,
                cells: [member.workIdentity, member.owner, member.planId, member.ownerReviewId],
              }))}
            />
            <PageCaption>
              {copy.batchDigest}: {batch.digest}
            </PageCaption>
            <PageCaption>
              {copy.batchCombined}: {batch.combinedInformationalMinor}
            </PageCaption>
            <PageCaption>{copy.batchCombinedNote}</PageCaption>
            {operator ? (
              <Box as="label" display="flex" alignItems="start" gap="md">
                <input
                  type="checkbox"
                  name="acknowledge"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.currentTarget.checked)}
                />
                <Text>{copy.batchAcknowledge}</Text>
              </Box>
            ) : null}
            <Box display="flex" gap="md" flexWrap="wrap" alignItems="end">
              <Button
                variant="outline"
                disabled={!canApprove}
                onClick={() => {
                  approve.mutate({
                    command: approvePeriodWorkBatch(
                      book,
                      batch.id,
                      batch.digest,
                      approveKeys.current,
                    ),
                    batchId: batch.id,
                  });
                }}
              >
                {copy.batchApprove}
              </Button>
              <InputField
                label={copy.batchExecute}
                name="boundedCount"
                type="number"
                min={1}
                value={bounded}
                onChange={(event) => setBounded(event.currentTarget.value)}
              />
              <Button
                variant="outline"
                disabled={!canExecute}
                onClick={() => {
                  execute.mutate({
                    command: executePeriodWorkBatch(
                      book,
                      batch.id,
                      batch.digest,
                      boundedCount,
                      execution?.nextOrdinal ?? undefined,
                      executeKeys.current,
                    ),
                    batchId: batch.id,
                  });
                }}
              >
                {copy.batchExecute}
              </Button>
            </Box>
            {approve.isError ? <Text role="alert">{errorText(approve.error)}</Text> : null}
            {execute.isError ? <Text role="alert">{errorText(execute.error)}</Text> : null}
          </Box>
        ) : null}

        {execution ? (
          <Box display="grid" gap="md" minWidth="zero" role="status">
            <Text>{copy.batchExecuted}</Text>
            <Box display="flex" gap="md" flexWrap="wrap" alignItems="center">
              <Badge variant="secondary">
                {copy.batchCommitted}: {execution.committed.length}
              </Badge>
              <Badge variant={execution.refused.length ? "warning" : "secondary"}>
                {copy.batchRefused}: {execution.refused.length}
              </Badge>
              {execution.nextOrdinal === null ? null : (
                <Badge variant="secondary">{copy.batchNextPage}</Badge>
              )}
            </Box>
            {execution.committed.length ? (
              <DataTable
                title={copy.batchCommitted}
                narrow="stack"
                columns={[
                  { id: "work", label: copy.work },
                  { id: "receipt", label: copy.receipt },
                ]}
                rows={execution.committed.map((member) => ({
                  id: member.workIdentity,
                  cells: [member.workIdentity, member.receiptId],
                }))}
              />
            ) : null}
            {execution.refused.length ? (
              <DataTable
                title={copy.batchRefused}
                narrow="stack"
                columns={[
                  { id: "work", label: copy.work },
                  { id: "reason", label: copy.refused },
                ]}
                rows={execution.refused.map((member) => ({
                  id: member.workIdentity,
                  cells: [member.workIdentity, member.reason],
                }))}
              />
            ) : null}
            <Text tone="muted">{copy.notReconciled}</Text>
          </Box>
        ) : null}
      </Box>
    </Disclosure>
  );
}

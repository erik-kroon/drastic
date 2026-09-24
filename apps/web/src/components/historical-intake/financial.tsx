import { ClosingComparison } from "./closing-comparison";
import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  readAccounting,
  mutationOptions,
  isUncertainWriteError,
} from "@/lib/accounting-api";
import { PrepareSourceVoucher, ReviewSourceVoucher } from "./financial-review";

export function FinancialImport({
  sourceRunId,
  plan,
  yearId,
}: {
  sourceRunId: string;
  plan: typeof Sie.SiePlan.Type;
  yearId: string;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const cache = useQueryClient();
  const base = bookPath(book);
  const queryKey = [...bookKey(book), "sie-financial-workspace", sourceRunId];
  const refresh = () => cache.invalidateQueries({ queryKey });
  const workspace = useQuery({
    queryKey,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${base}/sie-runs/${encodeURIComponent(sourceRunId)}/financial-workspace`,
        Historical.FinancialWorkspace,
        { signal },
      );
      if (
        result.run &&
        (result.run.sourceRunId !== sourceRunId ||
          result.run.planDigest !== plan.digest ||
          result.run.fiscalYearId !== yearId)
      )
        throw new Error("Financial import identity mismatch");
      return result;
    },
  });
  const startPath = `${base}/sie-runs/${encodeURIComponent(sourceRunId)}/financial-runs`;
  const start = useMutation({
    mutationFn: () =>
      readAccounting(
        startPath,
        Historical.RunStart,
        mutationOptions(
          startPath,
          JSON.stringify({ fiscalYearId: yearId, planDigest: plan.digest }),
          keys.current,
        ),
      ),
    onSuccess: refresh,
  });
  const run = workspace.data?.run;
  return (
    <Box display="grid" gap="md">
      <AccountingStatus locale={locale} pending={workspace.isPending} error={workspace.error} />
      {workspace.isSuccess && !run ? (
        <>
          <Text>
            {sv
              ? "Starta bokföringsimporten när historikvalet är granskat. En aktiv import reserverar bokföringsflödet tills den är klar eller pausad. Varje verifikation granskas och godkänns separat."
              : "Start the ledger import after reviewing the historical basis. An active import reserves posting until complete or paused. Each voucher is reviewed and approved separately."}
          </Text>
          <Box>
            <Button
              disabled={book.role !== "operator" || start.isPending}
              onClick={() => start.mutate()}
            >
              {isUncertainWriteError(start.error)
                ? sv
                  ? "Återförsök samma start"
                  : "Retry same start"
                : sv
                  ? "Starta bokföringsimport"
                  : "Start ledger import"}
            </Button>
          </Box>
        </>
      ) : null}
      <AccountingStatus locale={locale} pending={start.isPending} error={start.error} write />
      {run ? (
        <>
          <Text>
            {run.nextOrdinal - 1} / {plan.voucherCount}{" "}
            {sv ? "verifikationer bokförda" : "vouchers posted"}
          </Text>
          {run.status === "posted" ? (
            <Text>
              {sv
                ? "Importens verifikationer är bokförda. Granska jämförelsen av utgående saldon nedan."
                : "Imported vouchers are posted. Review the closing balance comparison below."}
            </Text>
          ) : (
            <>
              <FinancialLease run={run} onChanged={refresh} />
              {run.status === "running" ? (
                <>
                  {workspace.data?.nextProposal ? (
                    <ReviewSourceVoucher
                      key={workspace.data.nextProposal.id}
                      run={run}
                      proposal={workspace.data.nextProposal}
                      onPosted={refresh}
                    />
                  ) : null}
                  <PrepareSourceVoucher
                    key={`${run.id}:${run.nextOrdinal}:${run.fence}`}
                    run={run}
                    onPrepared={refresh}
                    hasProposal={Boolean(workspace.data?.nextProposal)}
                  />
                </>
              ) : (
                <Text>
                  {sv
                    ? "Importen är pausad. Återuppta för att fortsätta."
                    : "Import paused. Resume to continue."}
                </Text>
              )}
            </>
          )}
          <details>
            <summary>{sv ? "Bokföringskvitton" : "Posting receipts"}</summary>
            {run.items.map((item) => (
              <Text key={item.ordinal}>
                {item.sourceReference} → {item.ledgerReceipt.voucherNumber} ·{" "}
                {item.ledgerReceipt.committedAt}
              </Text>
            ))}
          </details>
        </>
      ) : null}
      {run?.status === "posted" ? (
        <ClosingComparison sourceRunId={sourceRunId} planId={plan.id} />
      ) : null}
      <Box>
        <Button
          variant="outline"
          disabled={workspace.isFetching || start.isPending}
          onClick={() => {
            void refresh();
          }}
        >
          {sv ? "Läs in bokföringsimport" : "Refresh ledger import"}
        </Button>
      </Box>
    </Box>
  );
}

function FinancialLease({
  run,
  onChanged,
}: {
  run: typeof Historical.Run.Type;
  onChanged: () => Promise<unknown>;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/sie-financial-runs/${encodeURIComponent(run.id)}/lease`;
  const lease = useMutation({
    mutationFn: (action: "pause" | "resume") =>
      readAccounting(
        path,
        Historical.Fence,
        mutationOptions(path, JSON.stringify({ action }), keys.current),
      ),
    onSuccess: async () => {
      keys.current.clear();
      await onChanged();
    },
  });
  const uncertain = isUncertainWriteError(lease.error);
  return (
    <Box display="grid" gap="sm">
      <Box display="flex" flexWrap="wrap" gap="sm">
        <Button
          variant="outline"
          disabled={book.role !== "operator" || lease.isPending}
          onClick={() => lease.mutate(uncertain && lease.variables ? lease.variables : "resume")}
        >
          {uncertain
            ? sv
              ? "Återförsök samma åtgärd"
              : "Retry same action"
            : sv
              ? "Återuppta eller förnya import"
              : "Resume or renew import"}
        </Button>
        <Button
          variant="outline"
          disabled={
            book.role !== "operator" || lease.isPending || uncertain || run.status === "paused"
          }
          onClick={() => lease.mutate("pause")}
        >
          {sv ? "Pausa import" : "Pause import"}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={lease.isPending} error={lease.error} write />
    </Box>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { PreparationJob } from "@open-erp/contracts/automation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

export function PreparationBackground(props: {
  book: typeof Accounting.Book.Type;
  runId: string;
  ready: boolean;
  locale: Locale;
}) {
  const client = useQueryClient();
  const path = `${bookPath(props.book)}/preparation-runs/${encodeURIComponent(props.runId)}/background`;
  const queryKey = [...bookKey(props.book), "preparation-background", props.runId];
  const job = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Schema.NullOr(PreparationJob), { signal });
      if (result && (result.scope.entityId !== props.book.entityId || result.scope.bookId !== props.book.id || result.runId !== props.runId)) {
        throw new Error("Background job scope or run mismatch");
      }
      return result;
    },
    retry: false,
    refetchOnMount: "always",
    refetchInterval: (query) => (query.state.data?.state === "ready" ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: async (request: {
      path: string;
      key: string;
      scope: typeof Accounting.Scope.Type;
      runId: string;
    }) => {
      const result = await readAccounting(request.path, PreparationJob, {
        method: "POST",
        body: "{}",
        headers: { "Idempotency-Key": request.key },
      });
      if (result.scope.entityId !== request.scope.entityId || result.scope.bookId !== request.scope.bookId || result.runId !== request.runId) {
        throw new Error("Background job response scope or run mismatch");
      }
      return result;
    },
    retry: false,
    onSuccess: async (result) => {
      const scopeKey = ["accounting", result.scope.entityId, result.scope.bookId];
      const jobKey = [...scopeKey, "preparation-background", result.runId];
      const runKey = [...scopeKey, "preparation-run", result.runId];
      await Promise.all([
        client.cancelQueries({ queryKey: jobKey, exact: true }),
        client.cancelQueries({ queryKey: runKey, exact: true }),
      ]);
      void client.invalidateQueries({ queryKey: jobKey, exact: true });
      void client.invalidateQueries({ queryKey: runKey, exact: true });
    },
  });
  const captured = start.variables;
  const jobCurrent = job.isSuccess && job.isFetchedAfterMount && job.fetchStatus === "idle";
  const ready = props.ready && jobCurrent;
  const copy =
    props.locale === "sv"
      ? {
          start: "Fortsätt i bakgrunden",
          replace: "Begär ett ersättningsjobb",
          replacementHelp: "Servern avgör om behörighet eller körningens historik har ändrats så att jobbet får ersättas. Ett oförändrat aktivt jobb kan inte ersättas. Väntan i sig betyder inte att jobbet är inaktuellt.",
          retry: "Försök igen med samma begäran",
          discard: "Kasta sparad begäran (avbryter inte serverjobbet)",
          refresh: "Uppdatera jobbstatus",
          unknown: "Aktuell jobbstatus är inte bekräftad. Uppdatera innan du startar en ny begäran.",
          lastRead: "Senast lästa jobbstatus (inte bekräftad som aktuell)",
          help: "Jobbet fortsätter medan du lämnar sidan. Manuell ändring, avbrutet jobb eller utgången behörighet stoppar jobbet. Bokföring kräver ett separat godkännande.",
          ready: "Väntar eller körs",
          completed: "Slutfört",
          blocked: "Blockerat",
          stopped: "Stoppat",
        }
      : {
          start: "Continue in background",
          replace: "Request replacement job",
          replacementHelp: "The server decides whether changed authority or run history permits replacement. An unchanged active job cannot be replaced. Waiting alone does not mean the job is obsolete.",
          retry: "Retry the same request",
          discard: "Discard saved request (does not cancel the server job)",
          refresh: "Refresh job status",
          unknown: "Current job status is not confirmed. Refresh before starting a new request.",
          lastRead: "Last-read job status (not confirmed current)",
          help: "The job continues while you leave this page. Manual changes, cancellation or expired authority stop it. Posting requires separate approval.",
          ready: "Pending or running",
          completed: "Completed",
          blocked: "Blocked",
          stopped: "Stopped",
        };
  return (
    <Box display="grid" gap="md">
      <Text>{copy.help}</Text>
      <Box>
        <Button
          type="button"
          variant="outline"
          disabled={!ready || start.isPending || !!captured}
          onClick={() => {
            if (!ready || start.isPending || captured) return;
            start.mutate({
              path,
              key: crypto.randomUUID(),
              scope: { entityId: props.book.entityId, bookId: props.book.id },
              runId: props.runId,
            });
          }}
        >
          {job.data?.state === "ready" ? copy.replace : copy.start}
        </Button>
      </Box>
      {job.data?.state === "ready" ? <Text>{copy.replacementHelp}</Text> : null}
      <Box>
        <Button type="button" variant="outline" disabled={job.isFetching} onClick={() => { void job.refetch(); }}>
          {copy.refresh}
        </Button>
      </Box>
      {captured ? <Box display="grid" gap="md">
        <Text>{captured.runId} · {captured.key}</Text>
        <Box display="flex" flexWrap="wrap" gap="md">
          {start.isError ? <Button type="button" variant="outline" disabled={start.isPending}
            onClick={() => { if (!start.isPending) start.mutate(captured); }}>{copy.retry}</Button> : null}
          <Button type="button" variant="outline" disabled={start.isPending}
            onClick={() => { if (!start.isPending) start.reset(); }}>{copy.discard}</Button>
        </Box>
      </Box> : null}
      <AccountingStatus
        locale={props.locale}
        pending={start.isPending}
        error={start.error ?? job.error}
      />
      {!jobCurrent ? <Text role="status">{copy.unknown}</Text> : null}
      {job.data ? (
        <Text role="status">
          {!jobCurrent ? `${copy.lastRead}: ` : ""}{copy[job.data.state]} · {job.data.id}
          {job.data.reason ? ` · ${job.data.reason}` : ""}
        </Text>
      ) : null}
    </Box>
  );
}

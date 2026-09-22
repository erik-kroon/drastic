import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { PreparationJob } from "@open-erp/contracts/automation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

export function PreparationBackground(props: {
  book: typeof Accounting.Book.Type;
  runId: string;
  ready: boolean;
  locale: Locale;
}) {
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(props.book)}/preparation-runs/${encodeURIComponent(props.runId)}/background`;
  const queryKey = [...bookKey(props.book), "preparation-background", props.runId];
  const job = useQuery({
    queryKey,
    queryFn: ({ signal }) => readAccounting(path, Schema.NullOr(PreparationJob), { signal }),
    retry: false,
    refetchInterval: (query) => (query.state.data?.state === "ready" ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: () =>
      readAccounting(path, PreparationJob, mutationOptions(path, "{}", keys.current)),
    onSuccess: (result) => {
      client.setQueryData(queryKey, result);
      keys.current.clear();
      void client.invalidateQueries({
        queryKey: [...bookKey(props.book), "preparation-run", props.runId],
      });
    },
  });
  const copy =
    props.locale === "sv"
      ? {
          start: "Fortsätt i bakgrunden",
          help: "Jobbet fortsätter medan du lämnar sidan. Manuell ändring, avbrutet jobb eller utgången behörighet stoppar jobbet. Bokföring kräver ett separat godkännande.",
          ready: "Väntar eller körs",
          completed: "Slutfört",
          blocked: "Blockerat",
          stopped: "Stoppat",
        }
      : {
          start: "Continue in background",
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
          disabled={
            !props.ready ||
            job.isPending ||
            job.isError ||
            job.data?.state === "ready" ||
            start.isPending
          }
          onClick={() => start.mutate()}
        >
          {copy.start}
        </Button>
      </Box>
      <AccountingStatus
        locale={props.locale}
        pending={start.isPending}
        error={start.error ?? job.error}
      />
      {job.data ? (
        <Text role="status">
          {copy[job.data.state]} · {job.data.id}
          {job.data.reason ? ` · ${job.data.reason}` : ""}
        </Text>
      ) : null}
    </Box>
  );
}

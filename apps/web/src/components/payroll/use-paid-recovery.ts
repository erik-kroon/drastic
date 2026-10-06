import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Schema from "effect/Schema";
import { useCommerceCommandRecovery } from "@/components/commerce/command-recovery";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";

const RecoveryIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("split"), input: Recovery.SplitPaidRecovery }),
  Schema.Struct({ kind: Schema.Literal("attach"), input: Recovery.AttachPaidRecovery }),
  Schema.Struct({ kind: Schema.Literal("cancel"), input: Recovery.CancelPaidRecovery }),
]);

const endpoints = { split: "splits", attach: "attachments", cancel: "cancellations" } as const;

export function usePaidRecovery(recoveryId: string) {
  const { book } = useBookWorkspace();
  const client = useQueryClient();
  const root = `${bookPath(book)}/payroll/paid-recoveries`;
  const path = `${root}/${encodeURIComponent(recoveryId)}`;
  const queryKey = [...bookKey(book), "payroll", "paid-recoveries", recoveryId];

  function requireScope(view: typeof Recovery.PaidRecoveryView.Type) {
    if (
      view.assessment.id !== recoveryId ||
      view.assessment.scope.entityId !== book.entityId ||
      view.assessment.scope.bookId !== book.id
    )
      throw new Error("Paid recovery scope mismatch");

    return view;
  }

  const recovery = useCommerceCommandRecovery({
    book,
    path: root,
    id: recoveryId,
    schema: RecoveryIntent,
  });

  const query = useQuery({
    queryKey,
    retry: false,
    gcTime: 0,
    refetchInterval: 2_000,
    queryFn: async ({ signal }) =>
      requireScope(await readAccounting(path, Recovery.PaidRecoveryView, { signal })),
  });

  const command = useMutation({
    retry: false,
    mutationFn: async (request: { key: string; input: typeof RecoveryIntent.Type }) => {
      recovery.retain(request);

      return requireScope(
        await readAccounting(
          `${path}/${endpoints[request.input.kind]}`,
          Recovery.PaidRecoveryView,
          {
            method: "POST",
            headers: { "Idempotency-Key": request.key },
            body: JSON.stringify(request.input.input),
          },
        ),
      );
    },
    onSuccess: (view, request) => {
      recovery.clear(request.key);
      client.setQueryData(queryKey, view);
    },
    onSettled: async () => {
      await client.invalidateQueries({
        queryKey: [...bookKey(book), "payroll", "paid-recoveries"],
      });
    },
  });

  const captured = command.variables ?? recovery.saved;

  const blocked =
    !recovery.ready || command.isPending || recovery.saved !== null || command.isError;

  function execute(input: typeof RecoveryIntent.Type) {
    command.mutate({ key: crypto.randomUUID(), input });
  }

  return { query, command, recovery, captured, blocked, execute };
}

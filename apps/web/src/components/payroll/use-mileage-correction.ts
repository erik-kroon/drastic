import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Schema from "effect/Schema";
import { useCommerceCommandRecovery } from "@/components/commerce/command-recovery";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";

const MileageIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("submit"), input: Mileage.SubmitMileageCorrection }),
  Schema.Struct({ kind: Schema.Literal("cancel"), input: Mileage.CancelMileageCorrection }),
]);

export function useMileageCorrection(proposalId: string) {
  const { book } = useBookWorkspace();
  const client = useQueryClient();
  const root = `${bookPath(book)}/payroll/mileage-corrections`;
  const queryKey = [...bookKey(book), "payroll", "mileage-corrections", proposalId];

  function requireScope(view: typeof Mileage.MileageCorrectionView.Type) {
    if (
      view.proposal.id !== proposalId ||
      view.proposal.scope.entityId !== book.entityId ||
      view.proposal.scope.bookId !== book.id
    )
      throw new Error("Mileage correction scope mismatch");

    return view;
  }

  const recovery = useCommerceCommandRecovery({
    book,
    path: root,
    id: proposalId,
    schema: MileageIntent,
  });

  const query = useQuery({
    queryKey,
    retry: false,
    gcTime: 0,
    refetchInterval: 2_000,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${root}/${encodeURIComponent(proposalId)}`,
        Mileage.MileageCorrectionView,
        { signal },
      );

      return requireScope(view);
    },
  });

  const command = useMutation({
    retry: false,
    mutationFn: async (request: { key: string; input: typeof MileageIntent.Type }) => {
      recovery.retain(request);

      const view = await readAccounting(
        `${root}/${encodeURIComponent(proposalId)}/${request.input.kind === "submit" ? "submissions" : "cancellations"}`,
        Mileage.MileageCorrectionView,
        {
          method: "POST",
          headers: { "Idempotency-Key": request.key },
          body: JSON.stringify(request.input.input),
        },
      );

      return requireScope(view);
    },
    onSuccess: (view, request) => {
      recovery.clear(request.key);
      client.setQueryData(queryKey, view);
    },
    onSettled: async () => {
      await client.invalidateQueries({
        queryKey: [...bookKey(book), "payroll", "mileage-corrections"],
      });
    },
  });

  const captured = command.variables ?? recovery.saved;

  const blocked =
    !recovery.ready || command.isPending || recovery.saved !== null || command.isError;

  const submit = (input: typeof MileageIntent.Type) =>
    command.mutate({ key: crypto.randomUUID(), input });

  return { query, command, recovery, captured, blocked, submit };
}

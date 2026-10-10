import { bookScope } from "@/lib/contract-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Claims from "@open-erp/contracts/employee-claims";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { useCommerceCommandRecovery } from "@/components/commerce/command-recovery";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";

const ClaimIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("review"), input: Claims.ReviewEmployeeClaim }),
  Schema.Struct({
    kind: Schema.Literal("approve"),
    reviewId: Accounting.Identifier,
    digest: Accounting.Digest,
  }),
  Schema.Struct({ kind: Schema.Literal("completion"), digest: Accounting.Digest }),
]);

export function useEmployeeClaimReview(props: { claimId: string }) {
  const { book } = useBookWorkspace();
  const client = useQueryClient();
  const queryKey = [...bookKey(book), "payroll", "claims", props.claimId];
  const root = `${bookPath(book)}/payroll/claims`;

  const recovery = useCommerceCommandRecovery({
    book,
    path: root,
    id: props.claimId,
    schema: ClaimIntent,
  });

  const query = useQuery({
    queryKey,
    retry: false,
    gcTime: 0,
    refetchInterval: 2_000,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        (client) =>
          client.employeeClaims.getEmployeeClaim({
            params: { ...bookScope(book), claimId: props.claimId },
          }),
        Claims.EmployeeClaimView,
        { signal },
      );

      if (
        view.claimId !== props.claimId ||
        view.current.scope.entityId !== book.entityId ||
        view.current.scope.bookId !== book.id
      )
        throw new Error("Employee claim scope mismatch");

      return view;
    },
  });

  const command = useMutation({
    retry: false,
    mutationFn: async (request: { key: string; input: typeof ClaimIntent.Type }) => {
      recovery.retain(request);
      const intent = request.input;
      const options = { method: "POST", headers: { "Idempotency-Key": request.key } };

      if (intent.kind === "review")
        return readAccounting(
          `${root}/${encodeURIComponent(props.claimId)}/reviews`,
          Claims.EmployeeClaimReview,
          { ...options, body: JSON.stringify(intent.input) },
        );

      if (intent.kind === "approve")
        return readAccounting(
          `${root}/reviews/${encodeURIComponent(intent.reviewId)}/approvals`,
          Claims.EmployeeClaimRecognition,
          { ...options, body: JSON.stringify({ reviewDigest: intent.digest }) },
        );

      return readAccounting(
        `${root}/${encodeURIComponent(props.claimId)}/completion-requests`,
        Claims.ClaimCompletionRequest,
        {
          ...options,
          body: JSON.stringify({
            revisionDigest: intent.digest,
            reason: "Begär komplettering av utläggsunderlaget",
          }),
        },
      );
    },
    onSuccess: (_, request) => recovery.clear(request.key),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: [...bookKey(book), "payroll", "claims"] });
    },
  });

  const captured = command.variables ?? recovery.saved;

  const blocked =
    !recovery.ready || command.isPending || recovery.saved !== null || command.isError;

  const submit = (input: typeof ClaimIntent.Type) =>
    command.mutate({ key: crypto.randomUUID(), input });

  return { query, command, recovery, captured, blocked, submit };
}

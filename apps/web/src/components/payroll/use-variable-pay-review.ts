import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Variable from "@open-erp/contracts/variable-pay-review";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Schema from "effect/Schema";
import { useCommerceCommandRecovery } from "@/components/commerce/command-recovery";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";

const VariableIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("dispose"), input: Variable.DisposeVariablePay }),
  Schema.Struct({
    kind: Schema.Literal("approve"),
    inputId: Variable.VariablePayAssessment.fields.inputId,
    inputDigest: Variable.VariablePayAssessment.fields.inputDigest,
  }),
]);

export function useVariablePayReview(assessmentId: string) {
  const { book } = useBookWorkspace();
  const client = useQueryClient();
  const root = `${bookPath(book)}/payroll/variable-pay`;

  const queryKey = [...bookKey(book), "payroll", "variable-pay", assessmentId];

  function requireScope(view: typeof Variable.VariablePayReviewView.Type) {
    if (
      view.assessment.id !== assessmentId ||
      view.assessment.scope.entityId !== book.entityId ||
      view.assessment.scope.bookId !== book.id
    )
      throw new Error("Variable-pay assessment scope mismatch");

    return view;
  }

  const recovery = useCommerceCommandRecovery({
    book,
    path: root,
    id: assessmentId,
    schema: VariableIntent,
  });

  const query = useQuery({
    queryKey,
    retry: false,
    gcTime: 0,
    refetchInterval: 2_000,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        (client) =>
          client.variablePayReview.getVariablePayAssessment({
            params: { ...bookScope(book), assessmentId: assessmentId },
          }),
        Variable.VariablePayReviewView,
        { signal },
      );

      return requireScope(view);
    },
  });

  const command = useMutation({
    retry: false,
    mutationFn: async (request: { key: string; input: typeof VariableIntent.Type }) => {
      recovery.retain(request);

      if (request.input.kind === "approve") {
        const inputId = request.input.inputId;

        const prepared = await readAccounting(
          (client, requestOptions) =>
            client.payrollInput.reviewPayrollInput(
              httpRequest(
                Api.groups.payrollInput.endpoints.reviewPayrollInput,
                { params: { ...bookScope(book), inputId } },
                requestOptions,
              ),
            ),
          Inputs.PayrollInputReview,
          {
            method: "POST",
            headers: { "Idempotency-Key": `${request.key}_prepare` },
            body: JSON.stringify({ inputDigest: request.input.inputDigest }),
          },
        );

        if (
          prepared.inputId !== request.input.inputId ||
          prepared.inputDigest !== request.input.inputDigest ||
          prepared.scope.entityId !== book.entityId ||
          prepared.scope.bookId !== book.id
        )
          throw new Error("Variable-pay financial review scope mismatch");

        const approval = await readAccounting(
          (client, requestOptions) =>
            client.payrollInput.approvePayrollInput(
              httpRequest(
                Api.groups.payrollInput.endpoints.approvePayrollInput,
                { params: { ...bookScope(book), reviewId: prepared.id } },
                requestOptions,
              ),
            ),
          Inputs.PayrollInputApproval,
          {
            method: "POST",
            headers: { "Idempotency-Key": `${request.key}_approve` },
            body: JSON.stringify({ reviewDigest: prepared.digest }),
          },
        );

        if (approval.reviewId !== prepared.id || approval.reviewDigest !== prepared.digest)
          throw new Error("Variable-pay approval identity mismatch");

        return { kind: "approve" as const, approval };
      }

      const view = await readAccounting(
        (client, requestOptions) =>
          client.variablePayReview.disposeVariablePay(
            httpRequest(
              Api.groups.variablePayReview.endpoints.disposeVariablePay,
              { params: { ...bookScope(book), assessmentId: assessmentId } },
              requestOptions,
            ),
          ),
        Variable.VariablePayReviewView,
        {
          method: "POST",
          headers: { "Idempotency-Key": request.key },
          body: JSON.stringify(request.input.input),
        },
      );

      return { kind: "dispose" as const, view: requireScope(view) };
    },
    onSuccess: (result, request) => {
      recovery.clear(request.key);

      if (result.kind === "dispose") client.setQueryData(queryKey, result.view);
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: [...bookKey(book), "payroll", "variable-pay"] });
    },
  });

  const captured = command.variables ?? recovery.saved;

  const blocked =
    !recovery.ready || command.isPending || recovery.saved !== null || command.isError;

  const dispose = (input: typeof Variable.DisposeVariablePay.Type) =>
    command.mutate({ key: crypto.randomUUID(), input: { kind: "dispose", input } });

  const approve = () => {
    if (!query.isSuccess || !query.data.current.canApprove) return;

    command.mutate({
      key: crypto.randomUUID(),
      input: {
        kind: "approve",
        inputId: query.data.assessment.inputId,
        inputDigest: query.data.assessment.inputDigest,
      },
    });
  };

  return { query, command, recovery, captured, blocked, dispose, approve };
}

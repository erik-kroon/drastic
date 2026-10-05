import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import type * as Workspace from "@open-erp/contracts/workspace";
import { RegisterDetailLines } from "@open-erp/ui/components/register-workspace";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { useBookWorkspace } from "@/lib/book-context";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { commerceKey, commercePath, checkScope } from "@/components/commerce/shared";
import { AccountingStatus } from "@/components/accounting-status";
import {
  SupplierApprovalExpiry,
  isSupplierApprovalExpired,
  supplierApprovalRefetchInterval,
} from "./commerce/supplier-approval-expiry";

export function WorkSupplierPreview({
  item,
  heading,
  actions,
}: {
  item: typeof Workspace.AttentionItem.Type;
  heading?: ReactNode;
  actions?: ReactNode;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const reference = item.supplierReview;
  const reviewId = reference?.reviewId ?? "";
  const draftId = reference?.draftId ?? "";

  const query = useQuery<typeof Acceptance.SupplierAcceptanceView.Type>({
    queryKey: [...commerceKey(book), "supplier-acceptance-review", reviewId],
    refetchInterval: (query) => supplierApprovalRefetchInterval(query.state.data),
    enabled: Boolean(reference),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/supplier-acceptance-reviews/${encodeURIComponent(reviewId)}`,
        Acceptance.SupplierAcceptanceView,
        { signal },
      );

      checkScope(book, result.plan.scope);
      checkScope(book, result.plan.postingPlan.scope);
      checkScope(book, result.plan.draftSnapshot.scope);

      if (result.approval) checkScope(book, result.approval.scope);

      if (result.acceptance) checkScope(book, result.acceptance.scope);

      if (
        result.plan.id !== reviewId ||
        result.plan.input.draftId !== draftId ||
        result.plan.draftSnapshot.id !== draftId
      )
        throw new Error("Supplier acceptance review mismatch");

      return result;
    },
    retry: false,
  });

  if (!reference) return null;

  if (!query.data || query.isError)
    return (
      <>
        {heading}
        <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
        {actions}
      </>
    );

  const view = query.data;

  if (isSupplierApprovalExpired(view)) {
    return (
      <SupplierApprovalExpiry
        book={book}
        locale={locale}
        view={view}
        heading
        ready={query.isFetchedAfterMount && query.fetchStatus === "idle"}
        onRenewed={() => {
          void query.refetch();
        }}
      />
    );
  }

  const titles =
    locale === "sv"
      ? { posted: "Bokföring", proposed: "Föreslagen bokföring" }
      : { posted: "Posting", proposed: "Proposed posting" };

  const lines = view.plan.postingPlan.groups.flatMap((group) =>
    group.actions.flatMap((action) =>
      action.lines.flatMap((line) => {
        const account = setup.accounts.find((candidate) => candidate.id === line.accountId);
        const amounts = [];

        if (BigInt(line.debitMinor) > 0n) amounts.push({ side: "debit", value: line.debitMinor });

        if (BigInt(line.creditMinor) > 0n)
          amounts.push({ side: "credit", value: `-${line.creditMinor}` });

        if (!amounts.length) amounts.push({ side: "zero", value: "0" });

        return amounts.map((amount) => ({
          id: `${group.id}:${action.occurrenceKey}:${line.lineId}:${amount.side}`,
          description: account ? `${account.code} ${account.name}` : line.description,
          amount: formatMinorAmount(
            amount.value,
            view.plan.draftSnapshot.content.currencyScale,
            locale,
          ),
        }));
      }),
    ),
  );

  return (
    <>
      {heading}
      {!view.dependenciesCurrent && !view.acceptance ? (
        <PageCaption>
          {locale === "sv" ? "Förslaget behöver uppdateras." : "The proposal needs updating."}
        </PageCaption>
      ) : null}
      <RegisterDetailLines
        title={view.acceptance ? titles.posted : titles.proposed}
        lines={lines}
      />
      {actions}
    </>
  );
}

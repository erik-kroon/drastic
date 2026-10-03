import { useState } from "react";
import { defaultStringifySearch, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { PageAction } from "@open-erp/ui/components/accounting-page";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { InvoiceDrafts } from "./invoice-drafts";
import { InvoiceIssueReviewPanel, LegalInvoiceInspector } from "./invoice-issuance";
import { checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type Props = CommerceProps & {
  recordId?: string;
  onOpen?: (id: string) => void;
  onReview?: () => void;
};

export function InvoiceDraftIssueOverlay(props: Props) {
  return (
    <DraftIssueWorkspace
      key={`${props.book.entityId}:${props.book.id}:${props.recordId ?? ""}`}
      {...props}
    />
  );
}

function DraftIssueWorkspace(props: Props) {
  const [local, setLocal] = useState("");
  const recordId = props.recordId ?? local;
  const onOpen = props.onOpen ?? setLocal;

  if (recordId && recordId !== "new") {
    return <SelectedDraftIssue {...props} key={recordId} recordId={recordId} onOpen={onOpen} />;
  }

  return <InvoiceDrafts {...props} recordId={recordId} onOpen={onOpen} />;
}

function SelectedDraftIssue(props: Props & { recordId: string; onOpen: (id: string) => void }) {
  const { book, locale, recordId, onOpen } = props;
  const sv = locale === "sv";
  const search = useSearch({ from: "/entities/$entityId/books/$bookId/sales", shouldThrow: false });

  const draft = useQuery({
    queryKey: [...commerceKey(book), "invoice-draft-lifecycle", recordId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-drafts/${encodeURIComponent(recordId)}`,
        Drafts.InvoiceDraftView,
        { signal },
      );

      checkScope(book, result.record.scope);

      if (result.record.id !== recordId) throw new Error("Issue overlay draft mismatch");

      return result;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const history = useQuery({
    queryKey: [...commerceKey(book), "invoice-issue-history", recordId],
    enabled: draft.data?.lifecycle.kind === "issued_synthetic",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-drafts/${encodeURIComponent(recordId)}/issue-reviews`,
        Issuance.InvoiceIssueHistory,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.draftId !== recordId) throw new Error("Issue overlay draft mismatch");

      return result;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const issued = history.data?.items.find((item) => item.issueId !== null);
  const checked = draft.isFetchedAfterMount && draft.isSuccess;

  if (checked && draft.data.lifecycle.kind === "editable")
    return (
      <InvoiceDrafts
        {...props}
        contextual={!!props.onReview}
        issueAction={
          props.onReview ? (
            <Button onClick={props.onReview}>{sv ? "Granska faktura" : "Review invoice"}</Button>
          ) : (
            <PageAction
              href={`${workspacePath(book)}/sales${defaultStringifySearch({ ...search, view: "issue", record: recordId, kind: "draft", stage: undefined, review: undefined })}`}
            >
              {sv ? "Granska utfärdande" : "Review issuance"}
            </PageAction>
          )
        }
        issueStatus={
          <>
            <Text tone="muted">
              {sv
                ? "Inte utfärdad. Granska fakturan innan utfärdande."
                : "Not issued. Review the invoice before issuance."}
            </Text>
            <Box>
              <Button
                variant="outline"
                disabled={draft.isFetching}
                onClick={() => {
                  void draft.refetch();
                }}
              >
                {sv ? "Uppdatera status" : "Refresh status"}
              </Button>
            </Box>
          </>
        }
      />
    );

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box display="flex" gap="md">
        <Button variant="ghost" onClick={() => onOpen("")}>
          {sv ? "Alla utkast" : "All drafts"}
        </Button>
        <Button
          variant="outline"
          disabled={draft.isFetching}
          onClick={() => {
            void draft.refetch();
          }}
        >
          {sv ? "Uppdatera status" : "Refresh status"}
        </Button>
      </Box>
      <AccountingStatus
        locale={locale}
        pending={!draft.isFetchedAfterMount || draft.isPending}
        error={draft.error}
      />
      {checked && draft.data.lifecycle.kind === "issued_legal" ? (
        <LegalInvoiceInspector
          {...props}
          draftId={recordId}
          issueId={draft.data.lifecycle.issueId}
        />
      ) : null}
      {checked && draft.data.lifecycle.kind === "issued_synthetic" ? (
        <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      ) : null}
      {checked && issued ? (
        <>
          <Heading>{sv ? "Utfärdad demofaktura" : "Issued demo invoice"}</Heading>
          <Text>
            {sv
              ? "Den sparade versionen kan inte ändras. Detta är ett demoutfärdande utan juridiskt fakturanummer eller leverans."
              : "The saved revision cannot be changed. This is a demo issue without a legal invoice number or delivery."}
          </Text>
          <InvoiceIssueReviewPanel {...props} id={issued.id} readOnly />
        </>
      ) : null}
      {draft.isError ? (
        <Text>
          {sv
            ? "Utfärdandestatus kunde inte kontrolleras. Uppdatera innan du redigerar utkastet."
            : "Issue status could not be checked. Refresh before editing this draft."}
        </Text>
      ) : null}
    </Box>
  );
}

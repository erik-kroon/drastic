import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { AccountingStatus } from "@/components/accounting-status";
import {
  bookKey,
  bookPath,
  booksKey,
  mutationOptions,
  readAccounting,
  requiresNewProposal,
} from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function JournalReview({
  book,
  id,
  locale,
  accounts,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  accounts: (typeof Accounting.BookSetup.Type)["accounts"];
}) {
  const copy = accountingCopy(locale);
  const plan = useQuery({
    queryKey: [...bookKey(book), "change-set", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/change-sets/${encodeURIComponent(id)}`,
        Accounting.ChangeSet,
        { signal },
      );
      if (
        result.id !== id ||
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId
      )
        throw new Error("Response scope mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box as="section" id="journal-review" tabIndex={-1} display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.journal_review}</Heading>
      <AccountingStatus locale={locale} pending={plan.isPending} error={plan.error} />
      {plan.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            onClick={() => {
              void plan.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      {plan.data ? (
        <PlanReview
          key={plan.data.planDigest}
          book={book}
          plan={plan.data}
          locale={locale}
          accounts={accounts}
        />
      ) : null}
    </Box>
  );
}

function PlanReview({
  book,
  plan,
  locale,
  accounts,
}: {
  book: typeof Accounting.Book.Type;
  plan: typeof Accounting.ChangeSet.Type;
  locale: Locale;
  accounts: (typeof Accounting.BookSetup.Type)["accounts"];
}) {
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [stale, setStale] = useState(false);
  const [operatorApproval, setOperatorApproval] = useState("");
  const base = `${bookPath(book)}/change-sets/${encodeURIComponent(plan.id)}`;
  const validation = useMutation({
    mutationFn: () => {
      const path = `${base}/validate`;
      return readAccounting(
        path,
        Accounting.ValidationReport,
        mutationOptions(path, "{}", keys.current),
      );
    },
    onError: (error) => {
      if (requiresNewProposal(error)) setStale(true);
    },
  });
  const approval = useMutation({
    mutationFn: () => {
      const path = `${base}/approvals`;
      const payload = Schema.decodeSync(Accounting.ApproveChange)({
        planDigest: plan.planDigest,
        version: plan.version,
      });
      return readAccounting(
        path,
        Accounting.Approval,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onError: (error) => {
      if (requiresNewProposal(error)) setStale(true);
    },
  });
  const execution = useMutation({
    mutationFn: () => {
      const path = `${base}/execute`;
      const payload = Schema.decodeSync(Accounting.ExecuteChange)({
        planDigest: plan.planDigest,
        version: plan.version,
        approvalId: approval.data?.id ?? operatorApproval,
      });
      return readAccounting(
        path,
        Accounting.ExecutionReceipt,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...bookKey(book), "vouchers"] });
      void client.invalidateQueries({ queryKey: [...bookKey(book), "ledger"] });
      void client.invalidateQueries({ queryKey: [...bookKey(book), "bank-reconciliation"] });
      void client.invalidateQueries({ queryKey: [...bookKey(book), "setup"] });
      void client.invalidateQueries({ queryKey: booksKey });
    },
    onError: (error) => {
      if (requiresNewProposal(error)) {
        setStale(true);
        setOperatorApproval("");
        approval.reset();
      }
    },
  });
  const validated =
    validation.data?.changeSetId === plan.id && validation.data.planDigest === plan.planDigest;
  const approved =
    approval.data?.changeSetId === plan.id && approval.data.planDigest === plan.planDigest;
  const agentApproval = book.role === "agent" && Schema.is(Accounting.Identifier)(operatorApproval);
  const busy = validation.isPending || approval.isPending || execution.isPending;
  const locked = busy || stale || execution.isSuccess;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{copy.journal_review_help}</Text>
      <Text>
        {copy.journal_plan_id}: {plan.id}
      </Text>
      <Text>
        {copy.journal_digest}: {plan.planDigest}
      </Text>
      <Text tone="muted">
        {plan.canonicalization} · v{plan.version} · {plan.createdAt}
      </Text>
      {plan.groups.map((group) => (
        <Box key={group.id} display="grid" gap="lg" minWidth="zero">
          <Text tone="muted">
            {group.id} · {group.dependsOnGroupIds.join(", ")}
          </Text>
          {group.actions.map((action) => (
            <SealedAction
              book={book}
              key={action.occurrenceKey}
              action={action}
              locale={locale}
              setupAccounts={accounts}
            />
          ))}
        </Box>
      ))}
      <DataTable
        title={copy.journal_dependencies}
        narrow="stack"
        columns={[
          { id: "resource", label: "ID" },
          { id: "kind", label: copy.journal_description },
          { id: "version", label: "Version" },
          { id: "reason", label: copy.journal_rationale },
        ]}
        rows={plan.dependencies.map((dependency) => ({
          id: `${dependency.kind}/${dependency.resourceId}`,
          cells: [dependency.resourceId, dependency.kind, dependency.version, dependency.reason],
        }))}
      />
      {stale ? <Text role="alert">{copy.journal_stale}</Text> : null}
      <Box display="flex" flexWrap="wrap" gap="lg">
        <Button size="xl" variant="outline" disabled={locked} onClick={() => validation.mutate()}>
          {copy.journal_validate}
        </Button>
        {book.role === "operator" ? (
          <Button
            size="xl"
            disabled={!validated || locked || approved}
            onClick={() => approval.mutate()}
          >
            {copy.journal_approve}
          </Button>
        ) : null}
      </Box>
      <Box role="status" aria-live="polite" display="grid" gap="sm">
        {validated && !stale ? (
          <Text>
            {copy.journal_valid}: {validation.data?.checkedAt}
          </Text>
        ) : null}
        {approved && !stale && !execution.isSuccess ? (
          <>
            <Text>{copy.journal_approved}</Text>
            <Text>
              {copy.journal_approval_id}: {approval.data?.id}
            </Text>
            <Text>
              {copy.journal_expires}: {approval.data?.expiresAt}
            </Text>
          </>
        ) : null}
      </Box>
      <AccountingStatus
        write
        locale={locale}
        pending={validation.isPending || approval.isPending}
        error={validation.error ?? approval.error}
      />
      {book.role === "agent" ? (
        <>
          <Text>{copy.journal_operator_only}</Text>
          <InputField
            label={copy.journal_approval_id}
            value={operatorApproval}
            disabled={locked}
            onChange={(event) => setOperatorApproval(event.target.value)}
          />
        </>
      ) : null}
      <Text tone="muted">{copy.journal_execute_help}</Text>
      <Box>
        <Button
          size="xl"
          disabled={!validated || (!approved && !agentApproval) || locked}
          onClick={() => execution.mutate()}
        >
          {copy.journal_execute}
        </Button>
      </Box>
      <AccountingStatus
        write
        locale={locale}
        pending={execution.isPending}
        error={execution.error}
      />
      {execution.data ? (
        <Box
          as="section"
          role="status"
          display="grid"
          gap="md"
          padding="lg"
          backgroundColor="surface"
          borderRadius="surface"
        >
          <Heading>{copy.journal_receipt}</Heading>
          <Text>{copy.journal_posted}</Text>
          <Text>ID: {execution.data.id}</Text>
          <Text>
            {copy.journal_plan_id}: {execution.data.changeSetId}
          </Text>
          <Text>
            {copy.journal_voucher}: {execution.data.voucherId} · {execution.data.voucherNumber}
          </Text>
          <Text>
            {copy.journal_sequence}: {execution.data.sequence}
          </Text>
          <Text>
            {copy.journal_digest}: {execution.data.planDigest}
          </Text>
          <Text>
            {copy.journal_committed}: {execution.data.committedAt}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function SealedAction({
  book,
  action,
  locale,
  setupAccounts,
}: {
  book: typeof Accounting.Book.Type;
  action: typeof Accounting.VoucherPostingAction.Type;
  locale: Locale;
  setupAccounts: typeof Accounting.BookSetup.Type.accounts;
}) {
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>{action.description}</Text>
      <Text>
        {copy.journal_rationale}: {action.rationale}
      </Text>
      <Text tone="muted">
        {action.postingDate} · {action.currency} · {action.series} · {action.postingPurpose} ·{" "}
        {action.taxAssessment}
      </Text>
      <Text tone="muted">
        {action.eventId} · {action.occurrenceKey} · {action.fiscalYearId} ·{" "}
        {action.accountingPeriodId}
      </Text>
      {action.correctsVoucherId ? (
        <Text>
          {copy.journal_voucher}: {action.correctsVoucherId}
        </Text>
      ) : null}
      <DataTable
        title={copy.journal_line}
        narrow="stack"
        columns={[
          { id: "line", label: copy.bank_line_id },
          { id: "account", label: copy.journal_account },
          { id: "debit", label: copy.journal_debit, numeric: true },
          { id: "credit", label: copy.journal_credit, numeric: true },
          { id: "description", label: copy.journal_description },
        ]}
        rows={action.lines.map((line) => {
          const account = setupAccounts.find((item) => item.id === line.accountId);
          return {
            id: line.lineId,
            cells: [
              line.lineId,
              account ? `${account.code} · ${account.name} · ${line.accountId}` : line.accountId,
              line.debitMinor,
              line.creditMinor,
              line.description,
            ],
          };
        })}
      />
      <Text tone="muted">{copy.journal_evidence_refs}</Text>
      {action.evidenceRefs.map((reference) => (
        <EvidenceInspector
          key={`${reference.evidenceId}/${reference.locator}`}
          book={book}
          reference={reference}
          locale={locale}
        />
      ))}
    </Box>
  );
}

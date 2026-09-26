import { useId, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cases from "@open-erp/contracts/cases";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { SelectField } from "@open-erp/ui/components/field";
import { Label } from "@open-erp/ui/components/label";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { ReviewTarget } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";

export function CaseContextPanel(props: {
  book: typeof Accounting.Book.Type;
  snapshotId: string;
  caseId: string;
  locale: Locale;
  onReview: (target: ReviewTarget) => void;
}) {
  const { book, snapshotId, caseId, locale } = props;
  const copy = accountingCopy(locale);
  const [detail, setDetail] = useState<(typeof Cases.CaseContextInput.Type)["detail"]>("standard");

  const context = useInfiniteQuery({
    queryKey: [...bookKey(book), "case-context", snapshotId, caseId, detail],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const page = await readAccounting(
        `${bookPath(book)}/case-snapshots/${encodeURIComponent(snapshotId)}/cases/${encodeURIComponent(caseId)}/context?maxItems=50&detail=${detail}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Cases.CaseContext,
        { signal },
      );

      if (
        page.snapshot.id !== snapshotId ||
        page.case.id !== caseId ||
        page.snapshot.scope.bookId !== book.id ||
        page.snapshot.scope.entityId !== book.entityId
      )
        throw new Error("Case context scope mismatch");

      return page;
    },
    getNextPageParam: (page) => (page.detail === "summary" ? null : page.history.next),
    retry: false,
  });

  // The captured summary records bundle membership at capture time only, so the
  // destination is resolved against current ownership before any routing.
  const resolve = useMutation({
    mutationFn: (changeSetId: string) =>
      readAccounting(
        `${bookPath(book)}/review-targets/${encodeURIComponent(changeSetId)}`,
        Cases.ReviewResolution,
      ),
    onSuccess: (resolution, changeSetId) => {
      if (changeSetId !== resolve.variables) return;

      if (resolution.kind === "ambiguous") return;

      props.onReview(
        resolution.kind === "standalone"
          ? {
              kind: "standalone",
              changeSetId: resolution.changeSetId,
              planDigest: resolution.planDigest,
            }
          : {
              kind: "correction",
              bundleId: resolution.bundleId,
              bundleDigest: resolution.bundleDigest,
            },
      );
    },
  });

  const conflict =
    resolve.data?.kind === "ambiguous" && resolve.data.changeSetId === resolve.variables
      ? resolve.data
      : null;

  const review = (changeSetId: string) => {
    resolve.reset();
    resolve.mutate(changeSetId);
  };

  const first = context.data?.pages[0];
  const history = context.data?.pages.flatMap((page) => page.history.items) ?? [];

  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.case_inspect}</Heading>
      <Text>
        {copy.case_id}: {caseId}
      </Text>
      <SelectField
        label={copy.case_detail}
        value={detail}
        onValueChange={(value) => {
          if (Schema.is(Cases.CaseContextInput.fields.detail)(value)) setDetail(value);
        }}
        options={[
          { value: "summary", label: copy.case_summary },
          { value: "standard", label: copy.case_standard },
          { value: "evidence", label: copy.case_evidence_detail },
        ]}
      />
      <AccountingStatus locale={locale} pending={context.isPending} error={context.error} />
      {context.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={context.isFetching}
            onClick={() => {
              void context.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      {first ? (
        <>
          <Text tone="muted">
            {copy.case_snapshot_id}: {first.snapshot.id} · {copy.report_sequence}:{" "}
            {first.snapshot.sequence} · {first.snapshot.capturedAt}
          </Text>
          <CaseFacts
            item={first.case}
            locale={locale}
            pending={resolve.isPending}
            onReview={review}
          />
          <AccountingStatus
            write
            locale={locale}
            pending={resolve.isPending}
            error={resolve.error}
          />
          {conflict ? (
            <Box role="alert" display="grid" gap="sm">
              <Heading>{copy.case_owner_conflict}</Heading>
              <Text>{copy.case_owner_conflict_reason}</Text>
              <DataTable
                title={copy.case_conflicting_owners}
                narrow="stack"
                columns={[
                  { id: "bundle", label: copy.case_bundle_id },
                  { id: "role", label: copy.case_role },
                  { id: "digest", label: copy.journal_digest },
                ]}
                rows={conflict.conflictingOwners.map((owner) => ({
                  id: owner.bundleId,
                  cells: [owner.bundleId, owner.role, owner.bundleDigest],
                }))}
              />
              <Text>{copy.case_owner_conflict_recovery}</Text>
            </Box>
          ) : null}
          <Heading>{copy.case_history}</Heading>
          <Text role="status">
            {copy.case_history_loaded}: {history.length} · {copy.case_history_total}:{" "}
            {first.history.total} · {copy.case_history_remaining}:{" "}
            {context.data?.pages.at(-1)?.history.remaining}
          </Text>
          {detail === "summary" ? (
            <Text>{copy.case_history_summary}</Text>
          ) : (
            <DataTable
              title={copy.case_history}
              narrow="stack"
              columns={[
                { id: "plan", label: copy.journal_plan_id },
                { id: "state", label: copy.case_state },
                { id: "date", label: copy.journal_date },
                { id: "period", label: copy.journal_period },
                { id: "description", label: copy.journal_description },
                { id: "debit", label: copy.journal_debit, numeric: true },
                { id: "credit", label: copy.journal_credit, numeric: true },
                { id: "digest", label: copy.journal_digest },
                { id: "voucher", label: copy.journal_voucher },
                { id: "review", label: copy.case_review_plan },
              ]}
              rows={history.map((plan) => ({
                id: plan.changeSetId,
                cells: [
                  plan.changeSetId,
                  plan.state === "posted" ? copy.case_posted : copy.case_proposed,
                  `${plan.postingDate} · ${plan.createdAt}`,
                  `${plan.accountingPeriodId} · ${plan.fiscalYearId}`,
                  `${plan.postingPurpose} · ${plan.currency} · ${copy.journal_line}: ${plan.lineCount}`,
                  plan.debitMinor,
                  plan.creditMinor,
                  plan.planDigest,
                  plan.voucherId ?? "—",
                  // Each row resolves its own plan. The latest plan's owner is
                  // never applied to the alternatives.
                  <Button
                    key={plan.changeSetId}
                    size="xl"
                    variant="outline"
                    disabled={resolve.isPending}
                    onClick={() => {
                      review(plan.changeSetId);
                    }}
                  >
                    {copy.case_review_plan}
                  </Button>,
                ],
              }))}
            />
          )}
          {context.hasNextPage ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                disabled={context.isFetching}
                onClick={() => {
                  void context.fetchNextPage();
                }}
              >
                {copy.case_more_history}
              </Button>
            </Box>
          ) : null}
          <CaseSource book={book} evidence={first.evidence} locale={locale} />
        </>
      ) : null}
    </Box>
  );
}

function CaseFacts({
  item,
  locale,
  pending,
  onReview,
}: {
  item: typeof Cases.CaseSummary.Type;
  locale: Locale;
  pending: boolean;
  onReview: (changeSetId: string) => void;
}) {
  const copy = accountingCopy(locale);

  const state = {
    proposed: copy.case_proposed,
    posted: copy.case_posted,
    reversed: copy.case_reversed,
  };

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>
        {copy.case_event}: {item.eventKey} · {copy.case_state}: {state[item.state]}
      </Text>
      <Heading>{copy.case_facts}</Heading>
      <Text>{copy.case_gross}</Text>
      <Text>
        {copy.journal_debit}: {item.financialState.postedDebitMinor} · {copy.journal_credit}:{" "}
        {item.financialState.postedCreditMinor}
      </Text>
      <Text>{copy.case_no_remaining}</Text>
      <Text tone="muted">{item.financialState.reason}</Text>
      <Text>
        {copy.case_not_assessed}: {item.facts.reason}
      </Text>
      <DataTable
        title={copy.case_obligations}
        narrow="stack"
        columns={[
          { id: "code", label: "Code" },
          { id: "reason", label: copy.journal_rationale },
        ]}
        rows={item.obligations.map((obligation) => ({
          id: obligation.code,
          cells: [obligation.code, obligation.reason],
        }))}
      />
      <Heading>{copy.case_next_actions}</Heading>
      <Text>{copy.case_action_warning}</Text>
      <DataTable
        title={copy.case_next_actions}
        narrow="stack"
        columns={[
          { id: "capability", label: copy.readiness_feature },
          { id: "reason", label: copy.journal_rationale },
          { id: "inputs", label: copy.case_required_fields },
        ]}
        rows={item.nextActions.map((action) => ({
          id: action.capability,
          cells: [action.capability, action.reason, action.requiredFields.join(", ")],
        }))}
      />
      <Text>
        {copy.case_latest_plan}: {item.latestPlanId}
      </Text>
      {item.latestPlanCorrectionBundle ? (
        <Text tone="muted">
          {copy.case_latest_plan_bundle}: {item.latestPlanCorrectionBundle.bundleId} ·{" "}
          {item.latestPlanCorrectionBundle.role}
        </Text>
      ) : null}
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={pending}
          onClick={() => {
            onReview(item.latestPlanId);
            requestAnimationFrame(() => document.getElementById("journal-review")?.focus());
          }}
        >
          {copy.case_review_plan}
        </Button>
      </Box>
      <details>
        <summary>{copy.case_vouchers}</summary>
        <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
          {item.vouchers.length === 0 ? (
            <Text>{copy.case_no_items}</Text>
          ) : (
            <DataTable
              title={copy.case_vouchers}
              narrow="stack"
              columns={[
                { id: "voucher", label: copy.journal_voucher },
                { id: "sequence", label: copy.journal_sequence },
                { id: "purpose", label: copy.journal_description },
                { id: "receipt", label: copy.journal_receipt },
                { id: "digest", label: copy.journal_digest },
              ]}
              rows={item.vouchers.map((voucher) => ({
                id: voucher.voucherId,
                cells: [
                  `${voucher.voucherId} · ${voucher.number}`,
                  voucher.sequence,
                  voucher.postingPurpose,
                  `${voucher.receipt.id} · ${voucher.receipt.changeSetId} · ${voucher.receipt.committedAt}`,
                  voucher.receipt.planDigest,
                ],
              }))}
            />
          )}
        </Box>
      </details>
    </Box>
  );
}

function CaseSource({
  book,
  evidence,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  evidence: (typeof Cases.CaseContext.Type)["evidence"];
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const contentId = useId();

  const contentState = {
    not_requested: copy.case_content_not_requested,
    excerpt: copy.case_content_excerpt,
    complete: copy.case_content_complete,
  };

  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.journal_evidence_refs}</Heading>
      <Box padding="lg" backgroundColor="muted" borderRadius="surface">
        <Text>{copy.case_untrusted}</Text>
      </Box>
      <Text>
        {evidence.reference.title} · {evidence.reference.origin} · {evidence.reference.mediaType}
      </Text>
      <Text>{contentState[evidence.contentState]}</Text>
      <Text>
        {copy.case_total_characters}: {evidence.totalCharacters} · {copy.case_returned_characters}:{" "}
        {evidence.returnedCharacters} · {copy.case_remaining_characters}:{" "}
        {evidence.remainingCharacters}
      </Text>
      {evidence.content !== null ? (
        <>
          <Label htmlFor={contentId}>{contentState[evidence.contentState]}</Label>
          <Box
            display="grid"
            minWidth="zero"
            borderWidth="thin"
            borderColor="default"
            borderRadius="control"
            backgroundColor="surface"
            padding="md"
          >
            <textarea id={contentId} value={evidence.content} readOnly rows={8} cols={16} />
          </Box>
        </>
      ) : null}
      <Text tone="muted">{copy.case_full_source_help}</Text>
      <EvidenceInspector book={book} reference={evidence.reference} locale={locale} />
    </Box>
  );
}

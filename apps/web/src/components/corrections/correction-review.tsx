import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { SealedAction } from "@/components/journal-review";
import {
  bookKey,
  bookPath,
  booksKey,
  mutationOptions,
  readAccounting,
  requiresNewProposal,
} from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { correctionCopy } from "./copy";
import { CorrectionChainView, CorrectionImpactDetails } from "./impact-review";

export function CorrectionReview({
  book,
  setup,
  locale,
  id,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  id: string;
}) {
  const copy = correctionCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [confirmed, setConfirmed] = useState(false);
  const base = `${bookPath(book)}/correction-bundles/${encodeURIComponent(id)}`;

  const view = useQuery({
    queryKey: [...bookKey(book), "correction-bundle", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(base, Corrections.CorrectionBundleView, { signal });

      if (
        result.bundle.id !== id ||
        result.bundle.scope.bookId !== book.id ||
        result.bundle.scope.entityId !== book.entityId
      )
        throw new Error("Response scope mismatch");

      return result;
    },
    retry: false,
  });

  const [requestKey, setRequestKey] = useState("");
  const impactId = view.data?.bundle.impactReview?.id;

  const impact = useQuery({
    queryKey: [...bookKey(book), "correction-impact", impactId],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/correction-impact-reviews/${encodeURIComponent(impactId ?? "")}`,
        Corrections.CorrectionImpactView,
        { signal },
      ),
    enabled: !!impactId,
    retry: false,
  });

  const approval = useMutation({
    mutationFn: (bundle: typeof Corrections.CorrectionBundle.Type) => {
      const path = `${base}/approvals`;
      const body = JSON.stringify({ bundleDigest: bundle.bundleDigest, version: bundle.version });
      const options = mutationOptions(path, body, keys.current);
      setRequestKey(keys.current.get(`${path}:${body}`) ?? "");

      return readAccounting(path, Corrections.CorrectionBundleApproval, options);
    },
    onSuccess: () => {
      void view.refetch();
    },
  });

  const execution = useMutation({
    mutationFn: (input: typeof Corrections.ExecuteCorrectionBundle.Type) => {
      const path = `${base}/execute`;
      const body = JSON.stringify(input);
      const options = mutationOptions(path, body, keys.current);
      setRequestKey(keys.current.get(`${path}:${body}`) ?? "");

      return readAccounting(path, Corrections.CorrectionBundleReceipt, options);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
      void client.invalidateQueries({ queryKey: booksKey });
    },
  });

  const bundle = view.data?.bundle;
  const currentApproval = view.data?.approval;
  const receipt = execution.data ?? view.data?.receipt;

  const busy = [approval.isPending, execution.isPending, view.isFetching, impact.isFetching].some(
    Boolean,
  );

  const impactBlocked =
    !!impactId && (!impact.data?.snapshotCurrent || impact.data.impact.basis.blockers.length > 0);

  const expired = currentApproval ? Date.parse(currentApproval.expiresAt) <= Date.now() : false;
  const stale = requiresNewProposal(approval.error) || requiresNewProposal(execution.error);

  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>
      <Text>{copy.retry}</Text>
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void view.refetch();

            if (impactId) void impact.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {bundle ? (
        <>
          <Text>
            {copy.bundleId}: {bundle.id}
          </Text>
          <Text>
            {copy.digest}: {bundle.bundleDigest}
          </Text>
          <Text>
            {copy.rationale}: {bundle.rationale}
          </Text>
          <Text>{copy.policy}</Text>
          <Text>{copy.reviewHelp}</Text>
          <CorrectionChainView
            book={book}
            setup={setup}
            locale={locale}
            id={bundle.originalVoucher.id}
          />
          <SavedImpactReview
            book={book}
            locale={locale}
            impact={impact}
            reference={bundle.impactReview}
            committed={!!receipt}
          />
          {requestKey ? (
            <Box role="status" display="grid" gap="sm">
              <Text>
                {copy.requestKey}: {requestKey}
              </Text>
              <Text tone="muted">{copy.requestHint}</Text>
            </Box>
          ) : null}
          <details>
            <summary>
              {copy.original} · {bundle.originalVoucher.id}
            </summary>
            <Box paddingBlock="lg">
              <SealedAction
                book={book}
                action={bundle.originalVoucher.action}
                locale={locale}
                setupAccounts={setup.accounts}
              />
            </Box>
          </details>
          {[
            { title: copy.reversal, plan: bundle.reversal },
            { title: copy.replacement, plan: bundle.replacement },
          ].map(({ title, plan }) => (
            <Box key={plan.id} display="grid" gap="md" minWidth="zero">
              <Heading>{title}</Heading>
              <Text>
                {plan.id} · {plan.planDigest}
              </Text>
              {plan.groups.flatMap((group) =>
                group.actions.map((action) => (
                  <SealedAction
                    key={`${group.id}/${action.eventId}`}
                    book={book}
                    action={action}
                    locale={locale}
                    setupAccounts={setup.accounts}
                  />
                )),
              )}
              <DataTable
                title={copy.dependencies}
                narrow="stack"
                columns={[
                  { id: "resource", label: copy.resource },
                  { id: "version", label: copy.version },
                  { id: "reason", label: copy.reason },
                ]}
                rows={plan.dependencies.map((dependency) => ({
                  id: `${dependency.kind}/${dependency.resourceId}`,
                  cells: [
                    `${dependency.kind} · ${dependency.resourceId}`,
                    dependency.version,
                    dependency.reason,
                  ],
                }))}
              />
            </Box>
          ))}
          {receipt ? (
            <Box
              role="status"
              display="grid"
              gap="md"
              padding="lg"
              backgroundColor="surface"
              borderRadius="surface"
              minWidth="zero"
            >
              <Heading>{copy.receipt}</Heading>
              <Text>{copy.committed}</Text>
              <Text>
                {receipt.id} · {receipt.committedAt}
              </Text>
              <Text>
                {copy.original}: {receipt.originalVoucherId}
              </Text>
              <Text>
                {copy.reversal}: {receipt.reversal.voucherId} · {receipt.reversal.voucherNumber} ·{" "}
                {receipt.reversal.sequence}
              </Text>
              <Text>
                {copy.replacement}: {receipt.replacement.voucherId} ·{" "}
                {receipt.replacement.voucherNumber} · {receipt.replacement.sequence}
              </Text>
              <Text>
                {copy.digest}: {receipt.bundleDigest}
              </Text>
            </Box>
          ) : (
            <>
              <Text tone="muted">{copy.operator}</Text>
              <Box as="label" display="flex" alignItems="center" gap="md" paddingBlock="md">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {copy.confirm}
              </Box>
              {currentApproval ? (
                <Box role="status" display="grid" gap="sm">
                  <Text>
                    {copy.approval}: {currentApproval.id} · {currentApproval.actorId}
                  </Text>
                  <Text>
                    {copy.expiry}: {currentApproval.expiresAt}
                  </Text>
                </Box>
              ) : null}
              {stale || expired ? <Text role="alert">{copy.stale}</Text> : null}
              <Box display="flex" flexWrap="wrap" gap="lg">
                {book.role === "operator" ? (
                  <Button
                    size="xl"
                    variant="outline"
                    disabled={
                      !confirmed || busy || impactBlocked || (!!currentApproval && !expired)
                    }
                    onClick={() => {
                      // A read-confirmed invalid approval needs a new command. An
                      // uncertain response keeps its key for refresh/retry.
                      if (expired || (!currentApproval && approval.data)) {
                        const body = JSON.stringify({
                          bundleDigest: bundle.bundleDigest,
                          version: bundle.version,
                        });

                        keys.current.delete(`${base}/approvals:${body}`);
                      }

                      approval.mutate(bundle);
                    }}
                  >
                    {copy.approve}
                  </Button>
                ) : null}
                <Button
                  size="xl"
                  disabled={!confirmed || busy || impactBlocked || !currentApproval || expired}
                  onClick={() => {
                    if (currentApproval)
                      execution.mutate({
                        bundleDigest: bundle.bundleDigest,
                        version: bundle.version,
                        approvalId: currentApproval.id,
                      });
                  }}
                >
                  {copy.execute}
                </Button>
              </Box>
              <AccountingStatus
                write
                locale={locale}
                pending={approval.isPending || execution.isPending}
                error={approval.error ?? execution.error}
              />
            </>
          )}
        </>
      ) : null}
    </Box>
  );
}

function SavedImpactReview(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  impact: UseQueryResult<typeof Corrections.CorrectionImpactView.Type, Error>;
  reference: typeof Corrections.ImpactReference.Type | undefined;
  committed: boolean;
}) {
  const { book, locale, impact } = props;
  const copy = correctionCopy(locale);

  if (!props.reference) return <Text tone="muted">{copy.missingImpact}</Text>;

  return (
    <>
      <AccountingStatus locale={locale} pending={impact.isPending} error={impact.error} />
      {impact.data ? (
        <>
          {!props.committed ? (
            <Text role="status">
              {impact.data.snapshotCurrent ? copy.impactCurrent : copy.impactStale}
            </Text>
          ) : null}
          <CorrectionImpactDetails book={book} impact={impact.data.impact} locale={locale} />
        </>
      ) : null}
    </>
  );
}

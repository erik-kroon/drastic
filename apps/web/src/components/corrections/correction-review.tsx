import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { SealedAction } from "@/components/journal-review";
import { CorrectionBreadcrumb } from "@open-erp/ui/components/correction-bundle-review";
import { WorkReturnAction } from "@/components/work-return-action";
import {
  bookKey,
  bookPath,
  booksKey,
  mutationOptions,
  readAccounting,
  requiresNewProposal,
  isUncertainWriteError,
} from "@/lib/accounting-api";
import { workQueryOptions } from "@/lib/workspace-api";
import { useWorkReturn } from "@/lib/work-return";
import { accountingCopy } from "@/lib/accounting-copy";
import { reviewTargetPath, workspacePath } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";
import { bundleWorkspaceCopy } from "./workspace-copy";
import { correctionCopy } from "./copy";
import { CorrectionChainView, CorrectionImpactDetails } from "./impact-review";
import { BundleWorkspace, type BundleReviewState } from "./bundle-workspace";

export type CorrectionEntryWitness = {
  constituentId?: string;
  planDigest?: string;
  bundleDigest: string;
};

function conflictingEntry(
  bundle: typeof Corrections.CorrectionBundle.Type | undefined,
  entry: CorrectionEntryWitness | undefined,
) {
  if (!bundle || !entry) return false;

  if (bundle.bundleDigest !== entry.bundleDigest) return true;

  if (!entry.constituentId) return !!entry.planDigest;

  const constituent = [bundle.reversal, bundle.replacement].find(
    (plan) => plan.id === entry.constituentId,
  );

  return !constituent || (!!entry.planDigest && constituent.planDigest !== entry.planDigest);
}

export function CorrectionReview(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  id: string;
  entry?: CorrectionEntryWitness;
}) {
  const { book, setup, locale, id } = props;
  const copy = correctionCopy(locale);
  const labels = bundleWorkspaceCopy(locale);
  const client = useQueryClient();
  const work = useWorkReturn();
  const keys = useRef(new Map<string, string>());
  const retainedApproval = useRef<typeof Corrections.CorrectionBundleApproval.Type | null>(null);
  const [requestKey, setRequestKey] = useState("");
  const base = `${bookPath(book)}/correction-bundles/${encodeURIComponent(id)}`;
  const metadata = useQuery(workQueryOptions(book, {}));

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

  const impactReference = view.data?.bundle.impactReview;

  const impact = useQuery({
    queryKey: [...bookKey(book), "correction-impact", impactReference?.id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/correction-impact-reviews/${encodeURIComponent(impactReference?.id ?? "")}`,
        Corrections.CorrectionImpactView,
        { signal },
      );

      if (
        result.impact.id !== impactReference?.id ||
        result.impact.digest !== impactReference.digest ||
        result.impact.voucherId !== view.data?.bundle.originalVoucher.id ||
        result.impact.scope.bookId !== book.id ||
        result.impact.scope.entityId !== book.entityId
      )
        throw new Error("Correction impact witness mismatch");

      if (
        result.impact.basis.chain.selectedVoucherId !== result.impact.voucherId ||
        !result.impact.basis.chain.vouchers.some(
          (voucher) => voucher.id === result.impact.voucherId,
        )
      )
        throw new Error("Correction original is missing from the retained chain");

      return result;
    },
    enabled: !!impactReference,
    retry: false,
  });

  const posting = useMutation({
    mutationFn: async (bundle: typeof Corrections.CorrectionBundle.Type) => {
      let approval = retainedApproval.current ?? view.data?.approval;

      if (!approval || Date.parse(approval.expiresAt) <= Date.now()) {
        const path = `${base}/approvals`;
        const body = JSON.stringify({ bundleDigest: bundle.bundleDigest, version: bundle.version });

        if (approval && Date.parse(approval.expiresAt) <= Date.now()) {
          keys.current.delete(`${path}:${body}`);
        }

        const options = mutationOptions(path, body, keys.current);
        setRequestKey(keys.current.get(`${path}:${body}`) ?? "");
        approval = await readAccounting(path, Corrections.CorrectionBundleApproval, options);

        if (approval.bundleId !== bundle.id || approval.bundleDigest !== bundle.bundleDigest)
          throw new Error("Correction approval witness mismatch");
        retainedApproval.current = approval;
      }

      const path = `${base}/execute`;

      const body = JSON.stringify({
        bundleDigest: bundle.bundleDigest,
        version: bundle.version,
        approvalId: approval.id,
      });

      const options = mutationOptions(path, body, keys.current);
      setRequestKey(keys.current.get(`${path}:${body}`) ?? "");

      const receipt = await readAccounting(path, Corrections.CorrectionBundleReceipt, options);

      if (
        receipt.bundleId !== bundle.id ||
        receipt.bundleDigest !== bundle.bundleDigest ||
        receipt.originalVoucherId !== bundle.originalVoucher.id
      )
        throw new Error("Correction receipt witness mismatch");

      return receipt;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: bookKey(book) });
      await client.invalidateQueries({ queryKey: booksKey });
    },
  });

  const reprepare = useMutation({
    mutationFn: async (intent: typeof Corrections.CorrectionIntent.Type) => {
      const originalId = view.data?.bundle.originalVoucher.id;
      const path = `${bookPath(book)}/vouchers/${encodeURIComponent(originalId ?? "")}`;
      const impactPath = `${path}/correction-impact-reviews`;
      const body = JSON.stringify(intent);

      const snapshot = await readAccounting(
        impactPath,
        Corrections.CorrectionImpact,
        mutationOptions(impactPath, body, keys.current),
      );

      const bundlePath = `${path}/correction-bundles`;

      return readAccounting(
        bundlePath,
        Corrections.CorrectionBundle,
        mutationOptions(
          bundlePath,
          JSON.stringify({ ...intent, impactReview: { id: snapshot.id, digest: snapshot.digest } }),
          keys.current,
        ),
      );
    },
  });

  const bundle = view.data?.bundle;
  const receipt = posting.data ?? view.data?.receipt;

  const busy =
    posting.isPending ||
    reprepare.isPending ||
    view.isFetching ||
    impact.isFetching ||
    metadata.isFetching;

  const state = bundleReviewState({
    bundle,
    receipt,
    impact: impact.data,
    readFailed: view.isError || impact.isError,
    error: posting.error,
    periods: setup.periods,
    scale: metadata.isSuccess ? metadata.data.currencyScale : undefined,
  });

  const conflict = conflictingEntry(bundle, props.entry);

  const refresh = async () => {
    const current = await view.refetch();
    const basis = impactReference ? await impact.refetch() : undefined;

    if (
      !current.isError &&
      (!basis || !basis.isError) &&
      !requiresNewProposal(posting.error) &&
      !writeDenied(posting.error)
    )
      posting.reset();
  };

  if (bundle && conflict)
    return (
      <Box display="grid" gap="md" padding="md">
        <Text role="alert">{accountingCopy(locale).workspace_revision_mismatch}</Text>
        <Link
          href={reviewTargetPath(book, {
            kind: "correction",
            bundleId: bundle.id,
            bundleDigest: bundle.bundleDigest,
          })}
        >
          {accountingCopy(locale).workspace_current_revision}
        </Link>
      </Box>
    );

  if (!bundle)
    return (
      <Box display="grid" gap="md">
        <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
    );

  return (
    <BundleWorkspace
      bundle={bundle}
      impact={impact.data}
      setup={setup}
      locale={locale}
      scale={metadata.isSuccess ? metadata.data.currencyScale : undefined}
      receipt={receipt}
      state={state}
      breadcrumb={
        <>
          <CorrectionBreadcrumb
            segments={[
              <Link href={`${workspacePath(book)}/books`}>{labels.bookkeeping}</Link>,
              labels.vouchers,
              <Link
                href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(bundle.originalVoucher.id)}`}
              >
                {bundle.originalVoucher.action.series}
                {bundle.originalVoucher.number}
              </Link>,
              labels.reviewCorrectionBundle,
            ]}
          />
          <WorkReturnAction work={work} />
        </>
      }
      actions={
        <>
          <AccountingStatus
            locale={locale}
            pending={[
              view.isPending,
              !!impactReference && impact.isPending,
              metadata.isPending,
            ].some(Boolean)}
            error={view.error ?? impact.error ?? metadata.error}
          />
          {state === "reviewing" &&
          book.role === "operator" &&
          !isUncertainWriteError(posting.error) ? (
            <Button
              fullWidth
              disabled={busy}
              onClick={() => {
                posting.mutate(bundle);
              }}
            >
              {labels.approveTheCompleteCorrection}
            </Button>
          ) : null}
          {state === "stale" && impact.data ? (
            <Button
              fullWidth
              disabled={busy}
              onClick={() => {
                reprepare.mutate(impact.data.impact.basis.intent);
              }}
            >
              {labels.prepareAgainOnTheCurrentBasis2}
            </Button>
          ) : null}
          <PeriodRecoveryLink book={book} locale={locale} impact={impact.data} />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void refresh();
            }}
          >
            {copy.refresh}
          </Button>
          <AccountingStatus
            write
            locale={locale}
            pending={posting.isPending || reprepare.isPending}
            error={posting.error ?? reprepare.error}
          />
          {isUncertainWriteError(posting.error) ? <Text role="status">{copy.retry}</Text> : null}
          {requestKey ? (
            <Text>
              {copy.requestKey}: {requestKey}
            </Text>
          ) : null}
          {reprepare.data ? (
            <Link
              href={reviewTargetPath(book, {
                kind: "correction",
                bundleId: reprepare.data.id,
                bundleDigest: reprepare.data.bundleDigest,
              })}
            >
              {labels.reviewTheNewCorrectionBundle}
            </Link>
          ) : null}
        </>
      }
      details={
        <>
          <BundleReceipt receipt={receipt} locale={locale} />
          <details>
            <summary>{labels.evidenceImpactsAndCorrectionHistory}</summary>
            <Box display="grid" gap="lg" paddingBlock="lg">
              <CorrectionChainView
                book={book}
                setup={setup}
                locale={locale}
                id={bundle.originalVoucher.id}
              />
              {impact.data ? (
                <CorrectionImpactDetails book={book} impact={impact.data.impact} locale={locale} />
              ) : (
                <Text>{copy.missingImpact}</Text>
              )}
              <Heading>{copy.original}</Heading>
              <SealedAction
                book={book}
                action={bundle.originalVoucher.action}
                locale={locale}
                setupAccounts={setup.accounts}
              />
              {[
                { title: copy.reversal, plan: bundle.reversal },
                { title: copy.replacement, plan: bundle.replacement },
              ].map(({ title, plan }) => (
                <Box key={plan.id} display="grid" gap="md">
                  <Heading>{title}</Heading>
                  <Text>
                    {plan.id}, {plan.planDigest}
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
                </Box>
              ))}
            </Box>
          </details>
        </>
      }
    />
  );
}

function PeriodRecoveryLink(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  impact?: typeof Corrections.CorrectionImpactView.Type;
}) {
  const basis = props.impact?.currentBasis ?? props.impact?.impact.basis;

  if (!basis?.blockers.some((blocker) => blocker.code === "PeriodLocked")) return null;

  return (
    <Link href={`${workspacePath(props.book)}/closing`}>
      {props.locale === "sv" ? "Öppna periodens arbetsflöde" : "Open the period workflow"}
    </Link>
  );
}

function writeDenied(error: Error | null) {
  return (
    error instanceof Accounting.AccountingError &&
    ["Unauthorized", "Forbidden", "NotFound"].includes(error.code)
  );
}

function bundleReviewState(input: {
  bundle?: typeof Corrections.CorrectionBundle.Type;
  receipt?: typeof Corrections.CorrectionBundleReceipt.Type | null;
  impact?: typeof Corrections.CorrectionImpactView.Type;
  readFailed: boolean;
  error: Error | null;
  periods: (typeof Accounting.BookSetup.Type)["periods"];
  scale?: number;
}): BundleReviewState {
  if (input.receipt) return "committed";

  if (input.scale === undefined) return "unavailable";

  if (input.readFailed || writeDenied(input.error) || (input.bundle?.impactReview && !input.impact))
    return "unavailable";

  if (requiresNewProposal(input.error) || input.impact?.snapshotCurrent === false) return "stale";

  if ((input.impact?.impact.basis.blockers.length ?? 0) > 0) return "blocked";

  const periodId = input.bundle?.replacement.groups[0]?.actions[0]?.accountingPeriodId;

  if (input.periods.some((period) => period.id === periodId && period.locked)) return "blocked";

  return "reviewing";
}

export function correctionEntryWitness(query: {
  correctionDigest?: string;
  correctionChild?: string;
  correctionPlanDigest?: string;
}): CorrectionEntryWitness | undefined {
  if (!query.correctionDigest && !query.correctionChild && !query.correctionPlanDigest)
    return undefined;

  return {
    bundleDigest: query.correctionDigest ?? "",
    constituentId: query.correctionChild,
    planDigest: query.correctionPlanDigest,
  };
}

function BundleReceipt({
  receipt,
  locale,
}: {
  receipt: typeof Corrections.CorrectionBundleReceipt.Type | null | undefined;
  locale: Locale;
}) {
  if (!receipt) return null;

  const copy = correctionCopy(locale);

  return (
    <Box role="status" display="grid" gap="md" paddingBlock="lg">
      <Heading>{copy.receipt}</Heading>
      <Text>{copy.committed}</Text>
      <Text>
        {receipt.id}, {receipt.committedAt}
      </Text>
      <Text>
        {copy.original}: {receipt.originalVoucherId}
      </Text>
      <Text>
        {copy.reversal}: {receipt.reversal.voucherId}, {receipt.reversal.voucherNumber},{" "}
        {receipt.reversal.sequence}
      </Text>
      <Text>
        {copy.replacement}: {receipt.replacement.voucherId}, {receipt.replacement.voucherNumber},{" "}
        {receipt.replacement.sequence}
      </Text>
      <Text>
        {copy.digest}: {receipt.bundleDigest}
      </Text>
    </Box>
  );
}

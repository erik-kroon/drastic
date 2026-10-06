import type { ReactNode } from "react";
import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Corrections from "@open-erp/contracts/corrections";
import {
  CorrectionBundleWorkspace,
  CorrectionReviewBadge,
  CorrectionApprovalPanel,
  CorrectionDependencyTable,
  CorrectionChangeFacts,
} from "@open-erp/ui/components/correction-bundle-review";
import type { Locale } from "@/paraglide/runtime";
import { bundleWorkspaceCopy } from "./workspace-copy";
import { correctionCopy } from "./copy";
import { staleCopy } from "./stale-copy";
import {
  correctionDate,
  correctionTime,
  displayDigest,
  type CorrectionPresentationEvidence,
} from "./presentation-evidence";

export function StaleBundleWorkspace(props: {
  bundle: typeof Corrections.CorrectionBundle.Type;
  impact?: typeof Corrections.CorrectionImpactView.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  amount: (value: string) => string;
  presentation?: CorrectionPresentationEvidence;
  actions: ReactNode;
  footer?: ReactNode;
  details: ReactNode;
  breadcrumb: ReactNode;
}) {
  const { bundle, locale, presentation } = props;
  const labels = bundleWorkspaceCopy(locale);
  const text = staleCopy(locale);
  const original = `${bundle.originalVoucher.action.series}${bundle.originalVoucher.number}`;
  const reversal = presentation?.reversalLabel ?? labels.reversal;
  const replacement = presentation?.replacementLabel ?? correctionCopy(locale).replacement;
  const denial = presentation?.deniedAt;
  const changedAt = presentation?.changedAt;

  return (
    <CorrectionBundleWorkspace
      breadcrumb={props.breadcrumb}
      warning={
        denial && changedAt
          ? text.warning(correctionDate(denial, locale, true), correctionTime(changedAt, locale))
          : correctionCopy(locale).impactStale
      }
      title={`${labels.correctionBundle} ${presentation?.bundleLabel ?? bundle.id} ${labels.isOutdated}`}
      status={
        presentation?.synthetic ? (
          <CorrectionReviewBadge variant="outline" example>
            {text.example}
          </CorrectionReviewBadge>
        ) : null
      }
      description={
        presentation
          ? text.description(reversal, replacement, original)
          : labels.reversalAndReplacementCannotBeApproved
      }
      aside={<StaleBundleAside {...props} />}
    >
      <CorrectionDependencyTable
        title={labels.dependenciesUsedByTheBundle}
        columns={[
          labels.dependency,
          `${labels.prepared} ${correctionDate(bundle.createdAt, locale, true)}`,
          `${labels.now}${denial ? ` ${correctionDate(denial, locale, true)}` : ""}`,
          labels.status,
        ]}
        rows={staleDependencyRows(props)}
      />
      <StaleChangeFacts {...props} />
      {props.details}
    </CorrectionBundleWorkspace>
  );
}

function StaleChangeFacts(props: Parameters<typeof StaleBundleWorkspace>[0]) {
  const { impact, locale, presentation, amount } = props;
  const text = staleCopy(locale);
  const before = impact?.impact.basis.registerContribution;
  const current = impact?.currentBasis;
  const now = current?.registerContribution;
  const invoiceBefore = before?.kind === "invoice_recognition_replacement_v1" ? before : undefined;
  const invoiceNow = now?.kind === "invoice_recognition_replacement_v1" ? now : undefined;
  const changedAt = presentation?.changedAt;

  return (
    <CorrectionChangeFacts
      title={text.whatChanged}
      rows={[
        ...(changedAt && presentation?.changedBy && invoiceBefore && invoiceNow
          ? [
              {
                label: text.event,
                value: text.allocationEvent(
                  correctionDate(changedAt, locale, true),
                  presentation.changedBy,
                  amount(
                    (
                      BigInt(invoiceNow.allocatedMinor) - BigInt(invoiceBefore.allocatedMinor)
                    ).toString(),
                  ),
                  invoiceBefore.documentNumber,
                ),
              },
            ]
          : []),
        {
          label: text.whyInvalid,
          value:
            invoiceBefore &&
            invoiceNow &&
            (invoiceBefore.allocatedMinor !== invoiceNow.allocatedMinor ||
              invoiceBefore.outstandingMinor !== invoiceNow.outstandingMinor)
              ? text.invoiceInvalid
              : (current?.blockers[0]?.message ?? correctionCopy(locale).impactStale),
        },
      ]}
      note={text.oldApproval}
    />
  );
}

function StaleBundleAside(props: Parameters<typeof StaleBundleWorkspace>[0]) {
  const { bundle, locale, presentation, impact } = props;
  const labels = bundleWorkspaceCopy(locale);
  const text = staleCopy(locale);
  const original = `${bundle.originalVoucher.action.series}${bundle.originalVoucher.number}`;
  const denial = presentation?.deniedAt;
  const preparedTime = correctionTime(bundle.createdAt, locale);
  const frozenDigest = impact?.storedBasisDigest;
  const currentDigest = impact?.currentDigest;

  return (
    <CorrectionApprovalPanel
      label={text.currentState}
      title={presentation ? text.prepareAgain : labels.prepareAgainOnTheCurrentBasis}
      plainFacts
      facts={[
        {
          label: `${labels.reversal} ${presentation?.reversalLabel ?? ""}`.trim(),
          value: presentation ? text.notPosted : labels.outdated,
        },
        {
          label:
            `${correctionCopy(locale).replacement} ${presentation?.replacementLabel ?? ""}`.trim(),
          value: presentation ? text.notPosted : labels.outdated,
        },
        {
          label: `Original ${original}`,
          value: presentation ? text.retained : labels.retained2,
          tone: "unchanged",
        },
        {
          label: text.yourApproval,
          value: denial ? text.denied : labels.outdated,
          tone: "changed",
        },
      ]}
      basisNote={
        frozenDigest && currentDigest
          ? denial
            ? text.digest(displayDigest(frozenDigest), displayDigest(currentDigest))
            : `${labels.basisDigest}: ${displayDigest(frozenDigest)} → ${displayDigest(currentDigest)}`
          : undefined
      }
      stepsLabel={labels.steps}
      steps={[
        {
          title: text.preparedOutdated,
          status: preparedTime,
        },
        {
          title: denial ? text.approvalDenied : text.basisChanged,
          status: denial ? correctionTime(denial, locale) : labels.outdated,
          tone: "changed",
        },
        {
          title: text.prepareNext,
          status: text.next,
          current: true,
          tone: "changed",
        },
        {
          title: `${text.newApproval}${presentation?.approverName ? `, ${presentation.approverName}` : ""}`,
          status: text.afterStep3,
        },
      ]}
      note={null}
      footer={props.footer}
    >
      {props.actions}
    </CorrectionApprovalPanel>
  );
}

function staleDependencyRows(
  props: Parameters<typeof StaleBundleWorkspace>[0],
): Parameters<typeof CorrectionDependencyTable>[0]["rows"] {
  const { bundle, impact, locale, setup } = props;
  const presentation = props.presentation;
  const amount = props.amount;
  const labels = bundleWorkspaceCopy(locale);
  const text = staleCopy(locale);
  const basis = impact?.impact.basis;
  const before = basis?.registerContribution;
  const current = impact?.currentBasis?.registerContribution;
  const invoiceBefore = before?.kind === "invoice_recognition_replacement_v1" ? before : undefined;
  const invoiceNow = current?.kind === "invoice_recognition_replacement_v1" ? current : undefined;

  const rows: Array<Parameters<typeof CorrectionDependencyTable>[0]["rows"][number]> = [
    {
      id: "original",
      name: `Original ${bundle.originalVoucher.action.series}${bundle.originalVoucher.number}`,
      before: labels.retained2,
      current: labels.retained2,
      status: labels.same,
    },
  ];

  const period = setup.periods.find((item) => item.id === basis?.intent.accountingPeriodId);

  const accounts = setup.accounts
    .filter((account) =>
      basis?.netChange.some((entry) => entry.accountId === account.id && entry.deltaMinor !== "0"),
    )
    .sort((left, right) => left.code.localeCompare(right.code));

  if (period)
    rows.push({
      id: "period",
      name: `Period ${new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${period.startsOn}T12:00:00Z`))}`,
      before: text.open,
      current: period.locked ? text.locked : text.open,
      status: period.locked ? labels.changed : labels.same,
      changed: period.locked,
    });

  if (accounts.length)
    rows.push({
      id: "accounts",
      name: `${text.accounts} ${accounts.map((account) => account.code).join(text.and)}`,
      before: text.active,
      current: accounts.every((account) => account.active) ? text.active : text.inactive,
      status: accounts.every((account) => account.active) ? labels.same : labels.changed,
      changed: !accounts.every((account) => account.active),
    });

  if (invoiceBefore && invoiceNow) {
    const changed = invoiceBefore.outstandingMinor !== invoiceNow.outstandingMinor;
    const allocationChanged = invoiceBefore.allocationVersion !== invoiceNow.allocationVersion;

    rows.push({
      id: "outstanding",
      name: `${labels.invoice} ${invoiceBefore.documentNumber}, ${labels.outstanding}`,
      before: amount(invoiceBefore.outstandingMinor),
      current: amount(invoiceNow.outstandingMinor),
      status: changed ? labels.changed : labels.same,
      changed,
    });
    rows.push({
      id: "allocations",
      name: labels.paymentAllocations,
      before: `${presentation?.allocationCount === undefined ? "" : `${presentation.allocationCount} ${text.count}, `}${amount(invoiceBefore.allocatedMinor)}`,
      current: `${presentation?.currentAllocationCount === undefined ? "" : `${presentation.currentAllocationCount} ${text.count}, `}${amount(invoiceNow.allocatedMinor)}`,
      status: allocationChanged ? labels.changed : labels.same,
      changed: allocationChanged,
    });
  }

  if (impact?.storedBasisDigest && impact.currentDigest)
    rows.push({
      id: "digest",
      name: labels.basisDigest,
      before: displayDigest(impact.storedBasisDigest),
      current: displayDigest(impact.currentDigest),
      status: impact.storedBasisDigest === impact.currentDigest ? labels.same : text.fresh,
      digest: true,
    });

  return rows;
}

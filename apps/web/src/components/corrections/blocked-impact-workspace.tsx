import type { ComponentProps, ReactNode } from "react";
import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Corrections from "@open-erp/contracts/corrections";
import {
  CorrectionBundleWorkspace,
  CorrectionConsequences,
  CorrectionApprovalPanel,
  CorrectionReviewBadge,
} from "@open-erp/ui/components/correction-bundle-review";
import {
  CorrectionImpactAmountTable,
  CorrectionImpactNote,
  CorrectionImpactOptions,
  type CorrectionImpactAmountRow,
} from "@open-erp/ui/components/correction-impact-review";
import { Text } from "@open-erp/ui/components/typography";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";
import { correctionCopy } from "./copy";
import { blockedImpactCopy, type BlockedImpactCopy } from "./blocked-impact-copy";

export type FiledVatCorrectionEvidence = {
  status: "filed";
  impactDigest: string;
  originalVoucherId: string;
  periodId: string;
  returnId: string;
  acknowledgementId: string;
  filedOn: string;
  acknowledgementTime: string;
  boxes: readonly { box: "48" | "49"; filedMinor: string; proposedMinor: string }[];
};

export type ReopeningCorrectionEvidence = {
  status: "awaiting_approval";
  impactDigest: string;
  originalVoucherId: string;
  requesterName: string;
  reviewerName: string;
};

type Basis = typeof Corrections.CorrectionImpactBasis.Type;

type Original = Basis["chain"]["vouchers"][number];

type Props = {
  impact: typeof Corrections.CorrectionImpactView.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  scale?: number;
  breadcrumb: ReactNode;
  actions: ReactNode;
  details: ReactNode;
  filedVat?: FiledVatCorrectionEvidence;
  reopening?: ReopeningCorrectionEvidence;
  headerMetadata?: ReactNode;
  footer?: ReactNode;
};

type Panel = ComponentProps<typeof CorrectionApprovalPanel>;

type PeriodReview = {
  locked: boolean;
  name: string;
  postingMonth: string;
  status: string;
  filedVat?: FiledVatCorrectionEvidence;
  reopening?: ReopeningCorrectionEvidence;
};

export function BlockedImpactWorkspace(props: Props) {
  const basis = props.impact.impact.basis;

  const original = basis.chain.vouchers.find(
    (voucher) => voucher.id === basis.chain.selectedVoucherId,
  );

  if (!original) return <Text role="alert">{correctionCopy(props.locale).impactBlocked}</Text>;

  return <RepresentedImpactWorkspace {...props} original={original} />;
}

function RepresentedImpactWorkspace(props: Props & { original: Original }) {
  const { impact, locale, original } = props;
  const copy = correctionCopy(locale);
  const blockedCopy = blockedImpactCopy(locale);
  const basis = impact.impact.basis;
  const currentBasis = impact.currentBasis ?? basis;
  const period = periodReview(props, original, blockedCopy);

  const facts = period.locked
    ? periodFacts(currentBasis, period, locale, blockedCopy)
    : [
        { label: copy.original, value: original.action.series + original.number },
        { label: copy.date, value: basis.intent.postingDate },
        { label: copy.impactDigest, value: impact.impact.digest, digest: true },
      ];

  return (
    <CorrectionBundleWorkspace
      breadcrumb={props.breadcrumb}
      title={period.locked ? blockedCopy.periodTitle(period.postingMonth) : copy.impact}
      status={
        <>
          <CorrectionReviewBadge variant="warning">{period.status}</CorrectionReviewBadge>
          {props.headerMetadata}
        </>
      }
      description={basis.intent.rationale}
      aside={
        <CorrectionApprovalPanel
          label={period.locked ? blockedCopy.conditionalPeriod(period.name) : copy.impact}
          title={blockedCopy.panelTitle}
          description={period.locked ? undefined : copy.impactStale}
          facts={facts}
          plainFacts={period.locked}
          stepsLabel={blockedCopy.steps}
          steps={period.locked ? periodSteps(period, blockedCopy) : []}
          note={period.locked ? undefined : copy.impactCurrent}
          footer={props.footer}
        >
          {props.actions}
        </CorrectionApprovalPanel>
      }
    >
      {!impact.snapshotCurrent ? <Text role="alert">{copy.impactStale}</Text> : null}
      <CorrectionImpactAmountTable
        title={blockedCopy.differences}
        accountLabel={copy.account}
        columns={[
          blockedCopy.posted(original.action.series + original.number),
          period.filedVat ? blockedCopy.invoiceProposed : blockedCopy.proposed,
          blockedCopy.delta,
        ]}
        rows={impactDifferenceRows(basis, original, props.setup, props.scale, locale)}
      />
      {period.filedVat ? (
        <FiledVatDisclosure
          filedVat={period.filedVat}
          period={period}
          scale={props.scale}
          locale={locale}
          copy={blockedCopy}
        />
      ) : (
        <GenericImpactDisclosure basis={basis} currentBasis={currentBasis} locale={locale} />
      )}
      {props.details}
    </CorrectionBundleWorkspace>
  );
}

function periodReview(props: Props, original: Original, copy: BlockedImpactCopy): PeriodReview {
  const { impact, setup, locale } = props;
  const basis = impact.impact.basis;
  const currentBasis = impact.currentBasis ?? basis;
  const locked = currentBasis.blockers.some((blocker) => blocker.code === "PeriodLocked");

  const candidates = setup.periods.filter(
    (period) =>
      period.locked &&
      (period.id === basis.intent.accountingPeriodId ||
        period.id === original.action.accountingPeriodId),
  );

  const lockedPeriod = candidates.length === 1 ? candidates[0] : undefined;
  const name = lockedPeriod ? monthName(lockedPeriod.startsOn, locale) : copy.periodFallback;
  const evidence = props.filedVat;

  const bindingCurrent =
    locked && impact.snapshotCurrent && lockedPeriod?.id === original.action.accountingPeriodId;

  const filedVat =
    bindingCurrent &&
    evidence?.status === "filed" &&
    evidence.impactDigest === impact.impact.digest &&
    evidence.originalVoucherId === original.id &&
    evidence.periodId === lockedPeriod?.id &&
    validFilingSnapshot(evidence)
      ? evidence
      : undefined;

  const reopening =
    locked &&
    impact.snapshotCurrent &&
    props.reopening?.status === "awaiting_approval" &&
    props.reopening.impactDigest === impact.impact.digest &&
    props.reopening.originalVoucherId === original.id
      ? props.reopening
      : undefined;

  return {
    locked,
    name,
    postingMonth: monthName(basis.intent.postingDate, locale),
    status: locked ? copy.periodStatus(name) : copy.stopped,
    filedVat,
    reopening,
  };
}

function validFilingSnapshot(evidence: FiledVatCorrectionEvidence) {
  return (
    evidence.returnId.length > 0 &&
    evidence.acknowledgementId.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/u.test(evidence.filedOn) &&
    Number.isFinite(Date.parse(evidence.filedOn + "T00:00:00Z")) &&
    /^([01]\d|2[0-3]):[0-5]\d$/u.test(evidence.acknowledgementTime) &&
    evidence.boxes.length > 0 &&
    evidence.boxes.every(
      (box) => /^-?\d+$/u.test(box.filedMinor) && /^-?\d+$/u.test(box.proposedMinor),
    )
  );
}

function periodFacts(
  basis: Basis,
  period: PeriodReview,
  locale: Locale,
  copy: BlockedImpactCopy,
): Panel["facts"] {
  const facts: Array<Panel["facts"][number]> = [
    { label: copy.periodLabel(period.name), value: copy.periodTransition, tone: "changed" },
  ];

  if (basis.resources.some((resource) => resource.kind === "closing"))
    facts.push({ label: copy.closingBasis, value: copy.staleBasis, tone: "changed" });

  if (period.filedVat)
    facts.push(
      { label: copy.vatBasis(period.name), value: copy.staleBasis, tone: "changed" },
      {
        label: copy.filedLabel(shortDate(period.filedVat.filedOn, locale)),
        value: copy.retained,
        tone: "unchanged",
      },
      { label: copy.impactCase, value: copy.futureCase, tone: "changed" },
    );

  if (basis.resources.some((resource) => resource.kind === "report" && !resource.blocks))
    facts.push({ label: copy.reports, value: copy.retainedContent, tone: "unchanged" });

  return facts;
}

function periodSteps(period: PeriodReview, copy: BlockedImpactCopy): Panel["steps"] {
  const steps: Array<Panel["steps"][number]> = period.reopening
    ? [
        {
          title: copy.request(period.reopening.requesterName),
          status: copy.complete,
          tone: "unchanged",
        },
        {
          title: copy.reviewer(period.reopening.reviewerName),
          status: copy.waiting,
          tone: "changed",
        },
      ]
    : [{ title: copy.reopening, status: period.status }];

  steps.push({
    title: copy.newBundle(steps.length + 1),
    status: copy.afterOpening,
  });

  if (period.filedVat)
    steps.push({ title: copy.vatStep(steps.length + 1), status: copy.separateApproval });

  return steps;
}

function FiledVatDisclosure(props: {
  filedVat: FiledVatCorrectionEvidence;
  period: PeriodReview;
  scale?: number;
  locale: Locale;
  copy: BlockedImpactCopy;
}) {
  const { filedVat, period, locale, copy } = props;

  return (
    <>
      <CorrectionImpactAmountTable
        title={copy.vatTitle(
          period.name,
          shortDate(filedVat.filedOn, locale),
          filedVat.acknowledgementTime,
        )}
        accountLabel={copy.vatBox}
        columns={[copy.filed, copy.corrected, copy.delta]}
        rows={filedVatRows(filedVat, props.scale, locale, copy)}
        amountWidth="wide"
      />
      <CorrectionImpactNote>{copy.filedNote}</CorrectionImpactNote>
      <CorrectionImpactOptions
        title={copy.choices}
        selected={{ title: copy.selectedChoice(period.name), detail: copy.selectedDetail }}
        blocked={{ title: copy.blockedChoice(period.postingMonth), detail: copy.blockedDetail }}
      />
    </>
  );
}

function GenericImpactDisclosure(props: { basis: Basis; currentBasis: Basis; locale: Locale }) {
  const copy = correctionCopy(props.locale);
  const blockedCopy = blockedImpactCopy(props.locale);

  return (
    <>
      <CorrectionConsequences
        title={copy.affected}
        rows={props.basis.resources.map((resource) => ({
          id: resource.kind + "/" + resource.id,
          name: resource.id,
          detail: resource.detail,
          status: resource.blocks ? blockedCopy.blocked : blockedCopy.retained,
          tone: resource.blocks ? "blocked" : "unchanged",
        }))}
      />
      {props.currentBasis.blockers.map((blocker, index) => (
        <Text key={blocker.code + "/" + index} role="alert">
          {blocker.message}
        </Text>
      ))}
    </>
  );
}

function monthName(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "sv" ? "sv-SE" : "en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));
}

function shortDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "sv" ? "sv-SE" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(date + "T00:00:00Z"))
    .replace(/\./gu, "");
}

function formatAmount(value: bigint, scale: number | undefined, locale: Locale, signed = true) {
  return scale === undefined
    ? "—"
    : (signed && value > 0n ? "+" : "") +
        formatMinorAmount(value.toString(), scale, locale).replace(/^-/, "−");
}

function lineTotals(lines: readonly (typeof Accounting.JournalLine.Type)[]) {
  const amounts = new Map<string, bigint>();

  for (const line of lines)
    amounts.set(
      line.accountId,
      (amounts.get(line.accountId) ?? 0n) + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    );

  return amounts;
}

function impactDifferenceRows(
  basis: Basis,
  original: Original,
  setup: typeof Accounting.BookSetup.Type,
  scale: number | undefined,
  locale: Locale,
): CorrectionImpactAmountRow[] {
  const before = lineTotals(original.action.lines);
  const after = lineTotals(basis.intent.replacement.lines);

  return [...new Set([...before.keys(), ...after.keys()])].map((id) => {
    const account = setup.accounts.find((item) => item.id === id);
    const posted = before.get(id) ?? 0n;
    const proposed = after.get(id) ?? 0n;
    const delta = proposed - posted;

    return {
      id,
      account: account ? account.code + " " + account.name : id,
      amounts: [
        formatAmount(posted, scale, locale),
        formatAmount(proposed, scale, locale),
        formatAmount(delta, scale, locale),
      ],
      deltaTone: delta === 0n ? "muted" : "changed",
    };
  });
}

function filedVatRows(
  evidence: FiledVatCorrectionEvidence,
  scale: number | undefined,
  locale: Locale,
  copy: BlockedImpactCopy,
): CorrectionImpactAmountRow[] {
  return evidence.boxes.map((box) => {
    const filed = BigInt(box.filedMinor);
    const proposed = BigInt(box.proposedMinor);

    return {
      id: box.box,
      account: box.box === "48" ? copy.inputVat : copy.vatPayable,
      amounts: [
        formatAmount(filed, scale, locale, false),
        formatAmount(proposed, scale, locale, false),
        formatAmount(proposed - filed, scale, locale),
      ],
      emphasized: box.box === "49",
    };
  });
}

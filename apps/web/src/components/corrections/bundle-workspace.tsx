import type { ReactNode } from "react";
import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Corrections from "@open-erp/contracts/corrections";
import {
  CorrectionBundleWorkspace,
  CorrectionReviewBadge,
  CorrectionDigest,
  CorrectionBalanceTable,
  CorrectionConsequences,
  CorrectionApprovalPanel,
  type CorrectionEffectRow,
} from "@open-erp/ui/components/correction-bundle-review";
import { Text } from "@open-erp/ui/components/typography";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";
import { bundleWorkspaceCopy } from "./workspace-copy";
import { correctionCopy } from "./copy";
import { StaleBundleWorkspace } from "./stale-bundle-workspace";
import {
  displayDigest,
  correctionDate,
  correctionTime,
  type CorrectionPresentationEvidence,
} from "./presentation-evidence";

export type BundleReviewState = "reviewing" | "blocked" | "stale" | "committed" | "unavailable";

type Lines = ReadonlyArray<
  Pick<typeof Accounting.JournalLine.Type, "accountId" | "debitMinor" | "creditMinor">
>;

function accountTotals(lines: Lines) {
  const totals = new Map<string, bigint>();

  for (const line of lines)
    totals.set(
      line.accountId,
      (totals.get(line.accountId) ?? 0n) + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    );

  return totals;
}

export function BundleWorkspace(props: {
  bundle: typeof Corrections.CorrectionBundle.Type;
  impact?: typeof Corrections.CorrectionImpactView.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  scale?: number;
  receipt?: typeof Corrections.CorrectionBundleReceipt.Type | null;
  state: BundleReviewState;
  actions: ReactNode;
  details: ReactNode;
  breadcrumb: ReactNode;
  presentation?: CorrectionPresentationEvidence;
  footer?: ReactNode;
}) {
  const { bundle, locale, state } = props;
  const labels = bundleWorkspaceCopy(locale);
  const copy = correctionCopy(locale);
  const original = bundle.originalVoucher;
  const originalNumber = `${original.action.series}${original.number}`;
  const contribution = bundle.registerContribution;

  const invoice =
    contribution?.kind === "invoice_recognition_replacement_v1" ? contribution : undefined;

  const frozen = props.impact?.impact.basis;

  const amount = (value: string) =>
    props.scale === undefined ? "—" : formatMinorAmount(value, props.scale, locale);

  const signed = (value: bigint) =>
    props.scale === undefined ? "—" : `${value > 0n ? "+" : ""}${amount(value.toString())}`;

  const presentation =
    props.presentation?.originalVoucherId === original.id &&
    props.presentation.bundleDigest === bundle.bundleDigest
      ? props.presentation
      : undefined;

  if (state === "stale")
    return (
      <StaleBundleWorkspace
        bundle={bundle}
        impact={props.impact}
        setup={props.setup}
        locale={locale}
        amount={amount}
        presentation={presentation}
        actions={props.actions}
        footer={props.footer}
        details={props.details}
        breadcrumb={props.breadcrumb}
      />
    );

  const rows = bundleBalanceRows(bundle, props.setup, frozen, signed, labels.balanced);

  const effects = bundleConsequences(
    frozen,
    contribution,
    originalNumber,
    amount,
    locale,
    presentation,
    original.action.lines,
  );

  const blocked = state === "blocked";

  const statuses = {
    reviewing: labels.awaitingApproval,
    blocked: labels.blocked,
    stale: labels.outdated,
    committed: labels.posted,
    unavailable: labels.blocked,
  } satisfies Record<BundleReviewState, string>;

  const status = statuses[state];

  const postingDate = bundle.replacement.groups[0]?.actions[0]?.postingDate ?? "";

  const description = invoice
    ? `${invoice.counterpartyName}, ${labels.invoice2} ${invoice.documentNumber}, ${amount(invoice.amountMinor)}. ${bundle.rationale}`
    : bundle.rationale;

  return (
    <CorrectionBundleWorkspace
      breadcrumb={props.breadcrumb}
      title={`${labels.correctionBundleFor} ${originalNumber}`}
      status={
        <>
          <CorrectionReviewBadge
            variant={blocked ? "destructive" : state === "reviewing" ? "warning" : "outline"}
          >
            {status}
          </CorrectionReviewBadge>
          {presentation?.synthetic ? (
            <CorrectionReviewBadge variant="outline" example>
              {locale === "sv" ? "Exempeldata" : "Example data"}
            </CorrectionReviewBadge>
          ) : null}
        </>
      }
      description={description}
      aside={<BundleApprovalAside {...props} presentation={presentation} status={status} />}
    >
      {blocked ? <Text role="alert">{copy.impactBlocked}</Text> : null}
      <>
        <CorrectionBalanceTable
          title={labels.bundleVouchersDebitsPositiveAndCredits}
          accountLabel={copy.account}
          columns={[
            `${originalNumber} original`,
            presentation?.reversalLabel
              ? `${presentation.reversalLabel} ${labels.reversal.toLocaleLowerCase(locale)}`
              : labels.reversal,
            presentation?.replacementLabel
              ? `${presentation.replacementLabel} ${copy.replacement.toLocaleLowerCase(locale)}`
              : copy.replacement,
            labels.netBalance,
          ]}
          rows={rows}
          datesLabel={labels.dateAndState}
          dates={[
            `${formatCorrectionDate(original.action.postingDate, locale)}, ${labels.retained}`,
            formatCorrectionDate(postingDate, locale),
            formatCorrectionDate(postingDate, locale),
          ]}
          explanation={netExplanation(bundle, props.setup, amount, locale)}
        />
        <CorrectionConsequences title={labels.effectsInOtherRegisters} rows={effects} />
        {frozen?.blockers.map((blocker, index) => (
          <Text key={`${blocker.code}/${index}`} role="alert">
            {blocker.message}
          </Text>
        ))}
      </>
      {props.details}
    </CorrectionBundleWorkspace>
  );
}

function BundleApprovalAside(props: Parameters<typeof BundleWorkspace>[0] & { status: string }) {
  const { bundle, locale, receipt, presentation } = props;
  const labels = bundleWorkspaceCopy(locale);
  const blocked = props.state === "blocked";
  const status = props.status;

  const postingDate = bundle.replacement.groups[0]?.actions[0]?.postingDate ?? "";

  const period = props.setup.periods.find(
    (item) => item.id === bundle.replacement.groups[0]?.actions[0]?.accountingPeriodId,
  );

  return (
    <CorrectionApprovalPanel
      label={labels.whatYouApprove}
      title={blocked ? labels.whatChangesAndWhatIsRetained : labels.oneBundleWithThreeVouchers}
      description={labels.reversalAndReplacementCannotBeApproved}
      facts={[
        { label: labels.bundle, value: presentation?.bundleLabel ?? bundle.id },
        {
          label: labels.digest,
          value: (
            <CorrectionDigest value={bundle.bundleDigest}>
              {displayDigest(bundle.bundleDigest)}
            </CorrectionDigest>
          ),
          digest: true,
        },
        {
          label: labels.postingDate,
          value: period
            ? `${new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${postingDate}T12:00:00Z`)).replace(/^./, (letter) => letter.toLocaleUpperCase(locale))}${period.locked ? labels.lockedPeriod : labels.openPeriod}`
            : postingDate,
        },
        { label: labels.reason, value: presentation?.reason ?? bundle.rationale },
      ]}
      stepsLabel={labels.steps}
      steps={[
        {
          title: `${labels.step1Prepared}${presentation?.preparerName ? ` ${locale === "sv" ? "av" : "by"} ${presentation.preparerName}` : ""}`,
          status: `${locale === "sv" ? "Klar" : "Ready"} ${correctionTime(bundle.createdAt, locale)}`,
          tone: "unchanged",
        },
        {
          title: `${labels.step2Approval}${presentation?.approverName ? `, ${presentation.approverName}` : ""}`,
          status: presentation?.approverName
            ? locale === "sv"
              ? "Väntar på dig"
              : "Awaiting you"
            : status,
          tone: "changed",
        },
        {
          title:
            presentation?.reversalLabel && presentation.replacementLabel
              ? locale === "sv"
                ? `3. ${presentation.reversalLabel} och ${presentation.replacementLabel} bokförs i ett steg`
                : `3. ${presentation.reversalLabel} and ${presentation.replacementLabel} post together`
              : labels.step3ReversalAndReplacementPostTogether,
          status: receipt ? labels.posted : labels.afterApproval,
        },
        {
          title: labels.step4OneReceiptForTheComplete,
          status: receipt ? receipt.id : labels.shownHere,
        },
      ]}
      note={
        presentation?.vatPeriod && locale === "sv"
          ? `Misslyckas något bokförs ingenting, varken backning eller ersättning. ${presentation.vatPeriod.replace(/^./, (letter) => letter.toLocaleUpperCase(locale))} öppnas inte och ${bundle.originalVoucher.action.series}${bundle.originalVoucher.number} ändras inte.`
          : labels.ifEitherPostingFailsNeitherReversal
      }
      footer={props.footer}
    >
      {props.actions}
    </CorrectionApprovalPanel>
  );
}

function netExplanation(
  bundle: typeof Corrections.CorrectionBundle.Type,
  setup: typeof Accounting.BookSetup.Type,
  amount: (value: string) => string,
  locale: Locale,
) {
  const invoice = bundle.registerContribution;
  const fallback = bundleWorkspaceCopy(locale).netBalanceIncludesTheOriginalReversal;

  if (
    invoice?.kind !== "invoice_recognition_replacement_v1" ||
    invoice.beforeExpense.length !== 1 ||
    invoice.afterExpense.length !== 1
  )
    return fallback;

  const before = invoice.beforeExpense[0];
  const after = invoice.afterExpense[0];
  const beforeAccount = setup.accounts.find((account) => account.id === before?.accountId);
  const afterAccount = setup.accounts.find((account) => account.id === after?.accountId);

  if (!before || !after || !beforeAccount || !afterAccount) return fallback;

  const minor = BigInt(before.debitMinor) - BigInt(before.creditMinor);

  if (minor !== BigInt(after.debitMinor) - BigInt(after.creditMinor)) return fallback;

  return locale === "sv"
    ? `Nettot är en flytt av ${amount(minor.toString())} från ${beforeAccount.code} till ${afterAccount.code}. Moms och skuld är oförändrade.`
    : `The net transfers ${amount(minor.toString())} from ${beforeAccount.code} to ${afterAccount.code}. VAT and payable remain unchanged.`;
}

function bundleBalanceRows(
  bundle: typeof Corrections.CorrectionBundle.Type,
  setup: typeof Accounting.BookSetup.Type,
  frozen: typeof Corrections.CorrectionImpactBasis.Type | undefined,
  signed: (value: bigint) => string,
  balanceLabel: string,
) {
  const originals = accountTotals(bundle.originalVoucher.action.lines);

  const reversals = accountTotals(
    bundle.reversal.groups.flatMap((group) => group.actions.flatMap((action) => action.lines)),
  );

  const replacements = accountTotals(
    bundle.replacement.groups.flatMap((group) => group.actions.flatMap((action) => action.lines)),
  );

  const accountIds = [
    ...new Set([
      ...(frozen?.netChange
        .filter((entry) => entry.deltaMinor !== "0")
        .map((entry) => entry.accountId) ?? []),
      ...originals.keys(),
      ...reversals.keys(),
      ...replacements.keys(),
    ]),
  ];

  const rows = accountIds.map<Parameters<typeof CorrectionBalanceTable>[0]["rows"][number]>(
    (id) => {
      const account = setup.accounts.find((item) => item.id === id);
      const before = originals.get(id) ?? 0n;
      const inverse = reversals.get(id) ?? 0n;
      const after = replacements.get(id) ?? 0n;

      return {
        id,
        account: account ? `${account.code} ${account.name}` : id,
        mutedAmounts: [true, inverse === 0n, after === 0n, false],
        amounts: [
          signed(before),
          signed(inverse),
          signed(after),
          signed(before + inverse + after),
        ] as const,
      };
    },
  );

  const totals = [originals, reversals, replacements].map((entries) =>
    [...entries.values()].reduce((sum, value) => sum + value, 0n),
  );

  rows.push({
    id: "balance",
    account: balanceLabel,
    mutedAmounts: [false, false, false, false],
    amounts: [
      signed(totals[0] ?? 0n),
      signed(totals[1] ?? 0n),
      signed(totals[2] ?? 0n),
      signed(totals.reduce((sum, value) => sum + value, 0n)),
    ],
  });

  return rows;
}

function bundleConsequences(
  frozen: typeof Corrections.CorrectionImpactBasis.Type | undefined,
  contribution: typeof Corrections.RegisterContribution.Type | undefined,
  originalNumber: string,
  amount: (value: string) => string,
  locale: Locale,
  presentation: CorrectionPresentationEvidence | undefined,
  originalLines: Lines,
) {
  const labels = bundleWorkspaceCopy(locale);
  const sv = locale === "sv";

  const effects: CorrectionEffectRow[] = [];

  const invoice =
    contribution?.kind === "invoice_recognition_replacement_v1" ? contribution : undefined;

  if (contribution?.kind === "schedule_occurrence_replacement_v1") {
    effects.push({
      id: "schedule",
      name: contribution.scheduleName,
      detail: `${contribution.ordinal}, ${amount(contribution.amountMinor)}. ${contribution.remainingPlanDecision.rationale}`,
      status: labels.linkChanges,
      tone: "changed",
    });
  }

  if (invoice) {
    effects.push({
      id: "invoice",
      name: `${labels.supplierInvoice} ${invoice.documentNumber}`,
      detail: sv
        ? `Bokföringslänken flyttas från ${originalNumber} till ${presentation?.replacementLabel ?? "ersättningen"}. Innehåll, belopp och förfallodag ändras inte.`
        : `The posting link moves from ${originalNumber} to the replacement. Content and amount stay unchanged.`,
      status: labels.linkChanges,
      tone: "changed",
    });
    effects.push({
      id: "allocations",
      name: labels.paymentAllocation,
      detail: sv
        ? `Fördelningen ${amount(invoice.allocatedMinor)}${presentation?.allocationDate ? ` från ${correctionDate(presentation.allocationDate, locale)}` : ""} ligger kvar. Saldot räknas om från fördelningarna: ${amount(invoice.outstandingMinor)} före och efter.`
        : `Allocated ${amount(invoice.allocatedMinor)} is retained. Outstanding: ${amount(invoice.outstandingMinor)} before and after.`,
      status: labels.unchanged,
      tone: "unchanged",
    });
  }

  if (invoice && frozen && !frozen.resources.some((resource) => resource.kind === "schedule")) {
    effects.push({
      id: "plans",
      name: labels.assetAndDeferralPlans,
      detail: sv
        ? `Ingen plan hänger på ${originalNumber}.`
        : `No registered plan is linked to ${originalNumber}.`,
      status: labels.unrelated,
      tone: "unrelated",
    });
  }

  if (invoice) {
    effects.push({
      id: "vat",
      name: labels.vat,
      detail: preservedVatDetail(presentation, originalLines, amount, locale),
      status: labels.unchanged,
      tone: "unchanged",
    });
  }

  for (const resource of frozen?.resources ?? []) {
    if (
      contribution?.kind === "schedule_occurrence_replacement_v1" &&
      resource.kind === "schedule" &&
      resource.id === contribution.scheduleId
    )
      continue;

    if (invoice && (resource.kind === "invoice" || resource.kind === "payment_allocation"))
      continue;

    const names = {
      bank_match: labels.bankMatching,
      tax_account_match: labels.taxAccountMatching,
      bank_allocation: labels.paymentAllocation,
      invoice: labels.invoice,
      payment_allocation: labels.paymentAllocation,
      schedule: labels.assetAndDeferralPlans,
      report: labels.reports,
      closing: labels.closingBasis,
      owner_record: labels.affectedRecord,
      vat_control_reclassification: labels.vat,
    };

    effects.push({
      id: `${resource.kind}/${resource.id}`,
      name: names[resource.kind],
      detail: resource.detail,
      ...resourceEffectState(resource, frozen, labels, locale),
    });
  }

  const order = new Map([
    ["invoice", 0],
    ["allocations", 1],
    ["payment_allocation", 1],
    ["bank_match", 2],
    ["plans", 3],
    ["schedule", 3],
    ["vat", 4],
    ["vat_control_reclassification", 4],
    ["report", 5],
  ]);

  const rank = (effect: CorrectionEffectRow) =>
    order.get(effect.id.split("/")[0] ?? "") ?? order.size;

  return effects.sort((left, right) => rank(left) - rank(right));
}

function preservedVatDetail(
  presentation: CorrectionPresentationEvidence | undefined,
  originalLines: Lines,
  amount: (value: string) => string,
  locale: Locale,
) {
  const vatMinor = originalLines
    .filter((line) => line.accountId === presentation?.vatAccountId)
    .reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);

  if (
    presentation?.vatPeriod &&
    presentation.vatAccountId &&
    originalLines.some((line) => line.accountId === presentation.vatAccountId)
  )
    return locale === "sv"
      ? `Momsunderlag ${presentation.vatPeriod} oförändrat, ingående moms ${amount(vatMinor.toString())} ligger kvar i ${presentation.vatPeriod}. Ingen ny deklaration.`
      : `The VAT basis for ${presentation.vatPeriod} is retained with ${amount(vatMinor.toString())}. No new return.`;

  return locale === "sv"
    ? "Momsunderlaget bevaras oförändrat. Ingen ny deklaration."
    : "The VAT basis is retained unchanged. No new return.";
}

function resourceEffectState(
  resource: typeof Corrections.CorrectionImpactResource.Type,
  frozen: typeof Corrections.CorrectionImpactBasis.Type | undefined,
  labels: ReturnType<typeof bundleWorkspaceCopy>,
  locale: Locale,
): Pick<CorrectionEffectRow, "tone" | "status"> {
  if (resource.blocks) return { status: labels.blocked, tone: "blocked" };

  if (resource.kind === "bank_match") return { status: labels.unchanged, tone: "unchanged" };

  if (resource.kind === "report" && frozen?.netChange.some((entry) => entry.deltaMinor !== "0"))
    return {
      status: `${locale === "sv" ? "Ändras i" : "Changes in"} ${new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${frozen.intent.postingDate}T12:00:00Z`)).replace(/\.$/, "")}`,
      tone: "changed",
    };

  return { status: labels.affected, tone: "unchanged" };
}

function formatCorrectionDate(date: string, locale: Locale) {
  if (!date) return "";

  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/\.$/, "");
}

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import { RegisterDetailLines } from "@open-erp/ui/components/register-workspace";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { ReviewPanes, OriginalViewerSurface } from "@open-erp/ui/kanon/layouts";
import {
  DetailPanelSurface,
  DetailPanelHeader,
  DetailPanelActions,
  PanelSection,
} from "@open-erp/ui/kanon/detail-panel";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { accountingCopy } from "@/lib/accounting-copy";
import { formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";

export function ReviewEntry(props: {
  book: typeof Accounting.Book.Type;
  action: typeof Accounting.VoucherPostingAction.Type;
  locale: Locale;
  accounts: typeof Accounting.BookSetup.Type.accounts;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const { book, action, locale, accounts } = props;
  const copy = accountingCopy(locale);
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = metadata.data?.currencyScale;
  const total = action.lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n);

  return (
    <ReviewPanes
      original={
        <OriginalViewerSurface label={copy.workspace_source_step}>
          <Heading>{copy.workspace_source_step}</Heading>
          {action.evidenceRefs.map((reference) => (
            <EvidenceInspector
              expanded
              key={`${reference.evidenceId}/${reference.locator}`}
              book={book}
              reference={reference}
              locale={locale}
            />
          ))}
        </OriginalViewerSurface>
      }
      decision={
        <DetailPanelSurface
          as="section"
          label={`${locale === "sv" ? "Beslut" : "Decision"}: ${action.description}`}
        >
          <DetailPanelHeader
            subtitle={action.description}
            subtitleAs="h2"
            kicker={`${action.postingDate}, ${copy.journal_series} ${action.series}`}
            figure={
              scale === undefined
                ? "—"
                : `${formatMinorAmount(total.toString(), scale, locale)} ${action.currency}`
            }
          />
          <PanelSection label={locale === "sv" ? "Bokförs" : "Posting"}>
            <RegisterDetailLines
              hideHeading
              title={locale === "sv" ? "Bokförs" : "Posting"}
              rowSize="review"
              lines={action.lines.flatMap((line) => {
                const account = accounts.find((item) => item.id === line.accountId);
                const description = account ? `${account.code} ${account.name}` : line.description;
                const amounts = [];

                if (BigInt(line.debitMinor) > 0n)
                  amounts.push({ side: "debit", value: line.debitMinor });

                if (BigInt(line.creditMinor) > 0n)
                  amounts.push({ side: "credit", value: `-${line.creditMinor}` });

                if (!amounts.length) amounts.push({ side: "zero", value: "0" });

                return amounts.map((amount) => ({
                  id: `${line.lineId}:${amount.side}`,
                  description,
                  amount:
                    scale === undefined ? "—" : formatMinorAmount(amount.value, scale, locale),
                }));
              })}
            />
          </PanelSection>
          {metadata.isError ? (
            <Text role="alert">{copy.workspace_currency_unavailable}</Text>
          ) : null}
          <Text tone="muted">{copy.workspace_review_effect}</Text>
          <Disclosure title={copy.workspace_reference_details}>
            <Text>{action.rationale}</Text>
            {action.lines.map((line) => (
              <Text key={line.lineId}>{line.description}</Text>
            ))}
            <Text tone="muted">
              {action.eventId}, {action.occurrenceKey}, {action.fiscalYearId},{" "}
              {action.accountingPeriodId}
            </Text>
            <Text tone="muted">
              {action.postingPurpose}, {action.taxAssessment}
            </Text>
            {action.correctsVoucherId ? (
              <Text>
                {copy.journal_voucher}: {action.correctsVoucherId}
              </Text>
            ) : null}
          </Disclosure>
          {props.children}
          {props.footer ? <DetailPanelActions primary={props.footer} /> : null}
        </DetailPanelSurface>
      }
    />
  );
}

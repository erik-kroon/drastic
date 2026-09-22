import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { Disclosure, ReviewColumns } from "@open-erp/ui/components/workflow";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { accountingCopy } from "@/lib/accounting-copy";
import { formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";

export function ReviewEntry({
  book,
  action,
  locale,
  accounts,
}: {
  book: typeof Accounting.Book.Type;
  action: typeof Accounting.PostingAction.Type;
  locale: Locale;
  accounts: typeof Accounting.BookSetup.Type.accounts;
}) {
  const copy = accountingCopy(locale);
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = metadata.data?.currencyScale;
  const total = action.lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n);
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box display="flex" flexWrap="wrap" justifyContent="between" alignItems="start" gap="md">
        <Box display="grid" gap="sm">
          <Heading>{action.description}</Heading>
          <Text tone="muted">
            {action.postingDate} · {copy.journal_series} {action.series}
          </Text>
        </Box>
        {scale !== undefined ? (
          <Text tone="metric">
            {formatMinorAmount(total.toString(), scale, locale)} {action.currency}
          </Text>
        ) : null}
      </Box>
      <ReviewColumns
        evidence={
          <>
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
          </>
        }
      >
        <Heading>{copy.journal_prepare}</Heading>
        <Text>{action.rationale}</Text>
        <DataTable
          title={copy.journal_prepare}
          narrow="stack"
          columns={[
            { id: "account", label: copy.journal_account },
            {
              id: "debit",
              label: scale === undefined ? copy.journal_debit : copy.workspace_debit,
              numeric: true,
            },
            {
              id: "credit",
              label: scale === undefined ? copy.journal_credit : copy.workspace_credit,
              numeric: true,
            },
          ]}
          rows={action.lines.map((line) => {
            const account = accounts.find((item) => item.id === line.accountId);
            return {
              id: line.lineId,
              cells: [
                <Box display="grid" gap="sm">
                  <Text>{account ? `${account.code} · ${account.name}` : line.accountId}</Text>
                  <Text tone="muted">{line.description}</Text>
                </Box>,
                scale === undefined
                  ? line.debitMinor
                  : formatMinorAmount(line.debitMinor, scale, locale),
                scale === undefined
                  ? line.creditMinor
                  : formatMinorAmount(line.creditMinor, scale, locale),
              ],
            };
          })}
        />
        {metadata.isError ? <Text role="alert">{copy.workspace_currency_unavailable}</Text> : null}
        <Text tone="muted">{copy.workspace_review_effect}</Text>
        <Disclosure title={copy.workspace_reference_details}>
          <Text tone="muted">
            {action.eventId} · {action.occurrenceKey} · {action.fiscalYearId} ·{" "}
            {action.accountingPeriodId}
          </Text>
          <Text tone="muted">
            {action.postingPurpose} · {action.taxAssessment}
          </Text>
          {action.correctsVoucherId ? (
            <Text>
              {copy.journal_voucher}: {action.correctsVoucherId}
            </Text>
          ) : null}
        </Disclosure>
      </ReviewColumns>
    </Box>
  );
}

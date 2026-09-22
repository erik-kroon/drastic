import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { SealedAction } from "@/components/journal-review";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { correctionCopy } from "./copy";

export function CorrectionImpactDetails({
  book,
  impact,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  impact: typeof Corrections.CorrectionImpact.Type;
  locale: Locale;
}) {
  const copy = correctionCopy(locale);
  const basis = impact.basis;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.impact}</Heading>
      <Text>
        {copy.impactId}: {impact.id}
      </Text>
      <Text>
        {copy.impactDigest}: {impact.digest}
      </Text>
      <Text>
        {impact.createdAt} · {impact.createdBy}
      </Text>
      <Text>
        {copy.date}: {basis.intent.postingDate} · {basis.intent.accountingPeriodId}
      </Text>
      <Text>
        {copy.rationale}: {basis.intent.rationale}
      </Text>
      <Text>{basis.intent.replacement.description}</Text>
      <DataTable
        title={copy.replacement}
        narrow="stack"
        columns={[
          { id: "account", label: copy.account },
          { id: "debit", label: copy.debit, numeric: true },
          { id: "credit", label: copy.credit, numeric: true },
          { id: "description", label: copy.description },
        ]}
        rows={basis.intent.replacement.lines.map((line, index) => ({
          id: String(index),
          cells: [line.accountId, line.debitMinor, line.creditMinor, line.description],
        }))}
      />
      <DataTable
        title={copy.netChange}
        narrow="stack"
        columns={[
          { id: "account", label: copy.account },
          { id: "delta", label: copy.delta, numeric: true },
        ]}
        rows={basis.netChange.map((change) => ({
          id: change.accountId,
          cells: [change.accountId, change.deltaMinor],
        }))}
      />
      {basis.blockers.length > 0 ? <Text role="alert">{copy.impactBlocked}</Text> : null}
      {basis.blockers.map((blocker, index) => (
        <Text key={`${blocker.code}/${index}`} role="alert">
          {blocker.code}: {blocker.message}
        </Text>
      ))}
      <Heading>{copy.affected}</Heading>
      {basis.resources.map((resource, index) => (
        <Box key={`${resource.kind}/${resource.id}/${index}`} display="grid" gap="sm">
          <Text>
            {resource.kind} · {resource.id}
          </Text>
          <Text>{resource.detail}</Text>
          {resource.dependencyDigest ? (
            <Text>
              {copy.affectedDigest}: {resource.dependencyDigest}
            </Text>
          ) : null}
          <a href={`${bookPath(book)}${resource.path}`} target="_blank" rel="noreferrer">
            {copy.inspectResource}: {resource.id}
          </a>
        </Box>
      ))}
      {basis.limitations.map((limitation) => (
        <Text key={limitation} tone="muted">
          {limitation}
        </Text>
      ))}
    </Box>
  );
}

export function CorrectionChainView({
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
  const chain = useQuery({
    queryKey: [...bookKey(book), "correction-chain", id],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/vouchers/${encodeURIComponent(id)}/correction-chain`,
        Corrections.CorrectionChain,
        { signal },
      ),
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.chain}</Heading>
      <Text>{copy.chainHelp}</Text>
      <AccountingStatus locale={locale} pending={chain.isPending} error={chain.error} />
      {chain.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            onClick={() => {
              void chain.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
      ) : null}
      {chain.data ? (
        <>
          <Text>
            {copy.originalId}: {chain.data.rootVoucherId} · {chain.data.sequence}
          </Text>
          <DataTable
            title={copy.chainBalances}
            narrow="stack"
            columns={[
              { id: "account", label: copy.account },
              { id: "debit", label: copy.debit, numeric: true },
              { id: "credit", label: copy.credit, numeric: true },
              { id: "balance", label: copy.delta, numeric: true },
            ]}
            rows={chain.data.balances.map((balance) => ({
              id: balance.accountId,
              cells: [
                balance.accountId,
                balance.debitMinor,
                balance.creditMinor,
                balance.balanceMinor,
              ],
            }))}
          />
          {chain.data.vouchers.map((voucher) => (
            <details key={voucher.id}>
              <summary>
                {voucher.action.postingPurpose} · {voucher.number} · {voucher.action.postingDate} ·{" "}
                {voucher.id}
              </summary>
              <Box paddingBlock="lg">
                <SealedAction
                  book={book}
                  action={voucher.action}
                  locale={locale}
                  setupAccounts={setup.accounts}
                />
              </Box>
            </details>
          ))}
          {chain.data.receipts.map((receipt) => (
            <Box key={receipt.id} display="grid" gap="sm">
              <Text>
                {copy.receipt}: {receipt.id}
              </Text>
              <a
                href={`${bookPath(book)}/correction-bundles/${receipt.bundleId}`}
                target="_blank"
                rel="noreferrer"
              >
                {receipt.bundleId}
              </a>
              <Text>
                {copy.original}: {receipt.originalVoucherId}
              </Text>
              <Text>
                {copy.reversal}: {receipt.reversal.voucherId}
              </Text>
              <Text>
                {copy.replacement}: {receipt.replacement.voucherId}
              </Text>
            </Box>
          ))}
        </>
      ) : null}
    </Box>
  );
}

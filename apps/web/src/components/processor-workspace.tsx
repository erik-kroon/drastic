import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Processor from "@open-erp/contracts/processor-clearing";
import * as Accounting from "@open-erp/contracts/accounting";
import { Button } from "@open-erp/ui/components/button";
import {
  RetainedActionLayout,
  AssetActionSection,
  AssetActionNote,
  AssetActionMetadata,
  AssetActionError,
  AssetActionActions,
} from "@open-erp/ui/components/asset-action";
import {
  ProcessorFacts,
  ProcessorJournal,
  ProcessorRowAction,
} from "@open-erp/ui/components/processor-review";
import { Box } from "@open-erp/ui/components/box";
import { AccountingStatus } from "./accounting-status";
import { checkScope, CommandForm } from "./commerce/shared";
import { ProcessorDirectory } from "./processor-directory";
import { loanDate, loanCoverageLabel } from "./treasury-loan-format";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";

type View = typeof Processor.PayoutReviewView.Type;

export function ProcessorWorkspace(props: { accountId?: string; reviewId?: string }) {
  const { book, locale } = useBookWorkspace();
  const back = `${workspacePath(book)}/accounts?view=processors`;

  const query = useQuery({
    queryKey: [...bookKey(book), "processor-payout", props.accountId, props.reviewId],
    enabled: !!props.accountId && !!props.reviewId,
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${bookPath(book)}/banking/processors/reviews/${encodeURIComponent(props.reviewId ?? "")}/payout`,
        Processor.PayoutReviewView,
        { signal },
      );

      checkScope(book, view.review.scope);
      checkScope(book, view.account.scope);
      checkScope(book, view.postedPayout.review.scope);

      if (
        view.review.id !== props.reviewId ||
        view.account.id !== props.accountId ||
        view.review.input.accountId !== view.account.id
      )
        throw new Error("Processor payout identity mismatch");

      if (!view.postedPayout.execution.voucherId) throw new Error("Missing posted payout voucher");

      const first = await readAccounting(
        `${bookPath(book)}/vouchers/${encodeURIComponent(view.postedPayout.execution.voucherId)}`,
        Accounting.Voucher,
        { signal },
      );

      const second = view.execution?.voucherId
        ? await readAccounting(
            `${bookPath(book)}/vouchers/${encodeURIComponent(view.execution.voucherId)}`,
            Accounting.Voucher,
            { signal },
          )
        : null;

      if (
        first.id !== view.postedPayout.execution.voucherId ||
        (second && second.id !== view.execution?.voucherId)
      )
        throw new Error("Processor voucher identity mismatch");

      return { view, first, second };
    },
  });

  const saved = query.isError ? undefined : query.data;

  const money = (minor: string) =>
    formatMinorAmount(minor, saved?.view.account.currencyScale ?? 2, locale);

  const payoutDate = saved ? loanDate(saved.view.payout.occurredOn, locale) : "";

  return (
    <RetainedActionLayout
      title={
        saved
          ? `Utbetalning ${money((-BigInt(saved.view.payout.netMinor)).toString())}, koppla till bankraden`
          : "Betalförmedlare"
      }
      trail={[
        { label: "Bank", href: `${workspacePath(book)}/accounts` },
        { label: "Betalförmedlare", href: back },
        ...(saved ? [{ label: `Utbetalning ${payoutDate}` }] : []),
      ]}
      waiting={!!saved && !saved.view.execution && !saved.view.returned}
      posted={!!saved?.view.execution}
    >
      {!props.reviewId ? (
        <ProcessorDirectory key={props.accountId ?? "accounts"} accountId={props.accountId} />
      ) : (
        <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      )}
      {query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Försök igen
        </Button>
      ) : null}
      {saved ? (
        <ProcessorPayout
          key={saved.view.review.id}
          {...saved}
          onRefresh={() => void query.refetch()}
        />
      ) : null}
    </RetainedActionLayout>
  );
}

function ProcessorPayout(props: {
  view: View;
  first: typeof Accounting.Voucher.Type;
  second: typeof Accounting.Voucher.Type | null;
  onRefresh: () => void;
}) {
  const { book, locale, setup } = useBookWorkspace();
  const { view } = props;
  const [candidates, setCandidates] = useState(false);
  const money = (minor: string) => formatMinorAmount(minor, view.book.scale, locale);

  const native = (minor: string) => formatMinorAmount(minor, view.account.currencyScale, locale);

  const label = (id: string) => {
    const account = setup.accounts.find((item) => item.id === id);

    return account
      ? id === view.account.processorControlAccountId || id === view.account.payoutTransitAccountId
        ? account.name
        : `${account.code} ${account.name}`
      : id;
  };

  const rows = (lines: readonly { accountId: string; debitMinor: string; creditMinor: string }[]) =>
    lines.map((line, index) => ({
      id: String(index),
      label: label(line.accountId),
      debit: line.debitMinor === "0" ? "" : money(line.debitMinor),
      credit: line.creditMinor === "0" ? "" : money(line.creditMinor),
    }));

  const prepared = new Date(view.review.createdAt);

  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  }).format(prepared);

  const reviewBase = `${bookPath(book)}/banking/processors/reviews/${encodeURIComponent(view.review.id)}`;

  const approval = view.approvals
    .filter((item) => item.digest === view.review.digest && Date.parse(item.expiresAt) > Date.now())
    .at(-1);

  const canMatch =
    view.bankAvailable &&
    !view.returned &&
    !view.execution &&
    BigInt(view.payoutNativeMinor) === BigInt(view.bank.amountMinor);

  const projectedProcessor = [
    ...view.members.flatMap((member) => member.review.journal),
    ...view.postedPayout.review.journal,
  ]
    .filter((line) => line.accountId === view.account.processorControlAccountId)
    .reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);

  const projectedTransit =
    BigInt(view.payoutCarryingMinor) +
    (view.execution
      ? 0n
      : view.review.journal
          .filter((line) => line.accountId === view.account.payoutTransitAccountId)
          .reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n));

  return (
    <>
      <AssetActionMetadata>
        Förberedd av {view.preparerName ?? view.review.actorId}{" "}
        {loanDate(prepared.toISOString().slice(0, 10), locale)} {time}.
        {book.profile === "synthetic-core-v1" ? " Exempel." : ""}
      </AssetActionMetadata>
      <AssetActionSection>FRÅN FÖRMEDLAREN</AssetActionSection>
      <ProcessorFacts
        rows={[
          {
            label: "Utbetalning",
            value: `${loanDate(view.payout.occurredOn, locale)}, ${native((-BigInt(view.payout.netMinor)).toString())} ${view.account.currency}, betald av förmedlaren`,
          },
          {
            label: "Täcker",
            value: view.members
              .map(
                (member) =>
                  `Kundbetalning ${loanDate(member.observation.occurredOn, locale)}, netto ${native(member.observation.netMinor)}${member.invoiceDocumentNumber ? `, ${member.invoiceDocumentNumber}` : ""}`,
              )
              .join("; "),
          },
        ]}
      />
      <AssetActionSection>BANKRADEN</AssetActionSection>
      <ProcessorFacts
        rows={[
          {
            label: "Bankhändelse",
            value: `${loanDate(view.bank.observedOn, locale)}, +${native(view.bank.amountMinor)} ${view.account.currency}, konto ${setup.accounts.find((item) => item.id === view.bank.accountId)?.code ?? view.bank.accountId}, ${view.bank.description}`,
            action: !view.execution ? (
              <ProcessorRowAction
                href="#bankrader"
                onClick={(event) => {
                  event.preventDefault();
                  setCandidates(!candidates);
                }}
              >
                Byt bankrad
              </ProcessorRowAction>
            ) : undefined,
          },
          {
            label: "Därför föreslås raden",
            value: view.execution
              ? "Matchningen är bokförd."
              : view.bankAvailable
                ? "Beloppet stämmer exakt och raden är inte kopplad till något annat."
                : "Raden är inte längre tillgänglig för matchningen.",
          },
        ]}
      />
      {candidates ? <ProcessorBankCandidates view={view} /> : null}
      <AssetActionSection>VERIFIKATFÖRSLAG, TVÅ STEG</AssetActionSection>
      <ProcessorJournal
        groups={[
          {
            id: "payout",
            label: (
              <span title={`Bokfört i verifikat ${props.first.action.series}${props.first.number}`}>
                1 Utbetalningen lämnar förmedlaren
              </span>
            ),
            rows: rows(props.first.action.lines),
          },
          {
            id: "receipt",
            label: "2 Banken tar emot",
            rows: rows(props.second?.action.lines ?? view.review.journal),
          },
        ]}
      />
      <AssetActionNote>
        Efter matchningen är fordran på förmedlaren{" "}
        {view.members.length === 1 && view.members[0]?.invoiceDocumentNumber
          ? `för ${view.members[0].invoiceDocumentNumber} `
          : ""}
        {money(projectedProcessor.toString())} och utbetalningen på väg{" "}
        {money(projectedTransit.toString())}. Varje utbetalning måste gå ihop var för sig innan
        avstämningen av perioden{" "}
        {loanCoverageLabel(
          view.members.at(0)?.observation.occurredOn ?? view.payout.occurredOn,
          view.bank.observedOn,
          locale,
        )}{" "}
        kan slutföras.
      </AssetActionNote>
      {view.returned ? (
        <AssetActionError>
          Förslaget har skickats tillbaka. Ett nytt förslag behöver godkännas innan matchningen kan
          bokföras.
        </AssetActionError>
      ) : null}
      {view.execution ? (
        <AssetActionNote status>
          Bokfört i verifikat {props.second?.action.series}
          {props.second?.number}. Utbetalningen på väg är {money(view.payoutCarryingMinor)}.
        </AssetActionNote>
      ) : (
        <AssetActionActions>
          <CommandForm
            book={book}
            locale={locale}
            path={`${reviewBase}/approvals`}
            schema={Processor.Approve}
            output={Processor.Approval}
            input={() => ({ version: 1, digest: view.review.digest })}
            label="Godkänn matchningen"
            compact
            allowed={book.role === "operator"}
            canSubmit={canMatch}
            onSuccess={props.onRefresh}
          />
          <CommandForm
            book={book}
            locale={locale}
            path={`${reviewBase}/returns`}
            schema={Processor.ReturnReview}
            output={Processor.ReviewReturn}
            input={() => ({ version: 1, digest: view.review.digest })}
            label="Skicka tillbaka"
            variant="outline"
            compact
            allowed={book.role === "operator"}
            canSubmit={!view.returned}
            onSuccess={props.onRefresh}
          />
          {approval && !view.returned ? (
            <CommandForm
              book={book}
              locale={locale}
              path={`${reviewBase}/execute`}
              schema={Processor.Execute}
              output={Processor.Execution}
              input={() => ({ version: 1, digest: view.review.digest, approvalId: approval.id })}
              label="Bokför matchningen"
              compact
              canSubmit={canMatch}
              onSuccess={props.onRefresh}
            />
          ) : null}
        </AssetActionActions>
      )}
      <AssetActionNote>
        Godkännandet görs av en annan person än den som förberedde, i webbläsaren, och gäller i en
        timme. Kommer utbetalningen inte till banken backas steg 1 först när det går att visa att
        den inte betalades ut. Till dess är utfallet okänt, inte noll.
      </AssetActionNote>
    </>
  );
}

function ProcessorBankCandidates({ view }: { view: View }) {
  const { book, locale } = useBookWorkspace();
  const [after, setAfter] = useState<typeof Processor.BankObservation.Type>();
  const [selected, setSelected] = useState<typeof Processor.ReceiptBankRow.Type>();

  const query = useQuery({
    queryKey: [...bookKey(book), "processor-bank-candidates", view.review.id, after],
    retry: false,
    queryFn: async ({ signal }) => {
      const cursor = after
        ? `?afterStatementId=${encodeURIComponent(after.statementId)}&afterRowOrdinal=${after.rowOrdinal}`
        : "";

      const page = await readAccounting(
        `${bookPath(book)}/banking/processors/reviews/${encodeURIComponent(view.review.id)}/bank-candidates${cursor}`,
        Processor.BankCandidatePage,
        { signal },
      );

      checkScope(book, page.scope);

      if (page.reviewId !== view.review.id)
        throw new Error("Processor bank candidate identity mismatch");

      return page;
    },
  });

  return (
    <Box display="grid" gap="md" id="bankrader">
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {!query.isError
        ? query.data?.items.map((item) => (
            <Button
              key={`${item.row.statementId}:${item.row.rowOrdinal}`}
              variant="outline"
              disabled={!item.available}
              onClick={() => setSelected(item.row)}
            >
              {loanDate(item.row.observedOn, locale)},{" "}
              {formatMinorAmount(item.row.amountMinor, view.account.currencyScale, locale)}{" "}
              {view.account.currency}, {item.row.description}
            </Button>
          ))
        : null}
      {!query.isError && query.data?.next ? (
        <Button
          variant="outline"
          onClick={() => {
            setAfter(query.data?.next ?? undefined);
            setSelected(undefined);
          }}
        >
          Visa fler
        </Button>
      ) : null}
      {selected && !query.isError ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${bookPath(book)}/banking/processors/reviews`}
          schema={Processor.Prepare}
          output={Processor.Review}
          input={() => ({
            ...view.review.input,
            kind: "bank_receipt",
            bankObservation: { statementId: selected.statementId, rowOrdinal: selected.rowOrdinal },
            date: selected.observedOn,
          })}
          label="Förbered med bankraden"
          compact
          onSuccess={(result) => {
            window.location.assign(
              `${workspacePath(book)}/accounts?view=processors&account=${encodeURIComponent(view.account.id)}&record=${encodeURIComponent(result.id)}`,
            );
          }}
        />
      ) : null}
    </Box>
  );
}

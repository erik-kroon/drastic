import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Cash from "@open-erp/contracts/foreign-cash";
import * as Accounting from "@open-erp/contracts/accounting";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  RetainedActionLayout,
  AssetActionSection,
  AssetActionNote,
  AssetActionError,
  AssetActionActions,
  AssetPostedJournal,
} from "@open-erp/ui/components/asset-action";
import {
  ForeignCashBankRows,
  ForeignCashFields,
  ForeignCashAmount,
  ForeignCashFeeEvidence,
  ForeignCashSourceNote,
  ForeignCashCalculationFact,
} from "@open-erp/ui/components/foreign-cash";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { AccountingStatus } from "./accounting-status";
import { EvidenceInspector } from "./evidence-inspector";
import { checkScope, CommandForm } from "./commerce/shared";
import { ForeignCashDirectory } from "./foreign-cash-directory";
import { loanDate, loanDecimal } from "./treasury-loan-format";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { decimalToMinor, formatMinorAmount } from "@/lib/workspace-api";

export function ForeignCashWorkspace(props: {
  accountId?: string;
  reviewId?: string;
  approval?: boolean;
}) {
  const { book, locale, setup } = useBookWorkspace();

  const account = setup.accounts.find((item) => item.id === props.accountId);

  const back = `${workspacePath(book)}/accounts?view=foreign-cash`;

  const query = useQuery({
    queryKey: [...bookKey(book), "foreign-cash-exchange", props.accountId, props.reviewId],
    enabled: !!props.reviewId && !!props.accountId,
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${bookPath(book)}/banking/foreign-cash/reviews/${encodeURIComponent(props.reviewId ?? "")}/exchange`,
        Cash.ExchangeView,
        { signal },
      );

      checkScope(book, view.review.scope);

      if (
        view.review.id !== props.reviewId ||
        view.review.input.accountId !== props.accountId ||
        view.review.input.kind !== "exchange"
      )
        throw new Error("Foreign cash exchange identity mismatch");

      const evidence = await readAccounting(
        `${bookPath(book)}/evidence/${encodeURIComponent(view.basis.feeEvidence.id)}`,
        Accounting.EvidenceContent,
        { signal },
      );

      if (
        evidence.id !== view.basis.feeEvidence.id ||
        evidence.sha256 !== view.basis.feeEvidence.sha256
      )
        throw new Error("Foreign cash fee evidence mismatch");

      const voucher = view.execution?.voucherId
        ? await readAccounting(
            `${bookPath(book)}/vouchers/${encodeURIComponent(view.execution.voucherId)}`,
            Accounting.Voucher,
            { signal },
          )
        : null;

      if (
        view.execution &&
        (view.execution.reviewId !== view.review.id ||
          view.execution.digest !== view.review.digest ||
          (voucher && voucher.id !== view.execution.voucherId))
      )
        throw new Error("Foreign cash execution identity mismatch");

      return { view, evidence, voucher };
    },
  });

  const saved = query.isError ? undefined : query.data;

  const currency = saved?.view.basis.holding.nativeCurrency;

  const label = account ? `${account.name} ${account.code}` : "Valutakonton";

  const title =
    saved?.view.review.input.kind === "exchange"
      ? `Växla ${formatMinorAmount(saved.view.review.input.nativeMinor, saved.view.basis.holding.nativeScale, locale)} ${currency} till ${book.currency}`
      : label;

  return (
    <RetainedActionLayout
      title={title}
      trail={[
        { label: "Bank", href: `${workspacePath(book)}/accounts` },
        {
          label,
          href: props.accountId ? `${back}&account=${encodeURIComponent(props.accountId)}` : back,
        },
        ...(props.reviewId ? [{ label: `Växla till ${book.currency}` }] : []),
      ]}
      draft={!!saved && !saved.view.execution}
      posted={!!saved?.view.execution}
      synthetic={book.profile === "synthetic-core-v1"}
    >
      {!props.reviewId ? (
        <ForeignCashDirectory key={props.accountId ?? "accounts"} accountId={props.accountId} />
      ) : (
        <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      )}
      {query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Försök igen
        </Button>
      ) : null}
      {saved ? (
        <ForeignCashExchange
          key={saved.view.review.id}
          {...saved}
          approval={props.approval}
          back={`${back}&account=${encodeURIComponent(props.accountId ?? "")}`}
          onRefresh={() => void query.refetch()}
        />
      ) : null}
    </RetainedActionLayout>
  );
}

function ForeignCashExchange(props: {
  view: typeof Cash.ExchangeView.Type;
  evidence: typeof Accounting.EvidenceContent.Type;
  voucher: typeof Accounting.Voucher.Type | null;
  approval?: boolean;
  back: string;
  onRefresh: () => void;
}) {
  const { book, locale, setup } = useBookWorkspace();

  const { view, evidence, voucher } = props;

  const input = view.review.input;

  const money = (minor: string) => formatMinorAmount(minor, view.basis.book.scale, locale);

  const native = (minor: string) =>
    formatMinorAmount(minor, view.basis.holding.nativeScale, locale);

  const [gross, setGross] = useState(money(view.grossMinor));

  const [fee, setFee] = useState(money(view.basis.feeEvidence.feeMinor));

  const [openEvidence, setOpenEvidence] = useState(false);

  const group = new Intl.NumberFormat(locale)
    .formatToParts(1000)
    .find((part) => part.type === "group")?.value;

  const confirmation = (value: string) =>
    decimalToMinor(value.replaceAll(group ?? "", "").replaceAll(/\s/g, ""), view.basis.book.scale);

  const matches =
    gross.trim() !== "" &&
    fee.trim() !== "" &&
    confirmation(gross) === view.grossMinor &&
    confirmation(fee) === view.basis.feeEvidence.feeMinor;

  const accountCode = (id: string) => setup.accounts.find((item) => item.id === id)?.code ?? id;

  if (input.kind !== "exchange") return null;

  const fraction =
    BigInt(view.basis.holding.nativeMinor) === BigInt(input.nativeMinor) * 3n
      ? "en tredjedel"
      : `${native(input.nativeMinor)} av ${native(view.basis.holding.nativeMinor)} ${view.basis.holding.nativeCurrency}`;

  const average = loanDecimal(
    BigInt(view.basis.holding.carryingMinor) * 10n ** BigInt(view.basis.holding.nativeScale),
    BigInt(view.basis.holding.nativeMinor) * 10n ** BigInt(view.basis.book.scale),
    2,
    locale,
  );

  const rate = loanDecimal(
    BigInt(view.grossMinor) * 10n ** BigInt(view.basis.holding.nativeScale),
    BigInt(input.nativeMinor) * 10n ** BigInt(view.basis.book.scale),
    3,
    locale,
  );

  const lines = voucher?.action.lines ?? view.review.journal;

  const debit = lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n).toString();

  const credit = lines.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n).toString();

  return (
    <>
      <AssetActionSection>BANKRADERNA</AssetActionSection>
      <ForeignCashBankRows
        rows={[
          {
            label: `Euro ut från ${view.basis.holding.nativeCurrency}-kontot`,
            value: `${loanDate(view.basis.nativeObservation.observedOn, locale)}, −${native(input.nativeMinor)} ${view.basis.holding.nativeCurrency}, konto ${accountCode(input.accountId)}`,
          },
          {
            label: "Kronor in på bankkontot",
            value: `${loanDate(view.basis.bookObservation.observedOn, locale)}, +${money(view.basis.bookObservation.amountMinor)} ${book.currency}, konto ${accountCode(input.receiverAccountId)}`,
          },
          { label: "Antal euro", value: "Från bankraden. Det kan inte ändras här." },
        ]}
      />
      <AssetActionSection>DU ANGER</AssetActionSection>
      <ForeignCashFields>
        <ForeignCashAmount
          label={`Mottaget före avgift, ${book.currency}`}
          value={gross}
          onChange={setGross}
          focus
          disabled={!!view.execution}
        />
        <ForeignCashAmount
          label={`Växlingsavgift, ${book.currency}`}
          value={fee}
          onChange={setFee}
          disabled={!!view.execution}
        />
        <ForeignCashFeeEvidence title={evidence.title} onOpen={() => setOpenEvidence(true)} />
      </ForeignCashFields>
      {matches ? (
        <ForeignCashSourceNote>
          Mottaget {money(view.grossMinor)} minus avgift {money(view.basis.feeEvidence.feeMinor)} är{" "}
          {money(view.basis.bookObservation.amountMinor)} och stämmer med bankraden.
        </ForeignCashSourceNote>
      ) : (
        <AssetActionError>
          Beloppen stämmer inte med bankraden och avgiftsunderlaget. Förbered ett nytt förslag med
          rätt underlag.
        </AssetActionError>
      )}
      {matches ? (
        <>
          <AssetActionSection>VAD SOM RÄKNAS UT</AssetActionSection>
          <ForeignCashCalculationFact
            first
            label={`Bokfört värde som lämnar kontot, ${loanDecimal(BigInt(input.nativeMinor), 10n ** BigInt(view.basis.holding.nativeScale), 0, locale)} av ${loanDecimal(BigInt(view.basis.holding.nativeMinor), 10n ** BigInt(view.basis.holding.nativeScale), 0, locale)} ${view.basis.holding.nativeCurrency}, ${fraction} av ${money(view.basis.holding.carryingMinor)}`}
            value={money(view.releasedMinor)}
          />
          <ForeignCashCalculationFact
            label={`Mottaget i ${book.currency} före avgift, kurs ${rate} mot genomsnittskurs ${average}`}
            value={money(view.grossMinor)}
          />
          <ForeignCashCalculationFact
            label={BigInt(view.gainMinor) >= 0n ? "Realiserad kursvinst" : "Realiserad kursförlust"}
            value={money(view.gainMinor)}
            emphasis
          />
          <AssetActionSection>
            {voucher ? `VERIFIKAT ${voucher.action.series}${voucher.number}` : "VERIFIKATFÖRSLAG"}
          </AssetActionSection>
          <AssetPostedJournal
            compact
            rows={lines.map((line, index) => {
              const account = setup.accounts.find((item) => item.id === line.accountId);

              return {
                id: String(index),
                label: account ? `${account.code} ${account.name}` : line.accountId,
                debit: line.debitMinor === "0" ? "" : money(line.debitMinor),
                credit: line.creditMinor === "0" ? "" : money(line.creditMinor),
              };
            })}
            debit={money(debit)}
            credit={money(credit)}
          />
        </>
      ) : null}
      {view.execution ? (
        <AssetActionNote status>
          Bokfört. Kontot har {native(view.currentHolding.nativeMinor)}{" "}
          {view.currentHolding.nativeCurrency} med bokfört värde{" "}
          {money(view.currentHolding.carryingMinor)}.
        </AssetActionNote>
      ) : props.approval ? (
        <ForeignCashApproval view={view} canSubmit={matches} onRefresh={props.onRefresh} />
      ) : (
        <AssetActionActions>
          <Button
            disabled={!matches}
            render={
              <Link
                href={`${props.back}&record=${encodeURIComponent(view.review.id)}&cashApproval=true`}
              />
            }
            nativeButton={false}
          >
            Skicka för godkännande
          </Button>
          <Button variant="outline" render={<Link href={props.back} />} nativeButton={false}>
            Avbryt
          </Button>
        </AssetActionActions>
      )}
      <AssetActionNote>
        Efter godkännandet har kontot {native(view.remainingNativeMinor)}{" "}
        {view.basis.holding.nativeCurrency} med bokfört värde {money(view.remainingCarryingMinor)}.
        Avgiften ingår inte i vinsten. Växling till en annan utländsk valuta än {book.currency}{" "}
        stöds inte och ett överdrag av kontot går inte att förbereda.
      </AssetActionNote>
      {openEvidence ? (
        <RecordSheet
          title={evidence.title}
          closeLabel="Stäng"
          onClose={() => setOpenEvidence(false)}
        >
          <EvidenceInspector
            book={book}
            locale={locale}
            reference={{
              evidenceId: evidence.id,
              sha256: evidence.sha256,
              locator: evidence.title,
            }}
            expanded
          />
        </RecordSheet>
      ) : null}
    </>
  );
}

function ForeignCashApproval(props: {
  view: typeof Cash.ExchangeView.Type;
  canSubmit: boolean;
  onRefresh: () => void;
}) {
  const { book, locale } = useBookWorkspace();

  const { review } = props.view;

  const approval = props.view.approvals
    .filter((item) => item.digest === review.digest && Date.parse(item.expiresAt) > Date.now())
    .at(-1);

  const base = `${bookPath(book)}/banking/foreign-cash/reviews/${encodeURIComponent(review.id)}`;

  return (
    <AssetActionActions>
      <CommandForm
        book={book}
        locale={locale}
        path={`${base}/approvals`}
        schema={Cash.Approve}
        output={Cash.Approval}
        input={() => ({ version: 1, digest: review.digest })}
        label="Godkänn"
        compact
        allowed={book.role === "operator"}
        canSubmit={props.canSubmit}
        onSuccess={props.onRefresh}
        validate={(result) => {
          if (result.reviewId !== review.id || result.digest !== review.digest)
            throw new Error("Foreign cash approval identity mismatch");
        }}
      />
      <CommandForm
        book={book}
        locale={locale}
        path={`${base}/execute`}
        schema={Cash.Execute}
        output={Cash.Execution}
        input={() => ({ version: 1, digest: review.digest, approvalId: approval?.id })}
        label="Bokför"
        compact
        canSubmit={props.canSubmit && !!approval}
        onSuccess={props.onRefresh}
        validate={(result) => {
          if (result.reviewId !== review.id || result.digest !== review.digest)
            throw new Error("Foreign cash execution identity mismatch");
        }}
      />
    </AssetActionActions>
  );
}

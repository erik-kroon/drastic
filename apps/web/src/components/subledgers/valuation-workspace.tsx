import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { DataTable } from "@open-erp/ui/components/data-table";
import {
  AssetActionLayout,
  AssetActionMetadata,
  AssetActionMetrics,
  AssetActionSection,
  AssetActionFacts,
  AssetFact,
  AssetActionNote,
  AssetActionActions,
  AssetPostedJournal,
} from "@open-erp/ui/components/asset-action";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";

export function AssetValuationWorkspace(props: {
  scheduleId?: string;
  reviewId?: string;
  plan?: boolean;
}) {
  const { book, locale } = useBookWorkspace();

  const { scheduleId, reviewId } = props;

  const query = useQuery({
    queryKey: [...bookKey(book), "asset-valuation", scheduleId, reviewId],
    enabled: !!scheduleId && !!reviewId,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!scheduleId || !reviewId) throw new Error("Asset and valuation review are required");

      const view = await readAccounting(
        `${bookPath(book)}/subledger-controls/valuations/${encodeURIComponent(reviewId)}`,
        Controls.AssetValuationView,
        { signal },
      );

      checkScope(book, view.review.scope);

      if (
        view.review.id !== reviewId ||
        view.review.input.scheduleId !== scheduleId ||
        view.review.input.kind !== "economic_reversal"
      )
        throw new Error("Valuation identity mismatch");

      if (
        view.event &&
        (view.event.reviewId !== reviewId ||
          view.event.scheduleId !== scheduleId ||
          view.event.direction !== "decrease" ||
          view.event.scheduleRevision !== view.review.proposedRevision.revision ||
          view.event.scheduleDigest !== view.review.proposedRevision.digest)
      )
        throw new Error("Posted valuation lineage mismatch");

      const voucher = view.event
        ? await readAccounting(
            `${bookPath(book)}/vouchers/${encodeURIComponent(view.event.postingReceipt.voucherId)}`,
            Accounting.Voucher,
            { signal },
          )
        : null;

      if (voucher) {
        if (voucher.id !== view.event?.postingReceipt.voucherId)
          throw new Error("Valuation voucher identity mismatch");
      }

      return { view, voucher };
    },
  });

  const saved = query.isError ? undefined : query.data;

  const review = saved?.view.review;

  const event = saved?.view.event;

  const posted = !!event && !!saved?.voucher;

  const assetName = review?.basis.schedule.terms.name ?? "";

  const backHref = `${workspacePath(book)}/books?view=assets${scheduleId ? `&record=${encodeURIComponent(scheduleId)}` : ""}`;

  return (
    <AssetActionLayout
      title={
        props.plan
          ? `Ny avskrivningsplan, ${assetName}`
          : posted
            ? `Nedskrivning återförd, ${assetName}`
            : "Återföring av nedskrivning"
      }
      assetName={assetName}
      backHref={backHref}
      synthetic={book.profile === "synthetic-core-v1"}
      posted={posted && !props.plan}
    >
      <AccountingStatus
        locale={locale}
        pending={query.isPending && query.fetchStatus !== "idle"}
        error={query.error}
      />
      {query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Försök igen
        </Button>
      ) : null}
      {saved && review ? (
        props.plan ? (
          <>
            <AssetActionSection>NY AVSKRIVNINGSPLAN</AssetActionSection>
            <DataTable
              title="Behållen plan efter återföringen"
              columns={[
                { id: "date", label: "Datum" },
                { id: "amount", label: "Belopp", numeric: true },
              ]}
              rows={review.proposedRevision.occurrences.map((occurrence) => ({
                id: occurrence.eventKey,
                cells: [
                  occurrence.postingDate,
                  formatMinorAmount(occurrence.amountMinor, 2, locale),
                ],
              }))}
            />
            <AssetActionNote>
              Varje månad i den nya planen föreslås som ett eget verifikat och bokförs inte
              automatiskt.
            </AssetActionNote>
            <AssetActionActions>
              <Link
                href={`${backHref}&assetAction=reversal&assetReview=${encodeURIComponent(review.id)}`}
              >
                Tillbaka till återföringen
              </Link>
            </AssetActionActions>
          </>
        ) : event && saved.voucher ? (
          <AssetValuationPosted view={saved.view} voucher={saved.voucher} backHref={backHref} />
        ) : (
          <AssetActionNote status>Förslag, ej bokfört</AssetActionNote>
        )
      ) : null}
    </AssetActionLayout>
  );
}

function AssetValuationPosted(props: {
  view: typeof Controls.AssetValuationView.Type;
  voucher: typeof Accounting.Voucher.Type;
  backHref: string;
}) {
  const { locale, book, setup } = useBookWorkspace();

  const { view, voucher } = props;

  const event = view.event;

  if (!event) return null;

  const review = view.review;

  const approval = view.approvals.find((value) => value.id === event.approvalId);

  const person = (id: string) =>
    view.participants.find((value) => value.actorId === id)?.name ?? id;

  const amount = (value: string) => formatMinorAmount(value, 2, locale);

  const date = (value: string, year = false) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: year ? "numeric" : undefined,
      timeZone: "Europe/Stockholm",
    }).format(new Date(`${value}T12:00:00Z`));

  const voucherLabel = `${voucher.action.series}${voucher.number}`;

  const ordinary = (
    BigInt(review.basis.carryingBasis.input.accumulatedMinor) + BigInt(review.basis.recognizedMinor)
  ).toString();

  const debit = voucher.action.lines
    .reduce((sum, line) => sum + BigInt(line.debitMinor), 0n)
    .toString();

  const credit = voucher.action.lines
    .reduce((sum, line) => sum + BigInt(line.creditMinor), 0n)
    .toString();

  return (
    <>
      <AssetActionMetadata>
        Verifikat {voucherLabel}, bokfört {date(event.postingDate, true)}. Förberett av{" "}
        {person(review.receipt.actorId)}, godkänt av {approval ? person(approval.actorId) : "okänd"}{" "}
        {approval
          ? new Intl.DateTimeFormat(locale, {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Stockholm",
            }).format(new Date(approval.createdAt))
          : ""}
        .
      </AssetActionMetadata>
      <AssetActionMetrics
        items={[
          { label: "Nytt bokfört värde", value: amount(event.carryingMinor) },
          { label: "Återfört", value: amount(event.magnitudeMinor) },
          { label: "Nedskrivning som återstår", value: amount(event.netImpairmentMinor) },
          { label: "Taket", value: amount(review.basis.counterfactualCarryingMinor), muted: true },
        ]}
      />
      <AssetActionSection afterAlert>VERIFIKAT {voucherLabel}</AssetActionSection>
      <AssetPostedJournal
        rows={voucher.action.lines.map((line) => {
          const account = setup.accounts.find((value) => value.id === line.accountId);

          return {
            id: line.lineId,
            label: account ? `${account.code} ${account.name}` : line.accountId,
            debit: line.debitMinor === "0" ? "" : amount(line.debitMinor),
            credit: line.creditMinor === "0" ? "" : amount(line.creditMinor),
          };
        })}
        debit={amount(debit)}
        credit={amount(credit)}
      />
      <AssetActionSection afterAlert>TILLGÅNGEN EFTER BOKFÖRINGEN</AssetActionSection>
      <AssetActionFacts>
        <AssetFact
          label="Anskaffningsvärde"
          value={amount(review.basis.carryingBasis.input.originalCostMinor)}
        />
        <AssetFact label="Ackumulerade avskrivningar" value={`−${amount(ordinary)}`} />
        <AssetFact
          label="Ackumulerade nedskrivningar"
          value={`−${amount(event.netImpairmentMinor)}`}
        />
        <AssetFact label="Bokfört värde" value={amount(event.carryingMinor)} emphasis />
        <AssetFact
          label={`Ny avskrivningsplan för ${amount(event.carryingMinor)}, gäller från ${date(event.postingDate)}`}
          value={
            <Link
              href={`${props.backHref}&assetAction=reversal&assetReview=${encodeURIComponent(review.id)}&assetPlan=true`}
            >
              Visa planen
            </Link>
          }
        />
      </AssetActionFacts>
      <AssetActionNote>
        Taket {amount(review.basis.counterfactualCarryingMinor)} är oförändrat. Varje månad i den
        nya planen föreslås som ett eget verifikat och bokförs inte automatiskt. Skatteeffekten
        bedöms inte här.
      </AssetActionNote>
      <AssetActionActions>
        <Button
          variant="outline"
          render={
            <Link
              href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(voucher.id)}`}
            />
          }
          nativeButton={false}
        >
          Visa verifikat {voucherLabel}
        </Button>
        <Button variant="outline" render={<Link href={props.backHref} />} nativeButton={false}>
          Tillbaka till tillgångar
        </Button>
      </AssetActionActions>
    </>
  );
}

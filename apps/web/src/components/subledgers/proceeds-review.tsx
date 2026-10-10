import { bookScope } from "@/lib/contract-client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Disposals from "@open-erp/contracts/asset-disposals";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Link } from "@open-erp/ui/components/link";
import { Button } from "@open-erp/ui/components/button";
import { Box } from "@open-erp/ui/components/box";
import { AccountingStatus } from "@/components/accounting-status";
import { CommandForm, checkScope } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";
import {
  AssetActionSection,
  AssetActionNote,
  AssetActionError,
  AssetActionFacts,
  AssetActionActions,
  AssetFact,
  AssetRevenueAcknowledgment,
} from "@open-erp/ui/components/asset-action";
import { DisposalSourceSelection } from "./disposal-source-selection";

export function AssetDisposalReview(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  schedule: typeof Subledgers.ScheduleView.Type;
  view: typeof Disposals.View.Type;
  backHref: string;
  onRefresh: () => void;
  onPrepared: (id: string) => void;
}) {
  const { book, view, schedule, locale } = props;

  const review = view.review;

  const issueId =
    review.proceeds.kind === "existing_legal_invoice" ? review.proceeds.issue.id : undefined;

  const [accepted, setAccepted] = useState(false);

  const [approved, setApproved] = useState<typeof Disposals.Approval.Type>();

  const source = useQuery({
    queryKey: [...bookKey(book), "asset-disposals", "invoice-source", issueId],
    enabled: !!issueId && !view.effect,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!issueId) throw new Error("Invoice source is required");

      const value = await readAccounting(
        (client) =>
          client.assetDisposals.getAssetDisposalInvoiceSource({
            params: { ...bookScope(book), id: issueId },
          }),
        Disposals.InvoiceSource,
        { signal },
      );

      checkScope(book, value.scope);
      checkScope(book, value.issue.scope);

      if (value.issue.id !== issueId) throw new Error("Disposal source identity mismatch");

      return value;
    },
  });

  const invoiceLineId =
    review.proceeds.kind === "existing_legal_invoice" ? review.proceeds.lineId : undefined;

  const occupied =
    source.data &&
    review.proceeds.kind === "existing_legal_invoice" &&
    source.data.claims.some((claim) => claim.lineId === invoiceLineId);

  const format = (minor: string) =>
    formatMinorAmount(minor, schedule.current.currencyScale, locale);

  const approval = currentApproval(view, approved);

  const available = sourceAvailable(schedule, review, source.isError, issueId, source.data);

  const base = `${bookPath(book)}/asset-disposals/${encodeURIComponent(review.id)}`;

  if (!view.effect && issueId && (source.isPending || source.isError))
    return (
      <>
        <AccountingStatus locale={locale} pending={source.isPending} error={source.error} />
        {source.isError ? (
          <Button variant="outline" onClick={() => void source.refetch()}>
            Försök igen
          </Button>
        ) : null}
      </>
    );

  if (occupied && source.data && !view.effect)
    return (
      <DisposalSourceSelection
        key={`${review.id}:${source.data.claims.map((claim) => claim.effectId).join(":")}`}
        book={book}
        review={review}
        schedule={schedule}
        source={source.data}
        backHref={props.backHref}
        bankHref={`${workspacePath(book)}/accounts?view=bank`}
        onPrepared={props.onPrepared}
      />
    );

  return (
    <>
      {view.effect ? (
        <AssetActionNote status>
          Avyttring bokförd {review.input.series}
          {view.effect.postingReceipt.voucherNumber}
        </AssetActionNote>
      ) : (
        <AssetActionNote>Förslag, ej bokfört</AssetActionNote>
      )}
      {!view.effect && !available ? (
        <AssetActionError>Förslaget är inte längre aktuellt.</AssetActionError>
      ) : null}
      <AssetActionSection>HÄMTAT FRÅN BOKFÖRINGEN OCH FAKTURAN</AssetActionSection>
      <AssetActionFacts>
        <AssetFact label="Anskaffningsvärde" value={format(review.assetBasis.originalCostMinor)} />
        <AssetFact
          label="Ackumulerade avskrivningar"
          value={`−${format(review.assetBasis.totalAccumulatedMinor)}`}
        />
        <AssetFact
          label="Nedskrivningar"
          value={format(review.assetBasis.impairmentMinor ?? "0")}
        />
        <AssetFact
          label="Bokfört restvärde"
          value={format(review.assetBasis.carryingMinor)}
          emphasis
        />
        <AssetFact label="Försäljning enligt faktura" value={format(review.proceeds.netMinor)} />
        <AssetFact
          label={
            BigInt(review.domainPlan.profitMinor) < 0n
              ? "Förlust vid avyttring, beräknad"
              : "Vinst vid avyttring, beräknad"
          }
          value={format(review.domainPlan.profitMinor)}
          emphasis
        />
      </AssetActionFacts>
      <AssetActionSection>VERIFIKATFÖRSLAG</AssetActionSection>
      <DataTable
        title="Verifikatförslag"
        narrow="stack"
        columns={[
          { id: "account", label: "Konto" },
          { id: "debit", label: "Debet", numeric: true },
          { id: "credit", label: "Kredit", numeric: true },
        ]}
        rows={review.domainPlan.journal.map((line, index) => ({
          id: `${index}`,
          cells: [
            props.setup.accounts.find((account) => account.id === line.accountId)?.name ??
              line.accountId,
            line.debitMinor === "0" ? "" : format(line.debitMinor),
            line.creditMinor === "0" ? "" : format(line.creditMinor),
          ],
        }))}
      />
      {view.effect ? (
        <AssetActionActions>
          <Link
            href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(view.effect.postingReceipt.voucherId)}`}
          >
            Visa verifikatet
          </Link>
          <Link href={props.backHref}>Visa planen</Link>
        </AssetActionActions>
      ) : (
        <>
          <AssetRevenueAcknowledgment checked={accepted} onChecked={setAccepted} />
          <AssetActionActions>
            {!approval ? (
              <CommandForm
                book={book}
                locale={locale}
                path={`${base}/approve`}
                schema={Disposals.Approve}
                output={Disposals.Approval}
                label="Godkänn"
                compact
                canSubmit={available && accepted && book.role === "operator"}
                input={() => ({
                  version: 1,
                  digest: review.digest,
                  acknowledgeSyntheticOnly: true,
                })}
                validate={(value) => {
                  if (value.reviewId !== review.id || value.digest !== review.digest)
                    throw new Error("Disposal approval identity mismatch");
                }}
                onSuccess={(value) => {
                  setApproved(value);
                  props.onRefresh();
                }}
              />
            ) : (
              <CommandForm
                book={book}
                locale={locale}
                path={`${base}/execute`}
                schema={Disposals.Execute}
                output={Disposals.DisposalEffect}
                label="Bokför"
                compact
                canSubmit={available && accepted && book.role === "operator"}
                input={() => ({
                  version: 1,
                  digest: review.digest,
                  approvalId: approval.id,
                  acknowledgeSyntheticOnly: true,
                })}
                validate={(value) => {
                  if (value.reviewId !== review.id || value.approvalId !== approval.id)
                    throw new Error("Disposal execution identity mismatch");
                }}
                onSuccess={props.onRefresh}
              />
            )}
            <Link href={props.backHref}>Avbryt</Link>
          </AssetActionActions>
        </>
      )}
      <AssetActionNote>
        Restvärde och försäljningspris hämtas från bokförda avskrivningar och fakturan. Du kan inte
        skriva in dem. Godkännande görs av en person i webbläsaren, inte av en assistent. Efter
        bokföringen stoppas planerade avskrivningar.
      </AssetActionNote>
      <Box>
        <Button variant="ghost" onClick={props.onRefresh}>
          Uppdatera
        </Button>
      </Box>
    </>
  );
}

function currentApproval(
  view: typeof Disposals.View.Type,
  approved: typeof Disposals.Approval.Type | undefined,
) {
  const valid = (approval: typeof Disposals.Approval.Type) =>
    approval.digest === view.review.digest && Date.parse(approval.expiresAt) > Date.now();

  if (approved && valid(approved)) return approved;

  return [...view.approvals]
    .filter(valid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function sourceAvailable(
  schedule: typeof Subledgers.ScheduleView.Type,
  review: typeof Disposals.Review.Type,
  failed: boolean,
  issueId: string | undefined,
  source: typeof Disposals.InvoiceSource.Type | undefined,
) {
  const unchanged =
    schedule.current.digest === review.assetBasis.schedule.digest &&
    review.input.kind === "disposal" &&
    schedule.postingBasis?.basisDigest === review.input.expectedBasisDigest &&
    !schedule.disposal;

  return !failed && (!issueId || (!!source && !source.blocked)) && unchanged;
}

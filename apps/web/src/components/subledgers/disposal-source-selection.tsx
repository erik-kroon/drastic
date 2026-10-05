import { useState } from "react";
import * as Disposals from "@open-erp/contracts/asset-disposals";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Accounting from "@open-erp/contracts/accounting";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { CommandForm } from "@/components/commerce/shared";
import { bookPath } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import {
  AssetActionSection,
  AssetActionNote,
  AssetActionError,
  AssetActionFacts,
  AssetActionActions,
  AssetFact,
  AssetInvoiceSourceTable,
} from "@open-erp/ui/components/asset-action";

export function DisposalSourceSelection(props: {
  book: typeof Accounting.Book.Type;
  review: typeof Disposals.Review.Type;
  schedule: typeof Subledgers.ScheduleView.Type;
  source: typeof Disposals.InvoiceSource.Type;
  backHref: string;
  bankHref: string;
  onPrepared: (id: string) => void;
}) {
  const { book, review, source, schedule } = props;

  const [selected, setSelected] = useState(
    () =>
      source.issue.lines.find((line) => !source.claims.some((claim) => claim.lineId === line.id))
        ?.id ?? "",
  );

  const line = source.issue.lines.find((candidate) => candidate.id === selected);

  const ordinal = source.issue.lines.findIndex((candidate) => candidate.id === selected) + 1;

  const occupied = source.claims.find(
    (claim) =>
      review.proceeds.kind === "existing_legal_invoice" && claim.lineId === review.proceeds.lineId,
  );

  const occupiedOrdinal = occupied
    ? source.issue.lines.findIndex((candidate) => candidate.id === occupied.lineId) + 1
    : 0;

  const current =
    schedule.current.digest === review.assetBasis.schedule.digest &&
    review.input.kind === "disposal" &&
    schedule.postingBasis?.basisDigest === review.input.expectedBasisDigest &&
    !schedule.disposal;

  const available =
    !!line &&
    !source.blocked &&
    current &&
    !source.claims.some((claim) => claim.lineId === selected);

  const format = (minor: string) => formatMinorAmount(minor, schedule.current.currencyScale, "sv");

  const profit = line
    ? (BigInt(line.netMinor) - BigInt(review.assetBasis.carryingMinor)).toString()
    : null;

  const accumulatedThrough = review.assetBasis.occurrences
    .filter((occurrence) => occurrence.state === "posted")
    .map((occurrence) => occurrence.postingDate)
    .concat(review.assetBasis.carryingBasis.input.effectiveOn)
    .sort()
    .at(-1);

  const accumulationDate = accumulatedThrough
    ? new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", timeZone: "UTC" })
        .format(new Date(`${accumulatedThrough}T00:00:00Z`))
        .replace(/\.$/, "")
    : null;

  return (
    <>
      {occupied ? (
        <AssetActionError>
          Fakturaraden {source.issue.legalDocumentNumber}, rad {occupiedOrdinal} används redan som
          försäljningspris i verifikat {occupied.series}
          {occupied.postingReceipt.voucherNumber}, Avyttring {occupied.assetName}. En fakturarad kan
          bara ligga till grund för en avyttring. Ingenting bokfördes och{" "}
          {schedule.current.terms.name} är oförändrad.
        </AssetActionError>
      ) : null}
      {!current || source.blocked ? (
        <AssetActionError>Förslaget är inte längre aktuellt.</AssetActionError>
      ) : null}
      <AssetActionSection afterAlert>
        VÄLJ FÖRSÄLJNING PÅ FAKTURA {source.issue.legalDocumentNumber}
      </AssetActionSection>
      <AssetInvoiceSourceTable
        selected={selected}
        onSelect={setSelected}
        rows={source.issue.lines.map((candidate, index) => {
          const claim = source.claims.find((value) => value.lineId === candidate.id);

          return {
            id: candidate.id,
            ordinal: index + 1,
            description: candidate.description,
            amount: format(candidate.netMinor),
            state: claim
              ? `Använd av ${claim.series}${claim.postingReceipt.voucherNumber}`
              : "Ledig",
            disabled: !!claim || source.blocked || !current,
          };
        })}
      />
      <AssetActionNote>
        Raderna hämtas från den utfärdade fakturan. Kontantförsäljning utan faktura väljs i stället
        från en bankhändelse.
      </AssetActionNote>
      {line && current ? (
        <>
          <AssetActionSection>FÖRSLAG MED RAD {ordinal}</AssetActionSection>
          <AssetActionFacts>
            <AssetFact
              label="Anskaffningsvärde"
              value={format(review.assetBasis.originalCostMinor)}
            />
            <AssetFact
              label={`Ackumulerade avskrivningar${accumulationDate ? ` t.o.m. ${accumulationDate}` : ""}`}
              value={`−${format(review.assetBasis.totalAccumulatedMinor)}`}
            />
            {review.assetBasis.impairmentMinor !== undefined &&
            review.assetBasis.impairmentMinor !== "0" ? (
              <AssetFact
                label="Nedskrivningar"
                value={`−${format(review.assetBasis.impairmentMinor)}`}
              />
            ) : null}
            <AssetFact
              label="Bokfört restvärde"
              value={format(review.assetBasis.carryingMinor)}
              emphasis
            />
            <AssetFact
              label={`Försäljning enligt faktura ${source.issue.legalDocumentNumber}, rad ${ordinal}`}
              value={format(line.netMinor)}
            />
            {profit !== null ? (
              <AssetFact
                label={
                  BigInt(profit) < 0n
                    ? "Förlust vid avyttring, beräknad"
                    : "Vinst vid avyttring, beräknad"
                }
                value={format(profit)}
                emphasis
              />
            ) : null}
          </AssetActionFacts>
        </>
      ) : null}
      <AssetActionActions>
        <CommandForm
          book={book}
          locale="sv"
          path={`${bookPath(book)}/asset-disposals/prepare`}
          schema={Disposals.PrepareDisposal}
          output={Disposals.Review}
          label={`Använd rad ${ordinal}`}
          compact
          canSubmit={available}
          allowed={review.input.kind === "disposal"}
          input={() => ({
            ...review.input,
            proceeds: {
              kind: "existing_legal_invoice",
              issueId: source.issue.id,
              lineId: selected,
              acknowledgeRevenueReclassification: true,
            },
          })}
          validate={(value, input) => {
            if (
              value.assetBasis.schedule.scheduleId !== input.scheduleId ||
              value.proceeds.kind !== "existing_legal_invoice" ||
              input.proceeds.kind !== "existing_legal_invoice" ||
              value.proceeds.issue.id !== input.proceeds.issueId ||
              value.proceeds.lineId !== input.proceeds.lineId
            )
              throw new Error("Disposal selection identity mismatch");
          }}
          onSuccess={(value) => props.onPrepared(value.id)}
        />
        <Button variant="outline" nativeButton={false} render={<Link href={props.bankHref} />}>
          Välj bankhändelse i stället
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href={props.backHref} />}>
          Avbryt
        </Button>
      </AssetActionActions>
      {occupied ? (
        <AssetActionNote>
          Rad {ordinal} ersätter inte rad {occupiedOrdinal}. {occupied.series}
          {occupied.postingReceipt.voucherNumber} är oförändrat. Förslaget skickas för godkännande
          av en person i webbläsaren, inte av en assistent.
        </AssetActionNote>
      ) : null}
    </>
  );
}

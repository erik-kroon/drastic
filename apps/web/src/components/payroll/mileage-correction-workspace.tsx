import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  MileageCorrectionComparison,
  MileageCorrectionFacts,
} from "@open-erp/ui/components/mileage-correction";
import {
  AssetActionActions,
  AssetActionError,
  AssetActionMetadata,
  AssetActionNote,
  AssetActionSection,
  AssetPostedJournal,
  RetainedActionLayout,
} from "@open-erp/ui/components/asset-action";
import { AccountingStatus } from "@/components/accounting-status";
import { OriginalDocument } from "@/components/original-document";
import { isUncertainWriteError } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { useMileageCorrection } from "./use-mileage-correction";
import { mileageStatuses } from "./mileage-status";

function contributionPercentage(
  bands:
    | readonly {
        lowerMinor: string;
        upperMinor: string | null;
        rate: { numerator: string; denominator: string };
      }[]
    | undefined,
) {
  const rate =
    bands?.length === 1 && bands[0]?.lowerMinor === "0" && bands[0].upperMinor === null
      ? bands[0].rate
      : null;

  if (!rate) return null;

  const numerator = BigInt(rate.numerator) * 10000n;
  const denominator = BigInt(rate.denominator);

  return denominator > 0n && numerator % denominator === 0n
    ? (numerator / denominator).toString()
    : null;
}

export function MileageCorrectionWorkspace(props: { proposalId: string; occurrenceId?: string }) {
  const { book, locale } = useBookWorkspace();
  const owner = useMileageCorrection(props.proposalId);
  const view = owner.query.isSuccess ? owner.query.data : undefined;
  const href = `${workspacePath(book)}/tax?view=mileage&record=${encodeURIComponent(props.proposalId)}`;
  const money = (value: string) => formatMinorAmount(value, 2, locale);

  const distance = (value: string) =>
    formatMinorAmount(value, 3, locale)
      .replace(/([,.]\d*?)0+$/, "$1")
      .replace(/[,.]$/, "");

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "Europe/Stockholm",
    })
      .format(new Date(value))
      .replace(/\.$/, "");

  const month = (value: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "Europe/Stockholm" }).format(
      new Date(value),
    );

  if (!view)
    return (
      <>
        <AccountingStatus
          locale={locale}
          pending={owner.query.isPending}
          error={owner.query.error}
        />
        {owner.query.isError ? (
          <Button
            variant="outline"
            disabled={owner.query.isFetching}
            onClick={() => void owner.query.refetch()}
          >
            Försök igen
          </Button>
        ) : null}
      </>
    );

  const sources = [
    view.sources.originalRoute,
    view.sources.revisedRoute,
    view.sources.recoveryBasis,
    view.proposal.sources.originalRoute,
    view.proposal.sources.revisedRoute,
    view.proposal.sources.recoveryBasis,
  ];

  const source = sources.find((item) => item?.id === props.occurrenceId);

  if (props.occurrenceId)
    return (
      <>
        <Link href={href}>Tillbaka till rättelsen</Link>
        {source ? (
          <OriginalDocument book={book} locale={locale} id={source.id} sha256={source.sha256} />
        ) : (
          <AccountingStatus
            locale={locale}
            pending={false}
            error={new Error("Originalet hör inte till den här rättelsen.")}
          />
        )}
      </>
    );

  const comparison = view.comparison;
  const journal = view.journal;
  const trip = view.original.trip;
  const originalRoute = view.sources.originalRoute;
  const revisedRoute = view.sources.revisedRoute;
  const release = view.original.release;

  const perKilometre = (rate: string) => {
    const numerator = BigInt(rate) * 1000n;
    const denominator = BigInt(release.distanceUnitMeters);

    return denominator > 0n && numerator % denominator === 0n
      ? money((numerator / denominator).toString())
      : null;
  };

  const percentageMinor = contributionPercentage(comparison?.contributionWitness.bands);
  const percentage = percentageMinor === null ? null : money(percentageMinor);

  return (
    <RetainedActionLayout
      title="Milersättning rättas efter lönekörning"
      breadcrumbLabel="Skatt och löner"
      trail={[
        { label: "Skatt och löner", href: `${workspacePath(book)}/tax` },
        { label: "Löner", href: `${workspacePath(book)}/tax?view=payroll` },
        {
          label: `Resa ${date(trip.departureOn)}, ${view.employee.personRef}`,
          href: originalRoute
            ? `${href}&occurrence=${encodeURIComponent(originalRoute.id)}`
            : undefined,
        },
        { label: "Rättelse" },
      ]}
      synthetic
      posted={view.execution !== null}
      waiting={view.execution === null}
      waitingLabel={
        view.current.status === "approved" && !view.current.approvalUsable
          ? mileageStatuses.blocked
          : mileageStatuses[view.current.status]
      }
    >
      {view.original.paidOn && view.original.earningsPeriod ? (
        <AssetActionMetadata>
          {trip.origin} till {trip.destination}, {date(trip.departureOn)}. Ursprunglig ersättning{" "}
          {view.original.reference} ingick i {month(view.original.earningsPeriod.startsOn)}lönen som
          betalades ut {date(view.original.paidOn)}. Den ändras inte, rättelsen blir en egen post
          som pekar på den.
        </AssetActionMetadata>
      ) : null}
      {view.current.blockers.map((blocker, index) => (
        <AssetActionError key={`${blocker.code}:${index}`}>{blocker.message}</AssetActionError>
      ))}
      {comparison ? (
        <>
          <AssetActionSection>RÄTTELSEN</AssetActionSection>
          <MileageCorrectionComparison
            originalLabel={
              view.proposal.input.previousCorrectionExecutionId
                ? "Föregående rättelse"
                : "Ursprunglig"
            }
            rows={[
              {
                id: "distance",
                label: "Sträcka enligt granskad rutt",
                original: `${distance(comparison.predecessorDistanceMeters)} km`,
                revised: `${distance(comparison.revisedDistanceMeters)} km`,
                difference: `${distance(comparison.distanceDeltaMeters)} km`,
              },
              {
                id: "entitlement",
                label: `Ersättning enligt avtal${perKilometre(release.entitlementRateMinorPerUnit) ? `, ${perKilometre(release.entitlementRateMinorPerUnit)} per km` : ""}`,
                original: money(comparison.predecessorSplit.entitlementMinor),
                revised: money(comparison.revisedSplit.entitlementMinor),
                difference: money(comparison.entitlementDeltaMinor),
              },
              {
                id: "exempt",
                label: `Skattefri del${perKilometre(release.taxExemptRateMinorPerUnit) ? `, ${perKilometre(release.taxExemptRateMinorPerUnit)} per km` : ""}`,
                original: money(comparison.predecessorSplit.exemptPaidPartMinor),
                revised: money(comparison.revisedSplit.exemptPaidPartMinor),
                difference: money(comparison.exemptDeltaMinor),
              },
              {
                id: "taxable",
                label: "Skattepliktig del",
                original: money(comparison.predecessorSplit.taxablePartMinor),
                revised: money(comparison.revisedSplit.taxablePartMinor),
                difference: money(comparison.taxableDeltaMinor),
              },
            ]}
          />
          <AssetActionNote>
            Beloppen räknas om från den nya sträckan och satserna. Du skriver inte in dem.
          </AssetActionNote>
        </>
      ) : null}
      <AssetActionSection>UNDERLAG</AssetActionSection>
      <MileageCorrectionFacts
        rows={[
          {
            id: "route",
            label: "Ny ruttkontroll",
            value: revisedRoute ? (
              <Link href={`${href}&occurrence=${encodeURIComponent(revisedRoute.id)}`}>
                {revisedRoute.filename},{" "}
                {distance(view.proposal.input.revisedTrip.distanceInMeters)} km
              </Link>
            ) : null,
          },
          {
            id: "basis",
            label: "Rättslig grund för återkravet",
            value: view.sources.recoveryReason,
          },
        ]}
      />
      {journal ? (
        <>
          <AssetActionSection>
            VERIFIKATFÖRSLAG, RÄTTELSE AV {view.original.reference}
          </AssetActionSection>
          <AssetPostedJournal
            compact
            rows={journal.lines.map((line) => ({
              id: line.accountId,
              label:
                line.accountId === view.proposal.input.recoveryReceivableAccountId
                  ? `Fordran på anställd, ${view.employee.personRef}`
                  : `${line.accountCode} ${line.accountName}`,
              debit: line.debitMinor === "0" ? "" : money(line.debitMinor),
              credit: line.creditMinor === "0" ? "" : money(line.creditMinor),
            }))}
            debit={money(journal.debitMinor)}
            credit={money(journal.creditMinor)}
          />
        </>
      ) : null}
      <AssetActionActions>
        <Button
          disabled={owner.blocked || !view.current.canSubmit || !view.settlementReview}
          onClick={() => {
            if (view.settlementReview)
              owner.submit({
                kind: "submit",
                input: {
                  proposalDigest: view.proposal.digest,
                  reviewDigest: view.settlementReview.digest,
                },
              });
          }}
        >
          Skicka för godkännande
        </Button>
        <Button
          variant="outline"
          disabled={owner.blocked || !view.current.canCancel}
          onClick={() =>
            owner.submit({ kind: "cancel", input: { proposalDigest: view.proposal.digest } })
          }
        >
          Avbryt
        </Button>
      </AssetActionActions>
      {comparison && view.original.reportingPeriod ? (
        <AssetActionNote>
          Ursprungligt godkännande och bokföring ändras inte. Arbetsgivaravgiften på den
          skattepliktiga delen, {money(comparison.contributionCorrectionMinor)}
          {percentage ? ` med ${percentage} procent` : ""}, räknas i lönekörningens rättelse och
          ingår inte i verifikatet. Fordran på {view.employee.personRef} betalas tillbaka eller
          kvittas som ett återkrav efter utbetald lön. Rättelsen tas med när
          arbetsgivardeklarationen för {month(`${view.original.reportingPeriod}-01`)} rättas.
        </AssetActionNote>
      ) : null}
      <MileageRecovery owner={owner} />
    </RetainedActionLayout>
  );
}

function MileageRecovery({ owner }: { owner: ReturnType<typeof useMileageCorrection> }) {
  const { locale } = useBookWorkspace();

  return (
    <>
      <AccountingStatus
        write
        locale={locale}
        pending={owner.command.isPending}
        error={owner.command.error ?? owner.recovery.error}
      />
      {owner.recovery.error ? (
        <Button
          variant="outline"
          disabled={owner.command.isPending}
          onClick={() => owner.recovery.refresh()}
        >
          Försök läsa återhämtningen igen
        </Button>
      ) : null}
      {(owner.command.isError || (owner.command.isIdle && owner.recovery.saved)) &&
      owner.captured ? (
        <Button
          variant="outline"
          disabled={owner.command.isPending}
          onClick={() => {
            if (owner.captured) owner.command.mutate(owner.captured);
          }}
        >
          Försök samma åtgärd igen
        </Button>
      ) : null}
      {owner.command.isError && !isUncertainWriteError(owner.command.error) && owner.captured ? (
        <Button
          variant="outline"
          onClick={() => {
            if (!owner.captured) return;
            owner.recovery.clear(owner.captured.key);
            owner.command.reset();
          }}
        >
          Tillbaka till granskningen
        </Button>
      ) : null}
    </>
  );
}

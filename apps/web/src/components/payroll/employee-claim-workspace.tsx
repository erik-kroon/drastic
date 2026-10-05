import * as Match from "effect/Match";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  ClaimReceipts,
  ClaimRoutes,
  type ClaimPayoutRoute,
} from "@open-erp/ui/components/claim-review";
import {
  AssetActionActions,
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
import { useEmployeeClaimReview } from "./use-employee-claim-review";

export function EmployeeClaimWorkspace(props: { claimId: string; occurrenceId?: string }) {
  const { book, setup, locale } = useBookWorkspace();
  const owner = useEmployeeClaimReview(props);
  const { query, blocked, submit } = owner;
  const href = `${workspacePath(book)}/tax?view=claims&record=${encodeURIComponent(props.claimId)}`;

  const view = query.isSuccess ? query.data : undefined;

  const review = view?.recognition
    ? view.reviews.find(
        (item) =>
          item.id === view.recognition?.reviewId && item.digest === view.recognition.reviewDigest,
      )
    : view?.currentReview;

  const money = (amount: string) => formatMinorAmount(amount, 2, locale);

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "Europe/Stockholm",
    })
      .format(new Date(value))
      .replace(/\.$/, "");

  const receipt = view
    ? [view.current, ...view.revisions]
        .flatMap((revision) => revision.items)
        .find((item) => item.occurrence.id === props.occurrenceId)
    : undefined;

  if (!view)
    return (
      <>
        <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
        {query.isError ? (
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Försök igen
          </Button>
        ) : null}
      </>
    );

  if (props.occurrenceId)
    return (
      <>
        <Link href={href}>Tillbaka till utläggen</Link>
        {receipt ? (
          <OriginalDocument
            book={book}
            locale={locale}
            id={receipt.occurrence.id}
            sha256={receipt.selection.sha256}
          />
        ) : (
          <AccountingStatus
            locale={locale}
            pending={false}
            error={new Error("Originalet hör inte till den här utläggsrevisionen.")}
          />
        )}
      </>
    );

  const partial = view.reviews.findLast(
    (item) =>
      item.revisionId === view.current.id &&
      BigInt(item.directMinor) > 0n &&
      BigInt(item.payrollMinor) > 0n,
  );

  const payout: ClaimPayoutRoute = review?.directMinor === "0" ? "payroll" : "split";
  const selectedRoute = review?.payrollMinor === "0" ? "direct" : payout;

  const lines =
    review?.preparedRecognition.postingPlan.groups.flatMap((group) =>
      group.actions.flatMap((action) => action.lines),
    ) ?? [];

  const changeRoute = (route: ClaimPayoutRoute) => {
    if (!review || (route === "split" && !partial)) return;
    submit({
      kind: "review",
      input: {
        ...review.input,
        directMinor: Match.value(route).pipe(
          Match.when("direct", () => review.liabilityMinor),
          Match.when("payroll", () => "0"),
          Match.when("split", () => partial?.directMinor ?? review.directMinor),
          Match.exhaustive,
        ),
      },
    });
  };

  return (
    <RetainedActionLayout
      title={`Utlägg från ${view.employeeName}, ${view.current.items.length} kvitton`}
      breadcrumbLabel="Skatt och löner"
      trail={[
        { label: "Skatt och löner", href: `${workspacePath(book)}/tax` },
        { label: "Löner", href: `${workspacePath(book)}/tax?view=payroll` },
        { label: `Utlägg, ${view.employeeName}` },
      ]}
      synthetic={view.current.items.every((item) => item.receipt.recordClass === "synthetic")}
      posted={view.recognition !== null}
      waiting={view.recognition === null}
      waitingLabel="Väntar på granskning"
    >
      <AssetActionMetadata>
        Inlämnade {date(view.current.createdAt)}. Varje kvitto granskas för sig och får en egen väg.
      </AssetActionMetadata>
      <AssetActionSection>KVITTON</AssetActionSection>
      <ClaimReceipts
        rows={view.current.items.map((item, index) => ({
          id: item.occurrence.id,
          label: (
            <Link href={`${href}&occurrence=${encodeURIComponent(item.occurrence.id)}`}>
              {index + 1}{" "}
              {Match.value(item.outcome).pipe(
                Match.when(
                  "qualified",
                  () =>
                    `${item.supplierName}, ${item.receipt.purpose}, kvitto ${item.receipt.supplierDocumentNumber}`,
                ),
                Match.when(
                  "company_paid",
                  () =>
                    `${item.supplierName}, ${date(item.receipt.issuedOn)}, betald med företagskort`,
                ),
                Match.when(
                  "duplicate",
                  () =>
                    `${item.supplierName}, kvitto ${item.receipt.supplierDocumentNumber}, uppladdat en gång till`,
                ),
                Match.exhaustive,
              )}
            </Link>
          ),
          amount: money(item.receipt.grossMinor),
          eligible: item.outcome === "qualified",
          outcome: Match.value(item.outcome).pipe(
            Match.when("qualified", () =>
              view.recognition ? "Bokförd" : "Kan bokföras som skuld",
            ),
            Match.when("company_paid", () => "Betald av företaget, kan inte bli utlägg"),
            Match.when(
              "duplicate",
              () =>
                `Dubblett av rad ${view.current.items.findIndex((original) => original.occurrence.id === item.originalOccurrenceId) + 1}, räknas inte`,
            ),
            Match.exhaustive,
          ),
        }))}
      />
      {review ? (
        <>
          <ClaimRoutes
            legend="VÄG FÖR RAD 1"
            value={selectedRoute}
            disabled={blocked || view.recognition !== null || !view.pendingReviewCurrent}
            onChange={changeRoute}
            choices={[
              { value: "direct", label: "Betala allt direkt från banken" },
              { value: "payroll", label: "Betala allt i lönen, som skattefritt utlägg" },
              ...(partial
                ? [
                    {
                      value: "split" as const,
                      label: "Dela upp",
                      detail: `${money(partial.directMinor)} direkt från banken och ${money(partial.payrollMinor)} i ${new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${view.current.input.month}-01T12:00:00Z`))}lönen`,
                    },
                  ]
                : []),
            ]}
          />
          <AssetActionSection>
            {view.recognition ? "BOKFÖRD SKULD" : "BOKFÖRS NÄR NÅGON GODKÄNNER RAD 1"}
          </AssetActionSection>
          <AssetPostedJournal
            compact
            rows={lines.map((line) => {
              const account = setup.accounts.find((item) => item.id === line.accountId);

              return {
                id: line.lineId,
                label: account ? `${account.code} ${account.name}` : line.accountId,
                debit: line.debitMinor === "0" ? "" : money(line.debitMinor),
                credit: line.creditMinor === "0" ? "" : money(line.creditMinor),
              };
            })}
            debit={money(lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n).toString())}
            credit={money(
              lines.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n).toString(),
            )}
          />
        </>
      ) : null}
      {view.recognition === null ? (
        <AssetActionActions>
          {review ? (
            <Button
              disabled={!view.approvalAllowed || blocked}
              onClick={() =>
                submit({
                  kind: "approve",
                  reviewId: review.id,
                  digest: review.digest,
                })
              }
            >
              Godkänn rad 1
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={blocked || !view.completionAllowed}
            onClick={() =>
              submit({
                kind: "completion",
                digest: view.current.digest,
              })
            }
          >
            Begär komplettering
          </Button>
        </AssetActionActions>
      ) : null}
      <ClaimRecovery owner={owner} />
      {view.recognition ? (
        <AssetActionNote>
          <Link
            href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(view.recognition.postingReceipt.voucherId)}`}
          >
            Visa verifikatet
          </Link>
        </AssetActionNote>
      ) : null}
      {view.reviewBlockers.map((blocker) => (
        <AssetActionNote key={blocker} status>
          {blocker}
        </AssetActionNote>
      ))}
      <AssetActionNote>
        Belopp och moms räknas från kvittot, inte från vad som skrivs in. Rad 2 och 3 godkänns inte
        och ger ingen skuld. Varje belopp får bara en väg, och en väg som redan använts kan inte
        bytas efter betalning. Godkännandet bokför skulden. Betalningen görs i en betalfil som
        godkänns för sig.
      </AssetActionNote>
    </RetainedActionLayout>
  );
}

function ClaimRecovery({ owner }: { owner: ReturnType<typeof useEmployeeClaimReview> }) {
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

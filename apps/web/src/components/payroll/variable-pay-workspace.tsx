import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  VariablePayBlockers,
  VariablePayPartialAmounts,
} from "@open-erp/ui/components/variable-pay-review";
import {
  AssetActionActions,
  AssetActionMetadata,
  AssetActionNote,
  AssetActionSection,
  RetainedActionLayout,
} from "@open-erp/ui/components/asset-action";
import { AccountingStatus } from "@/components/accounting-status";
import { OriginalDocument } from "@/components/original-document";
import { isUncertainWriteError } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { useVariablePayReview } from "./use-variable-pay-review";
import {
  variableBlockerRows,
  variableDate,
  variableMonth,
  variableWorkedLabel,
} from "./variable-pay-presentation";

const statuses = {
  blocked: "Kan inte godkännas",
  ready: "Redo för granskning",
  returned: "Skickat tillbaka",
  removed: "Borttagen ur körningen",
  recognized: "Bokförd",
} as const;

export function VariablePayWorkspace(props: { assessmentId: string; occurrenceId?: string }) {
  const { book, locale } = useBookWorkspace();

  const owner = useVariablePayReview(props.assessmentId);

  const view = owner.query.isSuccess ? owner.query.data : undefined;

  const base = workspacePath(book);

  const href = `${base}/tax?view=variable&record=${encodeURIComponent(props.assessmentId)}`;

  const money = (value: string | null) =>
    value === null ? null : formatMinorAmount(value, 2, locale);

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

  const assessment = view.assessment;

  if (props.occurrenceId)
    return (
      <>
        <Link href={href}>Tillbaka till granskningen</Link>
        {props.occurrenceId === assessment.sourceOccurrence.occurrenceId ? (
          <OriginalDocument
            book={book}
            locale={locale}
            id={props.occurrenceId}
            sha256={assessment.sourceOccurrence.sha256}
          />
        ) : (
          <AccountingStatus
            locale={locale}
            pending={false}
            error={new Error("Originalet hör inte till det här underlaget.")}
          />
        )}
      </>
    );

  if (!view.current.assessmentCurrent && view.recognition === null)
    return (
      <>
        <AccountingStatus
          locale={locale}
          pending={false}
          error={new Error("Underlaget har ändrats efter granskningen.")}
        />
        <Button
          variant="outline"
          disabled={owner.query.isFetching}
          onClick={() => void owner.query.refetch()}
        >
          Försök igen
        </Button>
      </>
    );

  const lastDay = new Date(`${assessment.sourceProfile.month}-01T12:00:00Z`);

  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);

  const ending = variableDate(lastDay.toISOString().slice(0, 10), locale);

  const count = view.current.blockers.length;

  const submitter = assessment.submitter.displayName;

  const selection = view.selection;

  return (
    <RetainedActionLayout
      title={`Rörlig lön för ${variableMonth(assessment.sourceProfile.month, locale)}, ${assessment.employee.personRef}`}
      breadcrumbLabel="Skatt och löner"
      trail={[
        { label: "Skatt och löner", href: `${base}/tax` },
        { label: "Löner", href: `${base}/tax?view=payroll` },
        { label: `Rörlig lön, ${assessment.employee.personRef}` },
      ]}
      blocked={view.current.status === "blocked" ? statuses.blocked : undefined}
      waiting={view.current.status !== "blocked" && view.recognition === null}
      waitingLabel={view.financialApproval?.usable ? "Godkänd" : statuses[view.current.status]}
      posted={view.recognition !== null}
      synthetic
    >
      {!view.current.assessmentCurrent ? (
        <AccountingStatus
          locale={locale}
          pending={false}
          error={new Error("Underlaget har ändrats efter granskningen.")}
        />
      ) : null}
      <AssetActionMetadata>
        Arbetad tid 1 till {ending}, utbetalas {variableDate(assessment.paymentOn, locale)}.
        Tidsrapporten och semesterskulden granskas innan något går vidare till lönekörningen.
        {count ? ` ${count === 3 ? "Tre" : count} saker stoppar godkännandet.` : ""}
      </AssetActionMetadata>
      {count ? (
        <>
          <AssetActionSection>STOPPAR GODKÄNNANDET</AssetActionSection>
          <VariablePayBlockers rows={variableBlockerRows(view, locale, base, href)} />
        </>
      ) : null}
      <AssetActionSection>
        {count ? "BERÄKNAT HITTILLS, GÅR INTE ATT GODKÄNNA" : "BERÄKNAT HITTILLS"}
      </AssetActionSection>
      <VariablePayPartialAmounts
        rows={[
          {
            id: "worked",
            label: variableWorkedLabel(view, locale),
            value: money(assessment.workedAmountMinor),
          },
          {
            id: "holiday",
            label: "Förändring av semesterskulden",
            value: money(assessment.holidayDeltaMinor),
          },
          { id: "sick", label: "Sjukfrånvaro", value: money(assessment.sickAmountMinor) },
        ]}
      />
      <AssetActionActions>
        <Button
          disabled={owner.blocked || !view.current.canApprove}
          onClick={() => owner.approve()}
        >
          Godkänn
        </Button>
        <Button
          variant="outline"
          disabled={owner.blocked || !view.current.canReturn || !selection}
          onClick={() => {
            if (selection)
              owner.dispose({
                assessmentDigest: assessment.digest,
                selectionId: selection.id,
                kind: "returned",
              });
          }}
        >
          Skicka tillbaka till {submitter}
        </Button>
        <Button
          variant="outline"
          disabled={owner.blocked || !view.current.canRemove || !selection}
          onClick={() => {
            if (selection)
              owner.dispose({
                assessmentDigest: assessment.digest,
                selectionId: selection.id,
                kind: "removed",
              });
          }}
        >
          Ta bort från körningen
        </Button>
      </AssetActionActions>
      {view.recognition ? (
        <AssetActionNote>
          <Link
            href={`${base}/books?view=vouchers&record=${encodeURIComponent(view.recognition.voucherId)}`}
          >
            Öppna bokfört verifikat
          </Link>
        </AssetActionNote>
      ) : (
        <AssetActionNote>
          Ingenting bokfördes och ingenting skickades till lönekörningen.
          {count ? " Ett belopp som inte går att räkna är okänt och räknas aldrig som noll." : ""}
          {count === 3 ? " Godkännande blir möjligt först när alla tre orsaker är lösta." : ""}
        </AssetActionNote>
      )}
      <VariableRecovery owner={owner} />
    </RetainedActionLayout>
  );
}

function VariableRecovery({ owner }: { owner: ReturnType<typeof useVariablePayReview> }) {
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

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Peppol from "@open-erp/contracts/peppol-exchange";
import { Button } from "@open-erp/ui/components/button";
import { Box } from "@open-erp/ui/components/box";
import { Link } from "@open-erp/ui/components/link";
import {
  RetainedActionLayout,
  AssetActionSection,
  AssetActionMetadata,
  AssetActionActions,
  AssetActionNote,
  AssetActionError,
} from "@open-erp/ui/components/asset-action";
import { PeppolChecks, PeppolRecoveries } from "@open-erp/ui/components/peppol-review";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { loanDate } from "../treasury-loan-format";
import { checkScope, CommandForm } from "./shared";
import { PeppolEmailRecovery } from "./peppol-email-recovery";
import { PeppolCreditRecovery } from "./peppol-credit-recovery";
import { peppolDiagnostics } from "./peppol-review-copy";

export function PeppolReviewWorkspace(props: {
  issueId?: string;
  reviewId?: string;
  creditId?: string;
}) {
  const { book, locale } = useBookWorkspace();
  const [after, setAfter] = useState<string | null>(null);
  const base = `${bookPath(book)}/commerce/peppol`;
  const workspace = `${workspacePath(book)}/sales?view=peppol&record=${encodeURIComponent(props.issueId ?? "")}`;

  const review = useQuery({
    queryKey: [...bookKey(book), "peppol-review", props.issueId, props.reviewId],
    enabled: !!props.issueId && !!props.reviewId,
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${base}/reviews/${encodeURIComponent(props.reviewId ?? "")}`,
        Peppol.ReviewView,
        { signal },
      );

      checkScope(book, view.review.scope);

      if (
        view.review.id !== props.reviewId ||
        view.review.input.document.kind !== "invoice" ||
        view.review.input.document.id !== props.issueId ||
        view.review.source.reference.id !== props.issueId
      )
        throw new Error("Peppol review identity mismatch");

      return view;
    },
  });

  const directory = useQuery({
    queryKey: [...bookKey(book), "peppol-review-directory", props.issueId, after],
    enabled: !!props.issueId && !props.reviewId,
    retry: false,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({
        documentKind: "invoice",
        documentId: props.issueId ?? "",
      });

      if (after) query.set("after", after);

      const page = await readAccounting(`${base}/reviews?${query.toString()}`, Peppol.ReviewPage, {
        signal,
      });

      if (
        page.items.some(
          (item) => item.document.kind !== "invoice" || item.document.id !== props.issueId,
        )
      )
        throw new Error("Peppol directory identity mismatch");

      return page;
    },
  });

  if (!props.issueId)
    return <Link href={`${workspacePath(book)}/sales?view=invoices`}>Fakturor</Link>;

  if (!props.reviewId)
    return (
      <Box display="grid" gap="md">
        <AccountingStatus locale={locale} pending={directory.isPending} error={directory.error} />
        {!directory.isError
          ? directory.data?.items.map((item) => (
              <Link key={item.id} href={`${workspace}&review=${encodeURIComponent(item.id)}`}>
                {item.legalNumber} som e-faktura till {item.customerName}
              </Link>
            ))
          : null}
        {directory.data?.next && !directory.isError ? (
          <Button variant="outline" onClick={() => setAfter(directory.data?.next ?? null)}>
            Nästa
          </Button>
        ) : null}
        {directory.isError ? (
          <Button
            variant="outline"
            onClick={() => {
              void directory.refetch();
            }}
          >
            Försök igen
          </Button>
        ) : null}
      </Box>
    );

  return (
    <>
      <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
      {review.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void review.refetch();
          }}
        >
          Försök igen
        </Button>
      ) : null}
      {review.data && !review.isError ? (
        <PeppolRetainedReview
          key={review.data.review.id}
          view={review.data}
          creditId={props.creditId}
          refresh={() => {
            void review.refetch();
          }}
        />
      ) : null}
    </>
  );
}

function PeppolRetainedReview(props: {
  view: typeof Peppol.ReviewView.Type;
  refresh: () => void;
  creditId?: string;
}) {
  const { book, locale } = useBookWorkspace();
  const { view } = props;
  const { review } = view;
  const diagnostics = peppolDiagnostics(review);

  const [recovery, setRecovery] = useState<"email" | "credit" | null>(
    props.creditId ? "credit" : null,
  );

  const blocked =
    review.outcome === "blocked" || !!view.returned || !view.sourceCurrent || !view.partiesCurrent;

  return (
    <RetainedActionLayout
      title={`${review.source.legalNumber} som e-faktura till ${review.source.buyer.legalName}`}
      blocked={blocked ? "Kan inte skickas" : undefined}
      trail={[
        { label: "Försäljning", href: `${workspacePath(book)}/sales` },
        { label: "Fakturor", href: `${workspacePath(book)}/sales?view=invoices` },
        { label: `${review.source.legalNumber}, e-faktura` },
      ]}
    >
      <AssetActionMetadata>
        Förberedd av {view.preparerName} {loanDate(review.createdAt.slice(0, 10), locale)}{" "}
        {new Intl.DateTimeFormat("sv-SE", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Stockholm",
        }).format(new Date(review.createdAt))}
        . Exempel.
      </AssetActionMetadata>
      {view.returned ? (
        <AssetActionError>
          Förslaget har skickats tillbaka. Ingenting har skickats och kunden har inte fått något.
        </AssetActionError>
      ) : null}
      <AssetActionSection>KONTROLL</AssetActionSection>
      <PeppolChecks
        rows={[
          {
            label:
              review.validation.outcome === "ValidationUnavailable"
                ? "Går valideringen inte att köra räknas den inte som godkänd."
                : `Innehållet validerat mot e-fakturaformatet, ${diagnostics.errors} fel och ${diagnostics.warnings} varningar`,
            state: review.outcome === "ready" ? "✓ Stämmer" : "Fel",
            passed: review.outcome === "ready",
            diagnostics: review.outcome === "blocked" ? diagnostics.messages : [],
          },
          {
            label: "Summor och moms stämmer mot den utfärdade fakturan",
            state: view.totalsMatch ? "✓ Stämmer" : "Fel",
            passed: view.totalsMatch,
          },
          {
            label: "Mottagare och vår avsändare finns och är aktuella",
            state: view.partiesCurrent && view.sourceCurrent ? "✓ Aktuella" : "Fel",
            passed: view.partiesCurrent && view.sourceCurrent,
          },
        ]}
      />
      {blocked ? (
        <>
          <AssetActionSection>SÅ KAN DU GÅ VIDARE</AssetActionSection>
          <PeppolRecoveries
            email={() => setRecovery("email")}
            credit={() => setRecovery("credit")}
            disabled={!view.sourceCurrent}
          />
          <AssetActionActions>
            <Button disabled>Godkänn exakt det här innehållet</Button>
            <Button disabled>Skicka</Button>
            <CommandForm
              book={book}
              locale={locale}
              path={`${bookPath(book)}/commerce/peppol/reviews/${review.id}/returns`}
              schema={Peppol.Approve}
              output={Peppol.ReviewReturn}
              input={() => ({ digest: review.digest })}
              label="Skicka tillbaka"
              compact
              variant="outline"
              canSubmit={review.outcome === "blocked" && !view.returned}
              onSuccess={props.refresh}
            />
          </AssetActionActions>
          <AssetActionNote>
            Godkännande är inte möjligt förrän kontrollen är godkänd. Ingenting har skickats och
            kunden har inte fått något. Går valideringen inte att köra räknas den inte som godkänd.
          </AssetActionNote>
        </>
      ) : (
        <AssetActionNote>Ingenting har skickats och kunden har inte fått något.</AssetActionNote>
      )}
      {recovery ? (
        <Box display="grid" gap="md">
          {recovery === "email" ? (
            <PeppolEmailRecovery review={review} />
          ) : (
            <PeppolCreditRecovery review={review} creditId={props.creditId} />
          )}
          <Button variant="outline" onClick={() => setRecovery(null)}>
            Tillbaka
          </Button>
        </Box>
      ) : null}
    </RetainedActionLayout>
  );
}

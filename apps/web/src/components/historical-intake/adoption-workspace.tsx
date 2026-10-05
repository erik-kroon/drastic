import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Adoption from "@open-erp/contracts/historical-adoptions";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import {
  RetainedActionLayout,
  AssetActionSection,
  AssetActionNote,
  AssetActionActions,
} from "@open-erp/ui/components/asset-action";
import {
  HistoricalAdoptionSteps,
  HistoricalAdoptionRefusal,
  HistoricalAdoptionTable,
} from "@open-erp/ui/components/historical-adoption";
import { AccountingStatus } from "@/components/accounting-status";
import { CommandForm, checkScope } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";

export function HistoricalAdoptionDirectory() {
  const { book, locale } = useBookWorkspace();

  const query = useInfiniteQuery({
    queryKey: [...bookKey(book), "historical-adoption-directory"],
    initialPageParam: "",
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/historical-adoption-plans${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Adoption.AdoptionPage,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });

  return (
    <RecordSection title="Ta över öppna poster">
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch();
          }}
        >
          Försök igen
        </Button>
      ) : null}
      {!query.isError
        ? query.data?.pages
            .flatMap((page) => page.items)
            .map((plan) => (
              <Box key={plan.id}>
                <Link
                  href={`${workspacePath(book)}/history?adoption=${encodeURIComponent(plan.id)}`}
                >
                  {plan.input.sourceIdentity}
                </Link>
              </Box>
            ))
        : null}
      {query.hasNextPage ? (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          Visa fler
        </Button>
      ) : null}
    </RecordSection>
  );
}

export function HistoricalAdoptionWorkspace({ planId }: { planId: string }) {
  const { book, setup, locale } = useBookWorkspace();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: [...bookKey(book), "historical-adoption-workspace", planId],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/historical-adoption-plans/${encodeURIComponent(planId)}/workspace`,
        Adoption.AdoptionWorkspace,
        { signal },
      );

      checkScope(book, result.plan.scope);
      checkScope(book, result.preparedPool.scope);
      checkScope(book, result.currentPool.scope);

      if (
        result.plan.id !== planId ||
        result.preparedPool.id !== result.plan.input.poolId ||
        result.currentPool.id !== result.preparedPool.id
      )
        throw new Error("Historical adoption identity mismatch");

      return result;
    },
  });

  const saved = query.isError ? undefined : query.data;

  const rejected = Boolean(
    saved?.revision &&
    saved.stale &&
    saved.approvals.length &&
    !saved.adoption &&
    saved.adoptedMinor === "0",
  );

  const base = `${workspacePath(book)}/history`;
  const amount = (minor: string) => formatMinorAmount(minor, 2, locale);
  const prepared = saved?.preparedPool;
  const current = saved?.currentPool;

  const code =
    setup.accounts.find((account) => account.id === current?.controlAccountId)?.code ??
    current?.input.sourceAccount;

  const signedPrepared = prepared
    ? (prepared.input.direction === "AR"
        ? BigInt(prepared.exactResidualMinor)
        : -BigInt(prepared.exactResidualMinor)
      ).toString()
    : "0";

  const revisionDate = saved?.revision
    ? new Intl.DateTimeFormat("sv-SE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Stockholm",
      })
        .format(new Date(saved.revision.createdAt))
        .replaceAll(".", "")
    : "";

  return (
    <RetainedActionLayout
      title={rejected ? "Övertagandet gjordes inte, poolen ändrades" : "Ta över öppna poster"}
      synthetic={book.profile === "synthetic-core-v1"}
      trail={[
        { label: "Bokföring", href: `${workspacePath(book)}/books` },
        { label: "Historik", href: base },
        { label: "Ta över öppna poster" },
      ]}
    >
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch();
          }}
        >
          Försök igen
        </Button>
      ) : null}
      {saved && prepared && current ? (
        <>
          <HistoricalAdoptionSteps
            stale={saved.stale}
            approved={saved.approvals.length > 0}
            adopted={saved.adoption !== null}
          />
          {rejected ? <HistoricalAdoptionRefusal /> : null}
          <AssetActionSection afterAlert={rejected}>PLANEN MOT POOLEN NU</AssetActionSection>
          <HistoricalAdoptionTable
            items={prepared.sourceItems.map((item) => {
              const now = current.sourceItems.find(
                (row) => row.sourceIdentity === item.sourceIdentity,
              );

              if (
                item.residualAtCutover.kind !== "evidenced" ||
                now?.residualAtCutover.kind !== "evidenced"
              )
                throw new Error("Historical pool residual unavailable");

              return {
                identity: item.sourceIdentity,
                prepared: amount(item.residualAtCutover.amountMinor),
                current: amount(now.residualAtCutover.amountMinor),
                changed: item.residualAtCutover.amountMinor !== now.residualAtCutover.amountMinor,
              };
            })}
            totals={[
              {
                label: "Poolens summa",
                prepared: amount(prepared.exactResidualMinor),
                current: amount(current.exactResidualMinor),
                emphasis: true,
              },
              {
                label: `Huvudbokens ingående balans, ${code}`,
                prepared: amount(signedPrepared),
                current: amount(saved.glMinor),
              },
              {
                label: "Skillnad mellan pool och huvudbok",
                prepared: amount("0"),
                current: amount(saved.differenceMinor),
                emphasis: true,
                discrepancy: saved.differenceMinor !== "0",
              },
            ]}
          />
          {saved.revision ? (
            <AssetActionNote>
              Importen granskades om {revisionDate} av{" "}
              {saved.reviewerName ?? saved.revision.createdBy}, och {saved.revision.input.rationale}{" "}
              Övertaget hittills är {amount(saved.adoptedMinor)} och inte övertaget är{" "}
              {amount(saved.originalUnadoptedMinor)}. En pool som inte stämmer mot huvudboken kan
              inte tas över förrän skillnaden är utredd.
            </AssetActionNote>
          ) : null}
          <AssetActionActions>
            <CommandForm
              book={book}
              locale={locale}
              compact
              path={`${bookPath(book)}/historical-adoption-plans`}
              schema={Adoption.PrepareAdoption}
              output={Adoption.AdoptionPlan}
              label="Förbered ny plan"
              input={() => ({
                poolId: current.id,
                poolDigest: current.digest,
                sourceIdentity: saved.plan.input.sourceIdentity,
                rationale: saved.plan.input.rationale,
              })}
              validate={(result, input) => {
                if (
                  result.input.poolId !== input.poolId ||
                  result.input.poolDigest !== input.poolDigest
                )
                  throw new Error("Historical adoption preparation mismatch");
              }}
              onSuccess={(result) => {
                void navigate({ to: base, search: { adoption: result.id } });
              }}
            />
            <Button
              variant="outline"
              render={
                <Link
                  href={`${base}?source=${encodeURIComponent(saved.currentSourceOccurrenceId)}&preview=${encodeURIComponent(saved.currentPreviewId)}&plan=${encodeURIComponent(saved.currentSourcePlanId)}`}
                />
              }
            >
              Visa ändringen i importen
            </Button>
            <Button
              variant="outline"
              render={
                <Link href={`${base}?source=${encodeURIComponent(saved.sourceOccurrenceId)}`} />
              }
            >
              Tillbaka till importen
            </Button>
          </AssetActionActions>
          <AssetActionNote>
            SIE-filen och importen är oförändrade. Den nya planen behöver ett nytt godkännande av en
            person i webbläsaren och gäller i en timme.
          </AssetActionNote>
          {!saved.stale && !saved.adoption ? (
            <>
              <CommandForm
                book={book}
                locale={locale}
                compact
                path={`${bookPath(book)}/historical-adoption-plans/${encodeURIComponent(planId)}/approvals`}
                schema={Adoption.Approve}
                output={Adoption.Approval}
                label="Godkänn"
                input={() => ({ digest: saved.plan.digest })}
              />
              {saved.approvals[0] ? (
                <CommandForm
                  book={book}
                  locale={locale}
                  compact
                  path={`${bookPath(book)}/historical-adoption-plans/${encodeURIComponent(planId)}/execute`}
                  schema={Adoption.Execute}
                  output={Adoption.Adoption}
                  label="Ta över öppna poster"
                  input={() => ({ digest: saved.plan.digest, approvalId: saved.approvals[0]!.id })}
                />
              ) : null}
            </>
          ) : null}
          {saved.adoption ? <Text>Övertagen. Inga nya verifikat skapades.</Text> : null}
        </>
      ) : null}
    </RetainedActionLayout>
  );
}

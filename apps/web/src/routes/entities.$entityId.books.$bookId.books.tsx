import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Identifier, Digest } from "@open-erp/contracts/accounting";
import { SavedRequestKey } from "@open-erp/contracts/posting-recovery";
import {
  WorkReturnSearch,
  decodeWorkReturn,
  workReturnHref,
  OwnerReturnSearch,
  decodeOwnerReturn,
  ownerReturnDestination,
} from "@/lib/work-return";
import { WorkReturnAction } from "@/components/work-return-action";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { PageAction, PageContent } from "@open-erp/ui/components/accounting-page";
import { RegisterNavigation } from "@open-erp/ui/components/register-workspace";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { BlockedCorrectionImpactReview } from "@/components/corrections/blocked-impact-review";
import {
  CorrectionReview,
  correctionEntryWitness,
} from "@/components/corrections/correction-review";
import { PostingDraft } from "@/components/posting-recovery/draft";
import { PostedRecord } from "@/components/posted-records";
import { VoucherWorkspace } from "@/components/voucher-workspace";
import { ChartOfAccounts } from "@/components/account-register";
import { TreasuryLoanWorkspace } from "@/components/treasury-loan-workspace";
import { BookAssets } from "@/components/subledgers/book-assets";
import { frontendCopy } from "@/lib/frontend-copy";
import { accountingCopy } from "@/lib/accounting-copy";

const search = Schema.Struct({
  view: Schema.optional(Schema.Literals(["journal", "vouchers", "accounts", "assets"])),
  savedRequest: Schema.optional(SavedRequestKey),
  correction: Schema.optional(Identifier),
  correctionImpact: Schema.optional(Identifier),
  correctionDigest: Schema.optional(Digest),
  correctionChild: Schema.optional(Identifier),
  correctionPlanDigest: Schema.optional(Digest),
  record: Schema.optional(Schema.String),
  loan: Schema.optional(Identifier),
  loanReview: Schema.optional(Identifier),
  loanApproval: Schema.optional(Schema.Boolean),
  assetPlan: Schema.optional(Schema.Boolean),
  assetAction: Schema.optional(Schema.Literals(["disposal", "reversal"])),
  assetReview: Schema.optional(Identifier),
  work: WorkReturnSearch,
  returnTo: OwnerReturnSearch,
  returnPlan: Schema.optional(Identifier),
  returnRevision: Schema.optional(Digest),
  returnVat: Schema.optional(Identifier),
  returnSupplier: Schema.optional(Identifier),
  returnSupplierReview: Schema.optional(Identifier),
  returnReport: Schema.optional(Schema.String),
  returnAccount: Schema.optional(Schema.String),
  returnView: Schema.optional(Schema.Literals(["trial", "ledger"])),
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  period: Schema.optional(Schema.String),
});

export const Route = createFileRoute("/entities/$entityId/books/$bookId/books")({
  validateSearch: Schema.decodeUnknownSync(search),
  component: Books,
});

function Books() {
  const { book, setup, locale } = useBookWorkspace();
  const query = Route.useSearch();
  const { view = "vouchers", record, returnReport, returnAccount } = query;
  const navigate = useNavigate();
  const copy = frontendCopy(locale);
  const work = decodeWorkReturn(query.work);
  const owner = decodeOwnerReturn(query.returnTo);

  const ownerReturnLabels = {
    home: accountingCopy(locale).workspace_back,
    documents: locale === "sv" ? "Tillbaka till dokument" : "Back to documents",
    purchases: accountingCopy(locale).workspace_back,
    sales: accountingCopy(locale).workspace_back,
    bank: accountingCopy(locale).workspace_back,
    work: accountingCopy(locale).workspace_back,
  };

  const base = `${workspacePath(book)}/books`;

  const onPrepared = (id: string) => {
    void navigate({ to: reviewPath(book, id), search: { ...work, returnTo: query.returnTo } });
  };

  if (query.correctionImpact)
    return (
      <BlockedCorrectionImpactReview
        key={query.correctionImpact}
        book={book}
        locale={locale}
        id={query.correctionImpact}
        setup={setup}
      />
    );

  if (query.correction)
    return (
      <CorrectionReview
        key={query.correction}
        book={book}
        setup={setup}
        locale={locale}
        id={query.correction}
        entry={correctionEntryWitness(query)}
      />
    );

  if (view === "accounts" && query.loan)
    return (
      <TreasuryLoanWorkspace
        loanId={query.loan}
        reviewId={query.loanReview}
        approval={query.loanApproval}
      />
    );

  if (view === "assets")
    return (
      <BookAssets
        recordId={record}
        action={query.assetAction}
        reviewId={query.assetReview}
        plan={query.assetPlan === true}
      />
    );

  const navigation = (
    <RegisterNavigation
      label={copy.bookkeeping}
      options={[
        {
          label: copy.vouchers,
          href: workReturnHref(base, "vouchers", work),
          active: view !== "accounts",
        },
        {
          label: copy.chart,
          href: workReturnHref(base, "accounts", work),
          active: view === "accounts",
        },
        {
          label: locale === "sv" ? "Periodiseringar" : "Deferrals",
          href: `${workspacePath(book)}/reports?view=subledgers`,
          active: false,
        },
        {
          label: locale === "sv" ? "Tillgångar" : "Assets",
          href: `${workspacePath(book)}/books?view=assets`,
          active: false,
        },
        {
          label: locale === "sv" ? "Dimensioner" : "Dimensions",
          href: `${workspacePath(book)}/settings?view=accounting`,
          active: false,
        },
        {
          label: locale === "sv" ? "Åtgärder" : "Actions",
          href: `${workspacePath(book)}/history`,
          active: false,
        },
      ]}
    />
  );

  const action = (
    <Box display="flex" flexWrap="wrap" alignItems="center" gap="md">
      <WorkReturnAction work={work} />
      <PageAction compact href={workReturnHref(base, "journal", work)}>
        {copy.newEntry}
      </PageAction>
    </Box>
  );

  return (
    <>
      {view === "accounts" ? (
        <WorkspaceHeader title={copy.bookkeeping} navigation={navigation} action={action} />
      ) : null}
      <PageContent>
        {view !== "accounts" ? (
          <VoucherWorkspace
            navigation={navigation}
            action={action}
            book={book}
            locale={locale}
            setup={setup}
            onPrepared={onPrepared}
            query={query.q ?? ""}
            period={query.period ?? ""}
            onQuery={(q) =>
              void navigate({
                to: base,
                search: { ...query, q: q || undefined },
                replace: true,
                resetScroll: false,
              })
            }
            onPeriod={(period) =>
              void navigate({
                to: base,
                search: { ...query, period: period || undefined },
                replace: true,
                resetScroll: false,
              })
            }
          />
        ) : null}
        {view === "accounts" ? <ChartOfAccounts /> : null}
        {record && view === "vouchers" ? (
          <RecordSheet
            title={copy.voucher}
            closeLabel={
              query.returnPlan || query.returnSupplier || query.returnVat
                ? locale === "sv"
                  ? "Tillbaka till granskningen"
                  : "Back to review"
                : returnReport
                  ? locale === "sv"
                    ? "Tillbaka till rapporten"
                    : "Back to report"
                  : owner
                    ? ownerReturnLabels[owner.owner]
                    : copy.returnVouchers
            }
            onClose={() =>
              void navigate(
                query.returnPlan
                  ? {
                      to: reviewPath(book, query.returnPlan, query.returnRevision),
                      search: { ...work, returnTo: query.returnTo },
                      resetScroll: false,
                    }
                  : query.returnSupplier
                    ? {
                        to: `${workspacePath(book)}/purchases`,
                        search: {
                          view: "supplier-drafts",
                          record: query.returnSupplier,
                          review: query.returnSupplierReview,
                          work: query.work,
                          returnTo: query.returnTo,
                        },
                        resetScroll: false,
                      }
                    : query.returnVat
                      ? {
                          to: `${workspacePath(book)}/tax`,
                          search: {
                            view: "actual-vat",
                            record: query.returnVat,
                            work: query.work,
                            returnTo: query.returnTo,
                          },
                          resetScroll: false,
                        }
                      : returnReport
                        ? {
                            to: `${workspacePath(book)}/reports`,
                            search: {
                              view: query.returnView ?? "trial",
                              record: returnReport,
                              account: returnAccount,
                            },
                            resetScroll: false,
                          }
                        : owner
                          ? {
                              ...ownerReturnDestination(workspacePath(book), owner),
                              resetScroll: false,
                            }
                          : {
                              to: base,
                              search: {
                                view: "vouchers",
                                q: query.q,
                                period: query.period,
                                work: query.work,
                                returnTo: query.returnTo,
                              },
                              resetScroll: false,
                            },
              )
            }
          >
            <PostedRecord
              book={book}
              locale={locale}
              setup={setup}
              id={record}
              onPrepared={onPrepared}
            />
          </RecordSheet>
        ) : null}
        {view === "journal" ? (
          <FormDialog
            title={copy.newEntry}
            closeLabel={copy.returnVouchers}
            onClose={() => {
              void navigate({ to: base, search: { view: "vouchers", work: query.work } });
            }}
          >
            <Box display="grid" gap="lg" minWidth="zero">
              {setup.blockers.map((blocker) => (
                <Text key={blocker} role="alert">
                  {blocker}
                </Text>
              ))}
              {setup.blockers.length === 0 ? (
                <PostingDraft
                  book={book}
                  setup={setup}
                  locale={locale}
                  onPrepared={onPrepared}
                  resumeRequestKey={query.savedRequest}
                />
              ) : null}
            </Box>
          </FormDialog>
        ) : null}
      </PageContent>
    </>
  );
}

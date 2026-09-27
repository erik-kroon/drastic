import { lazy, Suspense } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  History,
  ListChecks,
  Users,
  Wrench,
} from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import {
  PageContent,
  PageAction,
  TaskSection,
  TaskRow,
} from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import {
  reviewPath,
  reviewTargetPath,
  useBookWorkspace,
  workspacePath,
  type ReviewTarget,
} from "@/lib/book-context";
import { WorkReturnAction } from "@/components/work-return-action";
import { WorkReturnSearch, decodeWorkReturn, workReturnHref } from "@/lib/work-return";
import { frontendCopy } from "@/lib/frontend-copy";

const Owners = lazy(() =>
  import("@/components/owner-register/owner-register-panel").then((m) => ({
    default: m.OwnerRegisterPanel,
  })),
);

const Recurring = lazy(() =>
  import("@/components/recurring-preparation").then((m) => ({ default: m.RecurringPreparation })),
);

const Corrections = lazy(() =>
  import("@/components/corrections/corrections-panel").then((m) => ({
    default: m.CorrectionsPanel,
  })),
);

const Snapshots = lazy(() =>
  import("@/components/case-snapshots").then((m) => ({ default: m.CaseSnapshots })),
);

const Readiness = lazy(() =>
  import("@/components/book-readiness").then((m) => ({ default: m.BookReadiness })),
);

const Recovery = lazy(() =>
  import("@/components/posting-recovery/panel").then((m) => ({ default: m.PostingRecoveryPanel })),
);

const Technical = lazy(() =>
  import("@/components/accounting-workspace").then((m) => ({ default: m.AccountingWorkspace })),
);

export const Route = createFileRoute("/entities/$entityId/books/$bookId/tools")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      view: Schema.optional(
        Schema.Literals([
          "owners",
          "recurring",
          "corrections",
          "snapshots",
          "readiness",
          "recovery",
          "technical",
        ]),
      ),
      bundle: Schema.optional(Accounting.Identifier),
      work: WorkReturnSearch,
    }),
  ),
  component: Tools,
});

function Tools() {
  const { book, setup, locale } = useBookWorkspace();
  const { view, bundle, work: returnSearch } = Route.useSearch();
  const work = decodeWorkReturn(returnSearch);
  const navigate = useNavigate();
  const base = `${workspacePath(book)}/tools`;
  const sv = locale === "sv";

  const onPrepared = (id: string) =>
    void navigate({ to: reviewPath(book, id), search: work ?? {} });

  const onReview = (target: ReviewTarget) => void navigate({ to: reviewTargetPath(book, target) });

  return (
    <>
      <WorkspaceHeader
        title={frontendCopy(locale).tools}
        action={<WorkReturnAction work={work} />}
      />
      <PageContent>
        {view ? (
          <Box>
            <PageAction
              quiet
              href={`${base}${returnSearch ? `?work=${encodeURIComponent(returnSearch)}` : ""}`}
            >
              <ArrowLeft size={14} />
              {sv ? "Alla verktyg" : "All tools"}
            </PageAction>
          </Box>
        ) : (
          <>
            <TaskSection title={sv ? "Bokföringsarbete" : "Accounting work"}>
              <TaskRow
                href={workReturnHref(base, "owners", work)}
                icon={<Users size={16} />}
                title={sv ? "Ägarutlägg och finansiering" : "Owner expenses and funding"}
                detail={
                  sv
                    ? "Underlag, ersättningar och ägarens mellanhavanden."
                    : "Sources, reimbursements and balances with owners."
                }
              />
              <TaskRow
                href={workReturnHref(base, "recurring", work)}
                icon={<CalendarClock size={16} />}
                title={sv ? "Återkommande bokningar" : "Recurring entries"}
                detail={
                  sv
                    ? "Regler och förslag för återkommande arbete."
                    : "Rules and proposals for recurring work."
                }
              />
              <TaskRow
                href={workReturnHref(base, "corrections", work)}
                icon={<History size={16} />}
                title={sv ? "Rättelser" : "Corrections"}
                detail={
                  sv
                    ? "Granska en rättelse och dess påverkan på bokföringen."
                    : "Review corrections and their effects on the books."
                }
              />
            </TaskSection>
            <TaskSection title={sv ? "Granskning och återställning" : "Review and recovery"}>
              <TaskRow
                href={workReturnHref(base, "snapshots", work)}
                icon={<BookOpen size={16} />}
                title={sv ? "Sparade arbetsunderlag" : "Saved work snapshots"}
                detail={
                  sv
                    ? "Fortsätt från ett sparat underlag för bokföringsarbete."
                    : "Continue accounting work from a saved source snapshot."
                }
              />
              <TaskRow
                href={workReturnHref(base, "recovery", work)}
                icon={<History size={16} />}
                title={sv ? "Återställ påbörjat arbete" : "Recover unfinished work"}
                detail={
                  sv
                    ? "Hitta en tidigare begäran och se om den blev bokförd."
                    : "Find a previous request and check whether it was posted."
                }
              />
              <TaskRow
                href={workReturnHref(base, "readiness", work)}
                icon={<ListChecks size={16} />}
                title={sv ? "Arbetsytans funktioner" : "Workspace capabilities"}
                detail={
                  sv
                    ? "Tillgängliga funktioner, behörighet och begränsningar."
                    : "Available features, permissions and limitations."
                }
              />
              <TaskRow
                href={workReturnHref(base, "technical", work)}
                icon={<Wrench size={16} />}
                title={sv ? "Teknisk arbetsyta" : "Technical workspace"}
                detail={
                  sv
                    ? "Detaljerade kontrollverktyg och direktöppning med referens."
                    : "Detailed controls and reference-based lookups."
                }
              />
            </TaskSection>
          </>
        )}
        <Suspense fallback={<AccountingStatus locale={locale} pending error={null} />}>
          {view === "owners" ? <Owners book={book} locale={locale} /> : null}
          {view === "recurring" ? (
            <Recurring book={book} setup={setup} locale={locale} onPrepared={onPrepared} open />
          ) : null}
          {view === "corrections" ? (
            <Corrections
              key={bundle ?? "corrections"}
              book={book}
              setup={setup}
              locale={locale}
              open
              {...(bundle === undefined ? {} : { bundleId: bundle })}
            />
          ) : null}
          {view === "snapshots" ? (
            <Snapshots book={book} locale={locale} onReview={onReview} open />
          ) : null}
          {view === "readiness" ? <Readiness book={book} locale={locale} expanded /> : null}
          {view === "recovery" ? (
            <Recovery book={book} locale={locale} onPrepared={onPrepared} />
          ) : null}
          {view === "technical" ? <Technical book={book} locale={locale} /> : null}
        </Suspense>
      </PageContent>
    </>
  );
}

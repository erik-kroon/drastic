import { lazy, Suspense } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
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
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
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
    }),
  ),
  component: Tools,
});

function Tools() {
  const { book, setup, locale } = useBookWorkspace();
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const base = `${workspacePath(book)}/tools`;
  const sv = locale === "sv";
  const onPrepared = (id: string) => void navigate({ to: reviewPath(book, id) });

  return (
    <>
      <WorkspaceHeader title={frontendCopy(locale).tools} />
      <PageContent>
        {view ? (
          <Box>
            <PageAction quiet href={base}>
              <ArrowLeft size={14} />
              {sv ? "Alla verktyg" : "All tools"}
            </PageAction>
          </Box>
        ) : (
          <>
            <TaskSection title={sv ? "Bokföringsarbete" : "Accounting work"}>
              <TaskRow
                href={`${base}?view=owners`}
                icon={<Users size={16} />}
                title={sv ? "Ägarutlägg och finansiering" : "Owner expenses and funding"}
                detail={
                  sv
                    ? "Underlag, ersättningar och ägarens mellanhavanden."
                    : "Sources, reimbursements and balances with owners."
                }
              />
              <TaskRow
                href={`${base}?view=recurring`}
                icon={<CalendarClock size={16} />}
                title={sv ? "Återkommande bokningar" : "Recurring entries"}
                detail={
                  sv
                    ? "Regler och förslag för återkommande arbete."
                    : "Rules and proposals for recurring work."
                }
              />
              <TaskRow
                href={`${base}?view=corrections`}
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
                href={`${base}?view=snapshots`}
                icon={<BookOpen size={16} />}
                title={sv ? "Sparade arbetsunderlag" : "Saved work snapshots"}
                detail={
                  sv
                    ? "Fortsätt från ett sparat underlag för bokföringsarbete."
                    : "Continue accounting work from a saved source snapshot."
                }
              />
              <TaskRow
                href={`${base}?view=recovery`}
                icon={<History size={16} />}
                title={sv ? "Återställ påbörjat arbete" : "Recover unfinished work"}
                detail={
                  sv
                    ? "Hitta en tidigare begäran och se om den blev bokförd."
                    : "Find a previous request and check whether it was posted."
                }
              />
              <TaskRow
                href={`${base}?view=readiness`}
                icon={<ListChecks size={16} />}
                title={sv ? "Arbetsytans funktioner" : "Workspace capabilities"}
                detail={
                  sv
                    ? "Tillgängliga funktioner, behörighet och begränsningar."
                    : "Available features, permissions and limitations."
                }
              />
              <TaskRow
                href={`${base}?view=technical`}
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
            <Corrections book={book} setup={setup} locale={locale} open />
          ) : null}
          {view === "snapshots" ? (
            <Snapshots book={book} locale={locale} onPrepared={onPrepared} open />
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

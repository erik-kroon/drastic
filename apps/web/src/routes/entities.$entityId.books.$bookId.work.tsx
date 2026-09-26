import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { AttentionQuery } from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { PageAction, PageContent, RegisterChoices } from "@open-erp/ui/components/accounting-page";
import { frontendCopy } from "@/lib/frontend-copy";
import { Text } from "@open-erp/ui/components/typography";
import { WorkspaceHeader, WorkspaceToolbar } from "@open-erp/ui/components/workspace";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { PostingRecoveryPanel } from "@/components/posting-recovery/panel";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { SavedWorkViews } from "@/components/saved-work-views";
import { AttentionList } from "@/components/attention-list";
import { attentionCopy } from "@/lib/attention";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/work")({
  validateSearch: Schema.decodeUnknownSync(AttentionQuery),
  component: Work,
});

function Work() {
  const { book, setup, locale } = useBookWorkspace();
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  const [error, setError] = useState("");
  const copy = accountingCopy(locale);

  return (
    <>
      <WorkspaceHeader
        title={frontendCopy(locale).todo}
        action={
          <PageAction href={`${workspacePath(book)}/books?view=journal`}>
            {copy.workspace_new_journal}
          </PageAction>
        }
      />
      <PageContent>
        <Box display="grid" gap="lg">
          <Box display="flex" flexWrap="wrap" justifyContent="between" alignItems="center" gap="lg">
            <RegisterChoices
              label={copy.workspace_status}
              value={filters.status ?? "open"}
              options={[
                { value: "open", label: locale === "sv" ? "Att göra" : "To do" },
                { value: "completed", label: locale === "sv" ? "Avslutat" : "Completed" },
                { value: "all", label: copy.workspace_all },
              ]}
              onValueChange={(status) => {
                if (status === "open" || status === "completed" || status === "all")
                  void navigate({ search: { ...filters, status, after: undefined } });
              }}
            />
            <RegisterChoices
              label={attentionCopy(locale).type}
              value={filters.kind ?? "all"}
              options={[
                { value: "all", label: attentionCopy(locale).all },
                { value: "journal", label: attentionCopy(locale).journal },
                { value: "invoice", label: attentionCopy(locale).invoice },
                { value: "expense", label: attentionCopy(locale).expense },
              ]}
              onValueChange={(kind) => {
                if (
                  kind === "all" ||
                  kind === "journal" ||
                  kind === "invoice" ||
                  kind === "expense"
                )
                  void navigate({ search: { ...filters, kind, after: undefined } });
              }}
            />
            <SavedWorkViews filters={filters} onSelect={(search) => void navigate({ search })} />
          </Box>
          <WorkspaceToolbar
            key={JSON.stringify(filters)}
            onSubmit={(event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);

              const parsed = Schema.decodeUnknownOption(AttentionQuery)({
                q: fields.get("q"),
                kind: filters.kind ?? "all",
                period: fields.get("period") || undefined,
                status: filters.status ?? "open",
                sort: fields.get("sort"),
              });

              if (parsed._tag === "None") {
                setError(copy.journal_invalid);

                return;
              }

              setError("");
              void navigate({ search: parsed.value });
            }}
          >
            <InputField
              label={locale === "sv" ? "Sök arbete" : "Search work"}
              name="q"
              defaultValue={filters.q ?? ""}
              maxLength={200}
              type="search"
            />
            <SelectField
              label={copy.workspace_period}
              name="period"
              defaultValue={filters.period ?? ""}
              options={[
                { value: "", label: copy.workspace_all_periods },
                ...setup.periods.map((period) => ({
                  value: period.id,
                  label: `${period.startsOn} – ${period.endsOn}`,
                })),
              ]}
            />
            <SelectField
              label={copy.workspace_sort}
              name="sort"
              defaultValue={filters.sort ?? "newest"}
              options={[
                { value: "newest", label: copy.workspace_newest },
                { value: "oldest", label: copy.workspace_oldest },
              ]}
            />
            <Button static size="xl" variant="outline" type="submit">
              {copy.workspace_filter}
            </Button>
          </WorkspaceToolbar>
        </Box>
        {error ? <Text role="alert">{error}</Text> : null}
        <AttentionList
          filters={filters}
          onPage={(after) => {
            void navigate({ search: (previous) => ({ ...previous, after }) });
          }}
        />
        <Disclosure title={copy.workspace_recovery}>
          <Box paddingBlock="lg" display="grid" gap="lg">
            <Text tone="muted">{copy.workspace_recovery_help}</Text>
            <PostingRecoveryPanel
              book={book}
              locale={locale}
              onPrepared={(id) => {
                void navigate({
                  to: reviewPath(book, id),
                  search: {
                    period: filters.period,
                    status: filters.status,
                    sort: filters.sort,
                    q: filters.q,
                  },
                });
              }}
            />
          </Box>
        </Disclosure>
      </PageContent>
    </>
  );
}

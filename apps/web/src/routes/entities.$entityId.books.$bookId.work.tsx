import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { WorkQuery } from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { PageAction, PageContent } from "@open-erp/ui/components/accounting-page";
import { frontendCopy } from "@/lib/frontend-copy";
import { Text } from "@open-erp/ui/components/typography";
import { WorkspaceHeader, WorkspaceToolbar } from "@open-erp/ui/components/workspace";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { PostingRecoveryPanel } from "@/components/posting-recovery/panel";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { WorkList } from "@/components/work-list";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/work")({
  validateSearch: Schema.decodeUnknownSync(WorkQuery),
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
        title={frontendCopy(locale).proposals}
        action={
          <PageAction href={`${workspacePath(book)}/books?view=journal`}>
            {copy.workspace_new_journal}
          </PageAction>
        }
      />
      <PageContent>
        <WorkspaceToolbar
          key={JSON.stringify(filters)}
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const parsed = Schema.decodeUnknownOption(WorkQuery)({
              q: fields.get("q"),
              period: fields.get("period") || undefined,
              status: fields.get("status"),
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
            label={copy.workspace_search}
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
            label={copy.workspace_status}
            name="status"
            defaultValue={filters.status ?? "open"}
            options={[
              { value: "open", label: copy.workspace_open },
              { value: "completed", label: copy.workspace_completed },
              { value: "all", label: copy.workspace_all },
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
        {error ? <Text role="alert">{error}</Text> : null}
        <WorkList
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
                void navigate({ to: reviewPath(book, id), search: filters });
              }}
            />
          </Box>
        </Disclosure>
      </PageContent>
    </>
  );
}

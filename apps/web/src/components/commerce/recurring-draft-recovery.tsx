import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

export function RecurringDraftRecovery({
  book,
  locale,
  agreementId,
  jobId,
}: CommerceProps & {
  agreementId?: string;
  jobId?: string;
}) {
  const sv = locale === "sv";
  const path = `${commercePath(book)}/recurring-invoices/${encodeURIComponent(agreementId ?? "")}`;

  const agreement = useQuery({
    queryKey: [...commerceKey(book), "recurring-agreement", agreementId],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(path, Recurring.RecurringAgreementView, { signal });

      checkScope(book, value.agreement.scope);

      return value;
    },
    enabled: agreementId !== undefined,
    retry: false,
  });

  const scheduling = useInfiniteQuery({
    queryKey: [...commerceKey(book), "recurring-scheduling", agreementId, jobId],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams();

      if (pageParam) search.set("after", pageParam);

      if (jobId) search.set("job", jobId);

      const value = await readAccounting(
        `${path}/scheduling?${search}`,
        Recurring.RecurringScheduling,
        { signal },
      );

      checkScope(book, value.scope);

      return value;
    },
    getNextPageParam: (page) => page.continuation ?? undefined,
    enabled: agreementId !== undefined,
    retry: false,
  });

  const first = scheduling.data?.pages[0];
  const jobs = scheduling.data?.pages.flatMap((page) => page.history) ?? [];
  const selected = first?.selectedJob ?? jobs.find((job) => job.id === jobId);

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Link href={`${workspacePath(book)}/work`}>{sv ? "Till Att göra" : "Back to work"}</Link>
      <RecordHeading
        title={agreement.data?.agreement.title ?? (sv ? "Återkommande utkast" : "Recurring drafts")}
      />
      <AccountingStatus
        locale={locale}
        pending={agreement.isPending || scheduling.isPending}
        error={agreement.error ?? scheduling.error}
      />
      {first ? (
        <RecordSection title={sv ? "Schemaläggning" : "Scheduling"}>
          <Text>
            {sv ? "Automatiska utkast" : "Automatic drafts"}:{" "}
            {first.enabled ? (sv ? "Aktiva" : "Enabled") : sv ? "Pausade" : "Paused"}
          </Text>
          <Text>
            {sv ? "Nästa cykel" : "Next cycle"}: {first.nextCycleDate} · {first.timeZone}
          </Text>
          <Text>
            {sv
              ? "Varje utkast granskas innan utfärdande."
              : "Each draft requires review before issuance."}
          </Text>
        </RecordSection>
      ) : null}
      {selected && first ? (
        <SelectedCycle
          book={book}
          locale={locale}
          path={path}
          schedule={first}
          selected={selected}
        />
      ) : null}
      {first ? (
        <RecordSection title={sv ? "Cykelhistorik" : "Cycle history"}>
          {jobs.map((job) => (
            <Box key={job.id} display="grid" gap="sm">
              <Link
                href={`${workspacePath(book)}/sales?view=recurring&record=${encodeURIComponent(first.agreementId)}&job=${encodeURIComponent(job.id)}`}
              >
                {sv ? "Cykel" : "Cycle"} {job.cycleOrdinal} · {job.cycleDate} ·{" "}
                {jobStatus(job.state, sv)}
                {job.reason ? ` · ${jobReason(job.reason, sv)}` : ""}
              </Link>
            </Box>
          ))}
          {scheduling.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              disabled={scheduling.isFetchingNextPage}
              onClick={() => {
                void scheduling.fetchNextPage();
              }}
            >
              {sv ? "Fler cykler" : "More cycles"}
            </Button>
          ) : null}
        </RecordSection>
      ) : null}
    </Box>
  );
}

function SelectedCycle(
  props: CommerceProps & {
    path: string;
    schedule: typeof Recurring.RecurringScheduling.Type;
    selected: (typeof Recurring.RecurringScheduling.Type)["history"][number];
  },
) {
  const { book, locale, schedule, selected } = props;
  const sv = locale === "sv";

  return (
    <RecordSection title={sv ? "Vald cykel" : "Selected cycle"}>
      <Text>
        {sv ? "Cykel" : "Cycle"} {selected.cycleOrdinal} · {selected.cycleDate}:{" "}
        {jobStatus(selected.state, sv)}
        {selected.reason ? ` · ${jobReason(selected.reason, sv)}` : ""}
      </Text>
      {selected.draftId ? (
        <Link
          href={`${workspacePath(book)}/sales?view=drafts&record=${encodeURIComponent(selected.draftId)}`}
        >
          {sv ? "Granska utkast" : "Review draft"}
        </Link>
      ) : null}
      {selected.state === "failed" || selected.state === "skipped" ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${props.path}/scheduling/catch-up`}
          schema={Recurring.RecurringCatchUpInput}
          output={Recurring.RecurringScheduling}
          allowed={book.role === "operator" && schedule.enabled}
          label={sv ? "Köa vald cykel för granskning" : "Queue selected cycle for review"}
          recoveryId={`${schedule.agreementId}_${selected.cycleOrdinal}_${selected.generation}`}
          input={(fields) => ({
            expectedGeneration: schedule.generation,
            cycleOrdinals: [selected.cycleOrdinal],
            confirmCatchUp: fields.get("confirmed") === "on",
            reason: fields.get("reason"),
          })}
        >
          <InputField name="reason" label={sv ? "Orsak" : "Reason"} required maxLength={2000} />
          <Box as="label" display="flex" gap="md" alignItems="center">
            <input name="confirmed" type="checkbox" required />
            <Text>{sv ? "Bekräfta vald cykel" : "Confirm the selected cycle"}</Text>
          </Box>
        </CommandForm>
      ) : null}
    </RecordSection>
  );
}

function jobStatus(state: typeof Recurring.RecurringDraftJobState.Type, sv: boolean) {
  const labels = sv
    ? {
        ready: "Väntar",
        drafted: "Utkast skapat",
        skipped: "Överhoppad",
        existing: "Utkast finns",
        failed: "Behöver granskning",
      }
    : {
        ready: "Waiting",
        drafted: "Draft created",
        skipped: "Skipped",
        existing: "Draft exists",
        failed: "Review required",
      };

  return labels[state];
}

function jobReason(reason: string, sv: boolean) {
  switch (reason) {
    case "Forbidden":
    case "Unauthorized":
      return sv
        ? "Behörighet har ändrats. En behörig användare behöver granska cykeln."
        : "Permission changed. A current operator needs to review this cycle.";
    case "StaleDependency":
      return sv
        ? "Avtalet har ändrats. Granska cykeln innan du försöker igen."
        : "The agreement changed. Review this cycle before trying again.";
    case "paused":
    case "scheduling_disabled":
      return sv ? "Pausad vid denna cykel." : "Paused for this cycle.";
    case "ended":
      return sv ? "Avtalet har avslutats." : "The agreement ended.";
    case "unqualified_time_zone":
      return sv
        ? "Tidszonen kan inte användas. Granska avtalets kalender."
        : "The time zone cannot be used. Review the agreement calendar.";
    case "NoTemplateRevisionForCycle":
      return sv ? "Ingen mall gäller för denna cykel." : "No template covers this cycle.";
    case "OverlappingBillingCoverage":
      return sv ? "Serviceperioden är redan fakturerad." : "The service period was already billed.";
    default:
      return sv
        ? "Granska avtalsuppgifterna innan du försöker igen."
        : "Review the agreement inputs before trying again.";
  }
}

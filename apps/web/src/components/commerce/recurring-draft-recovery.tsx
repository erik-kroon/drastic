import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { defaultStringifySearch } from "@tanstack/react-router";
import * as Accounting from "@open-erp/contracts/accounting";
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

export function RecurringDraftRecovery(
  props: CommerceProps & {
    agreementId?: string;
    jobId?: string;
    work?: string;
    returnTo?: string;
    embedded?: boolean;
  },
) {
  const { book, locale, agreementId, jobId } = props;
  const sv = locale === "sv";
  const path = `${commercePath(book)}/recurring-invoices/${encodeURIComponent(agreementId ?? "")}`;

  const agreement = useQuery({
    queryKey: [...commerceKey(book), "recurring-agreement", agreementId],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(path, Recurring.RecurringAgreementView, { signal });

      checkScope(book, value.agreement.scope);

      if (value.agreement.id !== agreementId)
        throw new Error("Recurring agreement identity mismatch");

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
      ).catch((error: unknown) => {
        if (
          !jobId &&
          !pageParam &&
          error instanceof Accounting.AccountingError &&
          error.code === "NotFound"
        )
          return null;

        throw error;
      });

      if (value === null) return null;

      checkScope(book, value.scope);

      if (value.agreementId !== agreementId || (jobId && value.selectedJob?.id !== jobId))
        throw new Error("Recurring scheduling identity mismatch");

      return value;
    },
    getNextPageParam: (page) => page?.continuation ?? undefined,
    enabled: agreement.isSuccess,
    retry: false,
  });

  const first = scheduling.isError ? undefined : scheduling.data?.pages[0];
  const jobs = scheduling.data?.pages.flatMap((page) => page?.history ?? []) ?? [];
  const selected = first?.selectedJob ?? jobs.find((job) => job.id === jobId);

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Link href={`${workspacePath(book)}/work${props.work ?? ""}`}>
        {sv ? "Till Att göra" : "Back to work"}
      </Link>
      {props.embedded ? null : (
        <RecordHeading
          title={
            agreement.data?.agreement.title ?? (sv ? "Återkommande utkast" : "Recurring drafts")
          }
        />
      )}
      <AccountingStatus
        locale={locale}
        pending={agreement.isPending || (agreement.isSuccess && scheduling.isPending)}
        error={agreement.error ?? scheduling.error}
      />
      {agreement.isSuccess && scheduling.isSuccess && first === null ? (
        <StartScheduling
          book={book}
          locale={locale}
          path={path}
          current={!scheduling.isFetching && !agreement.isFetching}
        />
      ) : null}
      {first ? (
        <SchedulingSection
          book={book}
          locale={locale}
          path={path}
          schedule={first}
          current={!scheduling.isFetching && !scheduling.isError}
        />
      ) : null}
      {selected && first ? (
        <SelectedCycle
          book={book}
          locale={locale}
          path={path}
          schedule={first}
          selected={selected}
          current={!scheduling.isFetching && !scheduling.isError}
          work={props.work}
          returnTo={props.returnTo}
        />
      ) : null}
      {first ? (
        <RecordSection title={sv ? "Cykelhistorik" : "Cycle history"}>
          {jobs.map((job) => (
            <Box key={job.id} display="grid" gap="sm">
              <Link
                href={`${workspacePath(book)}/sales${defaultStringifySearch({ view: "recurring", record: first.agreementId, job: job.id, work: props.work, returnTo: props.returnTo })}`}
              >
                {sv ? "Cykel" : "Cycle"} {job.cycleOrdinal}, {job.cycleDate},{" "}
                {jobStatus(job.state, sv)}
                {job.reason ? `, ${jobReason(job.reason, sv)}` : ""}
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

function StartScheduling(props: CommerceProps & { path: string; current: boolean }) {
  const sv = props.locale === "sv";

  return (
    <RecordSection title={sv ? "Schemalägg automatiska utkast" : "Schedule automatic drafts"}>
      <Text>
        {sv
          ? "Automatiska utkast är inte schemalagda för avtalet."
          : "Automatic drafts are not scheduled for this agreement."}
      </Text>
      <Text>
        {sv
          ? "Spara en kommersiell framtida mall som gäller från eller före första automatiska cykeln. Öppna Ändra framtida fakturering nedan. Varje skapat utkast granskas före utfärdande."
          : "Save a commercial future template effective on or before the first automatic cycle. Open Change future billing below. Each created draft requires review before issuance."}
      </Text>
      <CommandForm
        {...props}
        path={`${props.path}/scheduling`}
        schema={Recurring.RecurringSchedulingInput}
        output={Recurring.RecurringScheduling}
        allowed={props.book.role === "operator" && props.current}
        label={sv ? "Aktivera automatiska utkast" : "Enable automatic drafts"}
        input={(fields) => ({
          expectedGeneration: "0",
          enabled: true,
          firstAutomaticCycle: fields.get("firstAutomaticCycle"),
          duePolicy: "local_calendar_date_v1",
          confirmFirstAutomaticCycle: fields.get("confirmed") === "on",
          reason: fields.get("reason"),
        })}
      >
        <InputField
          name="firstAutomaticCycle"
          label={sv ? "Första automatiska cykel" : "First automatic cycle"}
          maxLength={18}
          required
        />
        <InputField
          name="reason"
          label={sv ? "Orsak till schemaläggning" : "Scheduling reason"}
          maxLength={2000}
          required
        />
        <Box as="label" display="flex" gap="md" alignItems="center">
          <input name="confirmed" type="checkbox" required />
          <Text>{sv ? "Bekräfta första automatiska cykel" : "Confirm first automatic cycle"}</Text>
        </Box>
      </CommandForm>
    </RecordSection>
  );
}

function SchedulingSection(
  props: CommerceProps & {
    path: string;
    schedule: typeof Recurring.RecurringScheduling.Type;
    current: boolean;
  },
) {
  const { book, locale } = props;
  const first = props.schedule;
  const sv = locale === "sv";

  return (
    <RecordSection title={sv ? "Schemaläggning" : "Scheduling"}>
      <Text>
        {sv ? "Automatiska utkast" : "Automatic drafts"}:{" "}
        {first.enabled ? (sv ? "Aktiva" : "Enabled") : sv ? "Pausade" : "Paused"}
      </Text>
      <CommandForm
        book={book}
        locale={locale}
        path={`${props.path}/scheduling`}
        recoveryId={first.agreementId}
        schema={Recurring.RecurringSchedulingInput}
        output={Recurring.RecurringScheduling}
        allowed={book.role === "operator" && props.current}
        label={
          first.enabled
            ? sv
              ? "Pausa automatiska utkast"
              : "Pause automatic drafts"
            : sv
              ? "Återuppta automatiska utkast"
              : "Resume automatic drafts"
        }
        input={(fields) => ({
          expectedGeneration: first.generation,
          enabled: !first.enabled,
          firstAutomaticCycle: first.firstAutomaticCycle,
          duePolicy: first.duePolicy,
          confirmFirstAutomaticCycle: fields.get("confirmed") === "on",
          reason: fields.get("reason"),
        })}
      >
        <InputField
          name="reason"
          label={sv ? "Orsak till schemaläggning" : "Scheduling reason"}
          required
          maxLength={2000}
        />
        <Box as="label" display="flex" gap="md" alignItems="center">
          <input name="confirmed" type="checkbox" required />
          <Text>{sv ? "Bekräfta schemaläggningsbeslut" : "Confirm scheduling decision"}</Text>
        </Box>
      </CommandForm>
      <Text>
        {sv ? "Nästa cykel" : "Next cycle"}: {first.nextCycleDate}, {first.timeZone}
      </Text>
      <Text>
        {sv
          ? "Varje utkast granskas innan utfärdande."
          : "Each draft requires review before issuance."}
      </Text>
    </RecordSection>
  );
}

function SelectedCycle(
  props: CommerceProps & {
    path: string;
    schedule: typeof Recurring.RecurringScheduling.Type;
    selected: (typeof Recurring.RecurringScheduling.Type)["history"][number];
    current: boolean;
    work?: string;
    returnTo?: string;
  },
) {
  const { book, locale, schedule, selected } = props;
  const sv = locale === "sv";

  return (
    <RecordSection title={sv ? "Vald cykel" : "Selected cycle"}>
      <Text>
        {sv ? "Cykel" : "Cycle"} {selected.cycleOrdinal}, {selected.cycleDate}:{" "}
        {jobStatus(selected.state, sv)}
        {selected.reason ? `, ${jobReason(selected.reason, sv)}` : ""}
      </Text>
      {selected.draftId ? (
        <Link
          href={`${workspacePath(book)}/sales${defaultStringifySearch({ view: "drafts", record: selected.draftId, work: props.work, returnTo: props.returnTo })}`}
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
          allowed={book.role === "operator" && schedule.enabled && props.current}
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

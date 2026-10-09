import { useState } from "react";
import { defaultStringifySearch } from "@tanstack/react-router";
import { PageAction } from "@open-erp/ui/components/accounting-page";
import { workspacePath } from "@/lib/book-context";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { InvoiceDraftDocument } from "./invoice-draft-document";
import {
  CommandForm,
  Details,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

function scheduleInput(fields: FormData) {
  const monthly = fields.get("cadence") === "monthly";

  return {
    anchorLocalDate: fields.get("anchor"),
    timeZone: fields.get("timeZone"),
    firstCycleOrdinal: fields.get("firstCycle"),
    cadence: {
      kind: monthly ? "monthly" : "fixed_day_interval",
      monthInterval: monthly ? fields.get("interval") : null,
      dayInterval: monthly ? null : fields.get("interval"),
      monthAnchorPolicy: monthly ? fields.get("anchorPolicy") : null,
    },
  };
}

function ScheduleFields({
  locale,
  schedule,
}: Pick<CommerceProps, "locale"> & { schedule?: Recurring.RecurringScheduleInput }) {
  const sv = locale === "sv";

  return (
    <Box display="grid" gap="md">
      <InputField
        name="anchor"
        type="date"
        label={sv ? "Startdatum" : "Anchor date"}
        defaultValue={schedule?.anchorLocalDate}
        required
      />
      <InputField
        name="timeZone"
        label={sv ? "Tidszon" : "Time zone"}
        defaultValue={schedule?.timeZone ?? "Europe/Stockholm"}
        maxLength={64}
        required
      />
      <SelectField
        name="cadence"
        label={sv ? "Intervalltyp" : "Cadence"}
        defaultValue={schedule?.cadence.kind ?? "monthly"}
        options={[
          { value: "monthly", label: sv ? "Månader" : "Months" },
          { value: "fixed_day_interval", label: sv ? "Dagar" : "Days" },
        ]}
      />
      <InputField
        name="interval"
        label={sv ? "Antal månader eller dagar" : "Number of months or days"}
        defaultValue={schedule?.cadence.monthInterval ?? schedule?.cadence.dayInterval ?? "1"}
        maxLength={8}
        required
      />
      <SelectField
        name="anchorPolicy"
        label={sv ? "Månadsregel" : "Monthly anchor rule"}
        defaultValue={schedule?.cadence.monthAnchorPolicy ?? "anchor_day_clamped"}
        options={[
          {
            value: "anchor_day_clamped",
            label: sv
              ? "Startdag, begränsad till månadens slut"
              : "Anchor day, clamped to month end",
          },
          { value: "end_of_month", label: sv ? "Månadens sista dag" : "End of month" },
        ]}
      />
      <Text>
        {sv
          ? "Startdatum är tjänsteperiodens början. Cykel 1 slutar efter ett intervall; startdagen faktureras inte som en egen cykel."
          : "The anchor date starts the service period. Cycle 1 ends after one interval; the anchor itself is not billed as a cycle."}
      </Text>
      <InputField
        name="firstCycle"
        label={sv ? "Första cykelnummer" : "First cycle ordinal"}
        defaultValue={schedule?.firstCycleOrdinal ?? "1"}
        pattern="[1-9][0-9]{0,17}"
        maxLength={18}
        required
      />
    </Box>
  );
}

function SavedScheduleFacts(
  props: Pick<CommerceProps, "locale"> & { schedule: Recurring.RecurringScheduleInput },
) {
  const sv = props.locale === "sv";
  const { schedule } = props;

  return (
    <RecordSummary>
      <RecordFact label={sv ? "Sparat startdatum" : "Saved anchor date"}>
        {schedule.anchorLocalDate}
      </RecordFact>
      <RecordFact label={sv ? "Sparad tidszon" : "Saved time zone"}>{schedule.timeZone}</RecordFact>
      <RecordFact label={sv ? "Sparat intervall" : "Saved interval"}>
        {schedule.cadence.kind === "monthly"
          ? `${schedule.cadence.monthInterval} ${sv ? "månader" : "months"}`
          : `${schedule.cadence.dayInterval} ${sv ? "dagar" : "days"}`}
      </RecordFact>
      {schedule.cadence.kind === "monthly" ? (
        <RecordFact label={sv ? "Sparad månadsregel" : "Saved monthly rule"}>
          {schedule.cadence.monthAnchorPolicy === "end_of_month"
            ? sv
              ? "Månadens sista dag"
              : "End of month"
            : sv
              ? "Startdag, begränsad till månadens slut"
              : "Anchor day, clamped to month end"}
        </RecordFact>
      ) : null}
      <RecordFact label={sv ? "Första sparade cykelnummer" : "Saved first cycle ordinal"}>
        {schedule.firstCycleOrdinal}
      </RecordFact>
    </RecordSummary>
  );
}

export function CreateRecurringAgreement(
  props: CommerceProps & { work?: string; returnTo?: string },
) {
  const sv = props.locale === "sv";

  const customers = useInfiniteQuery({
    queryKey: [...commerceKey(props.book), "contact-options"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/counterparties${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Commerce.CounterpartyPage,
        { signal },
      );

      for (const party of result.items) checkScope(props.book, party.scope);

      return result;
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const parties =
    customers.data?.pages
      .flatMap((page) => page.items)
      .filter((party) => party.role !== "supplier") ?? [];

  const [created, setCreated] = useState<Recurring.RecurringAgreement>();

  return (
    <Details title={sv ? "Skapa återkommande avtal" : "Create recurring agreement"}>
      <Text>
        {sv
          ? "Avtalet skapar inga fakturor förrän en mall och schemaläggning har granskats."
          : "The agreement creates no invoices until a template and scheduling have been reviewed."}
      </Text>
      <AccountingStatus
        locale={props.locale}
        pending={customers.isPending}
        error={customers.error}
      />
      <CommandForm
        {...props}
        path={`${commercePath(props.book)}/recurring-invoices`}
        schema={Recurring.ProposeRecurringAgreement}
        output={Recurring.RecurringAgreement}
        label={sv ? "Spara avtal" : "Save agreement"}
        allowed={props.book.role === "operator"}
        canSubmit={customers.isSuccess && !customers.isFetching}
        input={(fields) => ({
          customerId: fields.get("customer"),
          title: fields.get("title"),
          schedule: scheduleInput(fields),
          reason: fields.get("reason"),
        })}
        onSuccess={(value) => {
          checkScope(props.book, value.scope);
          setCreated(value);
        }}
      >
        <SelectField
          name="customer"
          label={sv ? "Kund" : "Customer"}
          options={[
            { value: "", label: "—" },
            ...parties.map((party) => ({ value: party.id, label: party.displayName })),
          ]}
          required
        />
        <InputField
          name="title"
          label={sv ? "Avtalsnamn" : "Agreement title"}
          maxLength={200}
          required
        />
        <ScheduleFields locale={props.locale} />
        <InputField name="reason" label={sv ? "Orsak" : "Reason"} maxLength={2000} required />
      </CommandForm>
      {customers.hasNextPage ? (
        <Button
          variant="outline"
          disabled={customers.isFetchingNextPage}
          onClick={() => void customers.fetchNextPage()}
        >
          {sv ? "Fler kunder" : "More customers"}
        </Button>
      ) : null}
      {created ? (
        <Box display="grid" gap="sm">
          <Text role="status">
            {sv ? "Avtalet har sparats." : "The agreement has been saved."} {created.title}
          </Text>
          <RecordSummary>
            <RecordFact label={sv ? "Kund i kundregistret" : "Customer in the directory"}>
              {parties.find((party) => party.id === created.customerId)?.displayName ??
                (sv
                  ? "Kundnamnet är inte tillgängligt i den inlästa listan"
                  : "Customer name is unavailable in the loaded directory")}
            </RecordFact>
            <RecordFact label={sv ? "Sparad orsak" : "Saved reason"}>{created.reason}</RecordFact>
          </RecordSummary>
          <SavedScheduleFacts locale={props.locale} schedule={created.schedule} />
          <PageAction
            href={`${workspacePath(props.book)}/sales${defaultStringifySearch({ view: "recurring", record: created.id, work: props.work, returnTo: props.returnTo })}`}
          >
            {sv ? "Öppna sparat avtal" : "Open saved agreement"}
          </PageAction>
        </Box>
      ) : null}
    </Details>
  );
}

export function RecurringAgreementControls(props: CommerceProps & { agreementId: string }) {
  const path = `${commercePath(props.book)}/recurring-invoices/${encodeURIComponent(props.agreementId)}`;
  const sv = props.locale === "sv";

  const agreement = useQuery({
    queryKey: [...commerceKey(props.book), "recurring-agreement", props.agreementId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Recurring.RecurringAgreementView, { signal });

      checkScope(props.book, result.agreement.scope);

      if (result.agreement.id !== props.agreementId)
        throw new Error("Recurring agreement identity mismatch");

      return result;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const current = agreement.isSuccess && agreement.isFetchedAfterMount && !agreement.isFetching;

  return (
    <Details title={sv ? "Ändra framtida fakturering" : "Change future billing"}>
      <AccountingStatus
        locale={props.locale}
        pending={agreement.isPending}
        error={agreement.error}
      />
      <Button
        variant="outline"
        disabled={agreement.isFetching}
        onClick={() => void agreement.refetch()}
      >
        {sv ? "Uppdatera avtal" : "Refresh agreement"}
      </Button>
      {agreement.isSuccess ? (
        <Box display="grid" gap="sm">
          <Text>
            {sv ? "Sparade schema- och mallrevisioner" : "Saved schedule and template revisions"}
          </Text>
          {agreement.data.schedules.map((schedule) => (
            <Text key={schedule.revision}>
              {sv ? "Schema" : "Schedule"} {schedule.revision}, {sv ? "från cykel" : "from cycle"}{" "}
              {schedule.effectiveFromCycle}:{" "}
              {schedule.cadenceKind === "monthly"
                ? sv
                  ? "Månader"
                  : "Months"
                : sv
                  ? "Dagar"
                  : "Days"}
            </Text>
          ))}
          {agreement.data.revisions.map((revision) => (
            <Text key={revision.revision}>
              {sv ? "Mall" : "Template"} {revision.revision}, {sv ? "från cykel" : "from cycle"}{" "}
              {revision.effectiveFromCycle}: {revision.chargeComponentKeys.join(", ")}
            </Text>
          ))}
        </Box>
      ) : null}
      {agreement.data ? (
        <AgreementEdits
          key={`${agreement.data.agreement.id}:${agreement.data.agreement.revision}:${agreement.data.agreement.digest}`}
          {...props}
          agreement={agreement.data.agreement}
          current={current}
          path={path}
        />
      ) : null}
    </Details>
  );
}

function AgreementEdits(
  props: CommerceProps & {
    agreement: Recurring.RecurringAgreement;
    current: boolean;
    path: string;
  },
) {
  const sv = props.locale === "sv";

  const [savedSchedule, setSavedSchedule] = useState<Recurring.RecurringScheduleRevision>();

  const binding = {
    expectedAgreementRevision: props.agreement.revision,
    expectedAgreementDigest: props.agreement.digest,
  };

  return (
    <Box display="grid" gap="lg">
      <Text>
        {sv
          ? "Ändringar gäller från vald cykel. Formuläret börjar med avtalets ursprungliga schema. Sparade fakturor ändras inte."
          : "Changes apply from the selected cycle. The form starts with the agreement’s original schedule. Saved invoices remain unchanged."}
      </Text>
      <Details title={sv ? "Ändra intervall och startdatum" : "Change cadence and anchor date"}>
        <CommandForm
          {...props}
          path={`${props.path}/schedules`}
          recoveryId={props.agreement.id}
          schema={Recurring.AmendRecurringSchedule}
          output={Recurring.RecurringScheduleRevision}
          onSuccess={(value) => {
            checkScope(props.book, value.scope);

            if (value.agreementId !== props.agreement.id)
              throw new Error("Saved schedule agreement mismatch");

            setSavedSchedule(value);
          }}
          label={sv ? "Spara framtida schema" : "Save future schedule"}
          allowed={props.book.role === "operator" && props.current}
          input={(fields) => ({
            ...binding,
            effectiveFromCycle: fields.get("effectiveCycle"),
            schedule: scheduleInput(fields),
            reason: fields.get("reason"),
          })}
        >
          <InputField
            name="effectiveCycle"
            label={sv ? "Gäller från cykel" : "Effective from cycle"}
            maxLength={18}
            required
          />
          <ScheduleFields locale={props.locale} schedule={props.agreement.schedule} />
          <InputField name="reason" label={sv ? "Orsak" : "Reason"} maxLength={2000} required />
        </CommandForm>
      </Details>
      {savedSchedule ? (
        <Box display="grid" gap="sm">
          <Text role="status">
            {sv ? "Sparat schema gäller från cykel" : "Saved schedule applies from cycle"}{" "}
            {savedSchedule.effectiveFromCycle}
          </Text>
          <SavedScheduleFacts locale={props.locale} schedule={savedSchedule.schedule} />
          <Text>{savedSchedule.reason}</Text>
        </Box>
      ) : null}
      <FutureTemplate {...props} binding={binding} />
    </Box>
  );
}

function FutureTemplate(
  props: CommerceProps & {
    agreement: Recurring.RecurringAgreement;
    current: boolean;
    path: string;
    binding: Pick<
      Recurring.ProposeRecurringTemplateRevision,
      "expectedAgreementRevision" | "expectedAgreementDigest"
    >;
  },
) {
  const sv = props.locale === "sv";
  const [draftId, setDraftId] = useState("");

  const drafts = useInfiniteQuery({
    queryKey: [...commerceKey(props.book), "recurring-template-drafts"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/invoice-drafts${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Drafts.InvoiceDraftList,
        { signal },
      );

      checkScope(props.book, result.scope);

      return result;
    },
    getNextPageParam: (page) => page.continuation ?? undefined,
    retry: false,
  });

  const draft = useQuery({
    queryKey: [...commerceKey(props.book), "recurring-template-draft", draftId],
    enabled: draftId !== "",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/invoice-drafts/${encodeURIComponent(draftId)}`,
        Drafts.InvoiceDraftView,
        { signal },
      );

      checkScope(props.book, result.record.scope);

      if (result.record.id !== draftId)
        throw new Error("Recurring template draft identity mismatch");

      return result;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const record = draft.data?.record;
  const matches = record?.content.counterpartyId === props.agreement.customerId;

  return (
    <Details title={sv ? "Ny framtida mallrevision" : "New future template revision"}>
      <Text>
        {sv
          ? "Redigera och spara fakturan först. Välj sedan den sparade version vars rader ska kopieras."
          : "Edit and save the invoice first. Then select the saved revision whose lines should be copied."}
      </Text>
      <SelectField
        label={sv ? "Sparat fakturautkast" : "Saved invoice draft"}
        value={draftId}
        onValueChange={(value) => setDraftId(value ?? "")}
        options={[
          { value: "", label: "—" },
          ...(drafts.data?.pages
            .flatMap((page) => page.items)
            .map((item) => ({ value: item.id, label: `${item.title}, ${item.customerName}` })) ??
            []),
        ]}
      />
      {drafts.hasNextPage ? (
        <Button
          variant="outline"
          disabled={drafts.isFetchingNextPage}
          onClick={() => void drafts.fetchNextPage()}
        >
          {sv ? "Fler fakturautkast" : "More invoice drafts"}
        </Button>
      ) : null}
      <AccountingStatus
        locale={props.locale}
        pending={drafts.isPending || (draftId !== "" && draft.isPending)}
        error={drafts.error ?? draft.error}
      />
      {record ? <InvoiceDraftDocument record={record} locale={props.locale} /> : null}
      {record && record.purpose !== "commercial" ? (
        <Text>
          {sv
            ? "Detta är en källavskriven mall. Automatiska utkast kräver en kommersiell mall."
            : "This is a source transcription template. Automatic drafts require a commercial template."}
        </Text>
      ) : null}
      {record && !matches ? (
        <Text role="alert">
          {sv
            ? "Utkastets kund måste vara avtalets kund."
            : "The draft customer must match the agreement customer."}
        </Text>
      ) : null}
      {record && matches ? (
        <TemplateRevisionForm
          key={`${record.id}:${record.revision}:${record.digest}`}
          {...props}
          record={record}
          ready={draft.isSuccess && !draft.isFetching && draft.isFetchedAfterMount}
        />
      ) : null}
    </Details>
  );
}

function TemplateRevisionForm(
  props: CommerceProps & {
    agreement: Recurring.RecurringAgreement;
    current: boolean;
    path: string;
    binding: Pick<
      Recurring.ProposeRecurringTemplateRevision,
      "expectedAgreementRevision" | "expectedAgreementDigest"
    >;
    record: typeof Drafts.InvoiceDraftRevision.Type;
    ready: boolean;
  },
) {
  const sv = props.locale === "sv";
  const [record] = useState(props.record);
  const [saved, setSaved] = useState<Recurring.RecurringTemplateRevision>();

  return (
    <Box display="grid" gap="md">
      <CommandForm
        {...props}
        path={`${props.path}/template-revisions`}
        recoveryId={`${props.agreement.id}:${record.id}:${record.revision}`}
        schema={Recurring.ProposeRecurringTemplateRevision}
        output={Recurring.RecurringTemplateRevision}
        onSuccess={(value) => {
          checkScope(props.book, value.scope);

          if (value.agreementId !== props.agreement.id)
            throw new Error("Saved template agreement mismatch");

          setSaved(value);
        }}
        label={sv ? "Spara framtida mallrevision" : "Save future template revision"}
        allowed={props.book.role === "operator" && props.current && props.ready}
        input={(fields) => {
          const components = fields.get("components");

          if (typeof components !== "string") throw new Error("Missing charge component names");

          const dateOffsets = {
            issueDays: fields.get("issueDays"),
            supplyDays: fields.get("supplyDays"),
            dueDays: fields.get("dueDays"),
          };

          const content = record.content;

          const shared = {
            title: content.title,
            counterpartyId: content.counterpartyId,
            seller: content.seller,
            currency: content.currency,
            currencyScale: content.currencyScale,
            paymentTerms: content.paymentTerms,
            dateOffsets,
          };

          const template =
            record.purpose === "commercial"
              ? { ...shared, kind: "commercial", lines: record.commercialInput.lines }
              : {
                  ...shared,
                  customer: content.customer,
                  sourceTotalMinor: content.sourceTotalMinor,
                  lines: content.lines,
                };

          return {
            ...props.binding,
            effectiveFromCycle: fields.get("effectiveCycle"),
            chargeComponentKeys: components
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            template,
            reason: fields.get("reason"),
          };
        }}
      >
        <Text>
          {sv ? "Kopierad utkastrevision" : "Copied draft revision"}: {record.revision}
        </Text>
        <InputField
          name="effectiveCycle"
          label={sv ? "Gäller från cykel" : "Effective from cycle"}
          maxLength={18}
          required
        />
        <InputField
          name="components"
          label={
            sv
              ? "Debiteringskomponenter, en per rad, kommaseparerade"
              : "Charge component keys, one per line, comma separated"
          }
          maxLength={3249}
          required
        />
        <InputField
          name="issueDays"
          label={sv ? "Utfärdande: dagar efter cykeldatum" : "Issue: days after cycle date"}
          maxLength={5}
          required
        />
        <InputField
          name="supplyDays"
          label={sv ? "Leveransdatum: dagar efter cykeldatum" : "Supply: days after cycle date"}
          maxLength={5}
          required
        />
        <InputField
          name="dueDays"
          label={sv ? "Förfallodatum: dagar efter cykeldatum" : "Due: days after cycle date"}
          maxLength={5}
          required
        />
        <InputField name="reason" label={sv ? "Orsak" : "Reason"} maxLength={2000} required />
      </CommandForm>
      {saved ? (
        <RecordSummary>
          <RecordFact label={sv ? "Sparad mallrevision" : "Saved template revision"}>
            {saved.revision}
          </RecordFact>
          <RecordFact label={sv ? "Sparad första giltiga cykel" : "Saved effective cycle"}>
            {saved.effectiveFromCycle}
          </RecordFact>
          <RecordFact label={sv ? "Sparade debiteringskomponenter" : "Saved charge components"}>
            {saved.chargeComponentKeys.join(", ")}
          </RecordFact>
          <RecordFact
            label={
              sv
                ? "Sparade datumförskjutningar: utfärdande, leverans, förfallo"
                : "Saved day offsets: issue, supply, due"
            }
          >
            {saved.template.dateOffsets
              ? `${saved.template.dateOffsets.issueDays}, ${saved.template.dateOffsets.supplyDays}, ${saved.template.dateOffsets.dueDays}`
              : "—"}
          </RecordFact>
          <RecordFact label={sv ? "Sparad orsak" : "Saved reason"}>{saved.reason}</RecordFact>
        </RecordSummary>
      ) : null}
    </Box>
  );
}

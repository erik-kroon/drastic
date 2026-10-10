import {
  FormColumn,
  FieldRow,
  FormTitle,
  FormText as Text,
  FormNote,
  InputField,
  SelectField,
  FactsGroup as RecordSummary,
  Fact as RecordFact,
  FormLink as PageAction,
  FormAction as Button,
} from "@open-erp/ui/kanon/form";
import { Action } from "@open-erp/ui/kanon/action";
import { useState, type ReactNode } from "react";
import { defaultStringifySearch } from "@tanstack/react-router";
import { workspacePath } from "@/lib/book-context";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { InvoiceDraftDocument } from "./invoice-draft-document";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

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
    <FormColumn>
      <FieldRow>
        <InputField
          name="anchor"
          type="text"
          placeholder={sv ? "åååå-mm-dd" : "yyyy-mm-dd"}
          pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
          maxLength={10}
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
      </FieldRow>
      <FieldRow>
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
      </FieldRow>
      <FieldRow>
        <SelectField
          name="anchorPolicy"
          label={sv ? "Månadsregel" : "Monthly anchor rule"}
          defaultValue={schedule?.cadence.monthAnchorPolicy ?? "anchor_day_clamped"}
          options={[
            {
              value: "anchor_day_clamped",
              label: sv ? "Startdag, till månadens slut" : "Anchor day, clamped to month end",
            },
            { value: "end_of_month", label: sv ? "Månadens sista dag" : "End of month" },
          ]}
        />
        <InputField
          name="firstCycle"
          label={sv ? "Första cykelnummer" : "First cycle ordinal"}
          defaultValue={schedule?.firstCycleOrdinal ?? "1"}
          pattern="[1-9][0-9]{0,17}"
          maxLength={18}
          required
        />
      </FieldRow>
    </FormColumn>
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
  props: CommerceProps & { work?: string; returnTo?: string; onClose: () => void },
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
    <FormColumn>
      <FormTitle>{sv ? "Skapa återkommande avtal" : "Create recurring agreement"}</FormTitle>
      <Text>
        {sv
          ? "Avtalet sparas utan fakturamall. Välj sedan ett sparat utkast och granska mallen. Ingen faktura utfärdas här."
          : "The agreement creates no invoices until a template and scheduling have been reviewed."}
      </Text>
      <AccountingStatus
        locale={props.locale}
        pending={customers.isPending}
        error={customers.error}
      />
      <CommandForm
        presentation="kanon"
        afterSubmit={
          <Action kind="quiet" onClick={props.onClose}>
            {sv ? "Avbryt" : "Cancel"}
          </Action>
        }
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
        <FieldRow>
          <SelectField
            name="customer"
            label={sv ? "Kund" : "Customer"}
            options={[
              { value: "", label: sv ? "Välj kund" : "Select customer" },
              ...parties.map((party) => ({ value: party.id, label: party.displayName })),
            ]}
            required
          />
          <InputField
            name="title"
            label={sv ? "Avtalsnamn" : "Agreement title"}
            placeholder={sv ? "Skriv avtalsnamn" : "Agreement title"}
            maxLength={200}
            required
          />
        </FieldRow>
        <ScheduleFields locale={props.locale} />
        <InputField
          name="reason"
          label={sv ? "Orsak" : "Reason"}
          placeholder={sv ? "Beskriv varför avtalet skapas" : "Reason for creating the agreement"}
          maxLength={2000}
          required
        />
        <FormNote>
          {sv
            ? "Cykel 1 slutar efter ett intervall. Startdatum är tjänsteperiodens början."
            : "Cycle 1 ends after one interval. The anchor starts the service period."}
        </FormNote>
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
        <FormColumn>
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
        </FormColumn>
      ) : null}
    </FormColumn>
  );
}

export function RecurringAgreementControls(
  props: CommerceProps & {
    agreementId: string;
    mode: "schedule" | "template";
    onClose: () => void;
  },
) {
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

  const customer = useQuery({
    queryKey: [...commerceKey(props.book), "party", agreement.data?.agreement.customerId],
    enabled: agreement.isSuccess,
    queryFn: async ({ signal }) => {
      const id = agreement.data?.agreement.customerId ?? "";

      const value = await readAccounting(
        `${commercePath(props.book)}/counterparties/${encodeURIComponent(id)}`,
        Commerce.CounterpartyRevision,
        { signal },
      );

      checkScope(props.book, value.scope);

      if (value.id !== id) throw new Error("Recurring customer mismatch");

      return value;
    },
    retry: false,
  });

  const current = agreement.isSuccess && agreement.isFetchedAfterMount && !agreement.isFetching;

  return (
    <FormColumn>
      <FormTitle>
        {props.mode === "schedule"
          ? sv
            ? "Ändra framtida schema"
            : "Change future schedule"
          : sv
            ? "Ändra framtida fakturamall"
            : "Change future template"}
      </FormTitle>
      <Text>
        {props.mode === "schedule"
          ? `${agreement.data?.agreement.title ?? ""}, ${customer.data?.displayName ?? ""}. ${sv ? "Ändringen gäller från en framtida cykel. Sparade utkast och utfärdade fakturor behåller sin historik." : "Changes apply from a future cycle. Saved drafts and issued invoices retain their history."}`
          : sv
            ? "Välj ett sparat fakturautkast och granska det innan en ny mallrevision sparas. Tidigare fakturacykler ändras inte."
            : "Choose a saved invoice draft and review it before saving a new template revision. Earlier invoice cycles remain unchanged."}
      </Text>
      <AccountingStatus
        locale={props.locale}
        pending={agreement.isPending}
        error={agreement.error}
      />
      {agreement.data ? (
        <AgreementEdits
          key={`${agreement.data.agreement.id}:${agreement.data.agreement.revision}:${agreement.data.agreement.digest}`}
          {...props}
          agreement={agreement.data.agreement}
          current={current}
          path={path}
        />
      ) : null}
    </FormColumn>
  );
}

function AgreementEdits(
  props: CommerceProps & {
    agreement: Recurring.RecurringAgreement;
    current: boolean;
    path: string;
    mode: "schedule" | "template";
    onClose: () => void;
  },
) {
  const sv = props.locale === "sv";

  const [savedSchedule, setSavedSchedule] = useState<Recurring.RecurringScheduleRevision>();

  const binding = {
    expectedAgreementRevision: props.agreement.revision,
    expectedAgreementDigest: props.agreement.digest,
  };

  return (
    <FormColumn>
      {props.mode === "schedule" ? (
        <FormColumn>
          <CommandForm
            presentation="kanon"
            afterSubmit={
              <Action kind="quiet" onClick={props.onClose}>
                {sv ? "Avbryt" : "Cancel"}
              </Action>
            }
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
            <FieldRow>
              <InputField
                name="effectiveCycle"
                defaultValue="2"
                label={sv ? "Gäller från cykel" : "Effective from cycle"}
                maxLength={18}
                required
              />
              <InputField
                label={sv ? "Sparat avtal" : "Saved agreement"}
                value={props.agreement.title}
                readOnly
              />
            </FieldRow>
            <ScheduleFields locale={props.locale} schedule={props.agreement.schedule} />
            <InputField
              name="reason"
              label={sv ? "Orsak" : "Reason"}
              placeholder={
                sv ? "Beskriv varför schemat ändras" : "Reason for changing the schedule"
              }
              maxLength={2000}
              required
            />
            <FormNote>
              {sv
                ? "Cykel 1 slutar efter ett intervall. Startdatum är tjänsteperiodens början."
                : "Cycle 1 ends after one interval. The anchor starts the service period."}
            </FormNote>
          </CommandForm>
          {savedSchedule ? (
            <FormColumn>
              <Text role="status">
                {sv ? "Sparat schema gäller från cykel" : "Saved schedule applies from cycle"}{" "}
                {savedSchedule.effectiveFromCycle}
              </Text>
              <SavedScheduleFacts locale={props.locale} schedule={savedSchedule.schedule} />
              <Text>{savedSchedule.reason}</Text>
            </FormColumn>
          ) : null}
        </FormColumn>
      ) : (
        <FutureTemplate {...props} binding={binding} />
      )}
    </FormColumn>
  );
}

function FutureTemplate(
  props: CommerceProps & {
    agreement: Recurring.RecurringAgreement;
    current: boolean;
    path: string;
    onClose: () => void;
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

  const sourceSelector = (
    <SelectField
      label={sv ? "Sparat fakturautkast" : "Saved invoice draft"}
      value={draftId}
      onValueChange={setDraftId}
      options={[
        { value: "", label: sv ? "Välj sparat utkast" : "Select saved draft" },
        ...(drafts.data?.pages
          .flatMap((page) => page.items)
          .map((item) => ({ value: item.id, label: `${item.title}, ${item.customerName}` })) ?? []),
      ]}
    />
  );

  return (
    <FormColumn>
      <TemplateRevisionForm
        key={record ? `${record.id}:${record.revision}:${record.digest}` : "empty"}
        {...props}
        record={record}
        sourceSelector={sourceSelector}
        ready={matches && draft.isSuccess && !draft.isFetching && draft.isFetchedAfterMount}
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
    </FormColumn>
  );
}

function TemplateRevisionForm(
  props: CommerceProps & {
    agreement: Recurring.RecurringAgreement;
    current: boolean;
    path: string;
    onClose: () => void;
    binding: Pick<
      Recurring.ProposeRecurringTemplateRevision,
      "expectedAgreementRevision" | "expectedAgreementDigest"
    >;
    record?: typeof Drafts.InvoiceDraftRevision.Type;
    sourceSelector: ReactNode;
    ready: boolean;
  },
) {
  const sv = props.locale === "sv";
  const [record] = useState(props.record);
  const [saved, setSaved] = useState<Recurring.RecurringTemplateRevision>();

  return (
    <FormColumn>
      <CommandForm
        presentation="kanon"
        afterSubmit={
          <Action kind="quiet" onClick={props.onClose}>
            {sv ? "Avbryt" : "Cancel"}
          </Action>
        }
        {...props}
        path={`${props.path}/template-revisions`}
        recoveryId={`${props.agreement.id}:${record?.id ?? "empty"}:${record?.revision ?? "0"}`}
        schema={Recurring.ProposeRecurringTemplateRevision}
        output={Recurring.RecurringTemplateRevision}
        onSuccess={(value) => {
          checkScope(props.book, value.scope);

          if (value.agreementId !== props.agreement.id)
            throw new Error("Saved template agreement mismatch");

          setSaved(value);
        }}
        label={sv ? "Spara framtida mallrevision" : "Save future template revision"}
        allowed={props.book.role === "operator" && props.current}
        canSubmit={props.ready}
        input={(fields) => templateRevisionInput(fields, record, props.binding)}
      >
        <FieldRow>
          {props.sourceSelector}
          <InputField
            label={sv ? "Sparat avtal" : "Saved agreement"}
            value={props.agreement.title}
            readOnly
          />
        </FieldRow>
        <FieldRow>
          <InputField
            name="effectiveCycle"
            label={sv ? "Gäller från cykel" : "Effective from cycle"}
            defaultValue="2"
            maxLength={18}
            required
          />
          <SelectField
            name="components"
            label={sv ? "Rader som ska faktureras" : "Lines to invoice"}
            defaultValue=""
            required
            disabled={!record}
            options={templateComponentOptions(record, sv)}
          />
        </FieldRow>
        <FieldRow>
          <InputField
            name="issueDays"
            label={sv ? "Utfärdande, dagar efter cykeldatum" : "Issue: days after cycle date"}
            defaultValue="0"
            maxLength={5}
            required
          />
          <InputField
            name="supplyDays"
            label={sv ? "Leveransdatum, dagar efter cykeldatum" : "Supply: days after cycle date"}
            defaultValue="0"
            maxLength={5}
            required
          />
        </FieldRow>
        <FieldRow>
          <InputField
            name="dueDays"
            label={sv ? "Förfallodatum, dagar efter cykeldatum" : "Due: days after cycle date"}
            defaultValue="30"
            maxLength={5}
            required
          />
          <InputField
            label={sv ? "Kund i valt underlag" : "Source customer"}
            value={
              record?.counterparty.displayName ??
              (sv ? "Inget underlag valt" : "No source selected")
            }
            readOnly
          />
        </FieldRow>
        <InputField
          name="reason"
          label={sv ? "Orsak" : "Reason"}
          placeholder={
            sv ? "Beskriv varför fakturamallen ändras" : "Reason for changing the template"
          }
          maxLength={2000}
          required
        />
        <FormNote>
          {record
            ? sv
              ? "Granska kunden, raderna, beloppen och datumförskjutningarna i det sparade underlaget."
              : "Review the customer, rows, amounts and date offsets in the saved source."
            : sv
              ? "Inget underlag är valt. Granska kunden, raderna, beloppen och datumförskjutningarna innan du sparar."
              : "No source selected. Review the customer, rows, amounts and date offsets before saving."}
        </FormNote>
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
    </FormColumn>
  );
}

function templateRevisionInput(
  fields: FormData,
  record: typeof Drafts.InvoiceDraftRevision.Type | undefined,
  binding: Pick<
    Recurring.ProposeRecurringTemplateRevision,
    "expectedAgreementRevision" | "expectedAgreementDigest"
  >,
) {
  if (!record) throw new Error("Select a saved invoice draft");

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
      ? {
          ...shared,
          kind: "commercial",
          lines: record.commercialInput.lines.filter((_, index) =>
            components.split(",").includes(`line_${index + 1}`),
          ),
        }
      : {
          ...shared,
          customer: content.customer,
          sourceTotalMinor: content.sourceTotalMinor,
          lines: content.lines,
        };

  return {
    ...binding,
    effectiveFromCycle: fields.get("effectiveCycle"),
    chargeComponentKeys: components
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    template,
    reason: fields.get("reason"),
  };
}

function templateComponentOptions(
  record: typeof Drafts.InvoiceDraftRevision.Type | undefined,
  sv: boolean,
) {
  const options = [{ value: "", label: sv ? "Välj rader från underlaget" : "Select source rows" }];

  if (!record) return options;
  options.push({
    value: record.content.lines.map((_, index) => `line_${index + 1}`).join(","),
    label: sv ? "Alla granskade rader" : "All reviewed rows",
  });

  if (record.purpose === "commercial" && record.content.lines.length > 1)
    options.push(
      ...record.content.lines.map((line, index) => ({
        value: `line_${index + 1}`,
        label: line.description,
      })),
    );

  return options;
}

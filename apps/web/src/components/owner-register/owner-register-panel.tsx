import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Schema from "effect/Schema";
import * as Owners from "@open-erp/contracts/owner-register";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  Field,
  Lookup,
  Pager,
  type CommerceProps,
} from "@/components/commerce/shared";

type Props = CommerceProps;
const words = (locale: Props["locale"], en: string, sv: string) => (locale === "sv" ? sv : en);
const ownerPath = (book: Props["book"]) => `${bookPath(book)}/owner-register`;
const ownerKey = (book: Props["book"]) => [...bookKey(book), "owner-register"];
const textValue = (fields: FormData, name: string) => {
  const value = fields.get(name);
  return typeof value === "string" ? value : "";
};
const revisionInput = (fields: FormData) => ({
  description: fields.get("description"),
  classification: fields.get("classification"),
  origin: fields.get("origin"),
  reason: fields.get("reason"),
});

function OwnerCommand<
  S extends Schema.Top & { readonly DecodingServices: never },
  O extends Schema.Top & { readonly DecodingServices: never },
>(props: Parameters<typeof CommandForm<S, O>>[0]) {
  const client = useQueryClient();
  return (
    <CommandForm
      {...props}
      onSuccess={(result) => {
        void client.invalidateQueries({ queryKey: ownerKey(props.book) });
        props.onSuccess?.(result);
      }}
    />
  );
}
function useOwnerRead<S extends Schema.Top & { readonly DecodingServices: never }>(
  props: Props,
  suffix: string,
  schema: S,
  enabled = true,
) {
  return useQuery({
    queryKey: [...ownerKey(props.book), suffix],
    queryFn: ({ signal }) =>
      readAccounting(`${ownerPath(props.book)}${suffix}`, schema, { signal }),
    enabled,
    retry: false,
  });
}
function Nature({ locale }: Pick<Props, "locale">) {
  return (
    <SelectField
      name="dataNature"
      required
      defaultValue="company_record"
      label={words(locale, "Data nature (immutable)", "Datatyp (oföränderlig)")}
      options={[
        {
          value: "company_record",
          label: words(
            locale,
            "Actual company source — review only",
            "Verkligt företagsunderlag — endast granskning",
          ),
        },
        {
          value: "synthetic_example",
          label: words(
            locale,
            "Genuinely synthetic example — no company facts",
            "Helt syntetiskt exempel — inga företagsuppgifter",
          ),
        },
      ]}
    />
  );
}
function RevisionFields({
  locale,
  value,
}: Pick<Props, "locale"> & { value?: typeof Owners.Revision.Type }) {
  const labels = [
    ["unknown", "Unknown / needs review", "Okänd / behöver granskas"],
    ["owner_expense", "Privately paid company expense", "Privat betald företagsutgift"],
    ["owner_reimbursement", "Owner reimbursement", "Ersättning till ägare"],
    ["shareholder_loan", "Shareholder loan", "Aktieägarlån"],
    ["loan_repayment", "Loan repayment", "Återbetalning av lån"],
    ["conditional_contribution", "Conditional contribution", "Villkorat aktieägartillskott"],
    ["unconditional_contribution", "Unconditional contribution", "Ovillkorat aktieägartillskott"],
  ] as const;
  return (
    <>
      <SelectField
        name="classification"
        required
        defaultValue={value?.classification ?? "unknown"}
        label={words(
          locale,
          "Proposed classification — not a review",
          "Föreslagen klassificering — inte en granskning",
        )}
        options={labels.map(([key, en, sv]) => ({ value: key, label: words(locale, en, sv) }))}
      />
      <SelectField
        name="origin"
        required
        defaultValue={value?.origin ?? "unknown"}
        label={words(locale, "Opening or current movement", "Ingående eller löpande rörelse")}
        options={[
          { value: "unknown", label: words(locale, "Unknown", "Okänd") },
          {
            value: "opening",
            label: words(locale, "Explicit opening source", "Uttryckligt ingående underlag"),
          },
          { value: "current", label: words(locale, "Current movement", "Löpande rörelse") },
        ]}
      />
      <Field
        name="description"
        value={value?.description}
        label={words(locale, "Description", "Beskrivning")}
      />
      <Field
        name="reason"
        label={words(locale, "Reason and review context", "Skäl och granskningsunderlag")}
      />
    </>
  );
}
function EvidenceField({ locale }: Pick<Props, "locale">) {
  return (
    <Field
      name="evidenceId"
      maxLength={128}
      label={words(locale, "Retained evidence ID", "ID för bevarat underlag")}
    />
  );
}
function Refresh({
  locale,
  pending,
  onRefresh,
}: Pick<Props, "locale"> & { pending: boolean; onRefresh: () => void }) {
  return (
    <Box>
      <Button size="xl" variant="outline" disabled={pending} onClick={onRefresh}>
        {words(locale, "Refresh", "Uppdatera")}
      </Button>
    </Box>
  );
}
export function OwnerRegisterPanel(props: Props) {
  return <OwnerWorkspace {...props} key={`${props.book.entityId}:${props.book.id}`} />;
}
function OwnerWorkspace(props: Props) {
  const { locale } = props;
  return (
    <Box as="section" display="grid" gap="xl" minWidth="zero">
      <Heading>
        {words(locale, "Owner expenses and funding", "Ägarutlägg och finansiering")}
      </Heading>
      <Text>
        {words(
          locale,
          "Retain actual sources for review. Company accounting is not activated. Only explicitly synthetic, reviewed sources can attach to the existing journal workflow. No VAT, deductibility, account or equity treatment is inferred.",
          "Bevara verkliga underlag för granskning. Företagets bokföring är inte aktiverad. Endast uttryckligt syntetiska, granskade underlag kan kopplas till befintliga verifikationer. Ingen moms, avdragsrätt, kontoplan eller eget kapital bedöms automatiskt.",
        )}
      </Text>
      <Text tone="muted">
        {words(
          locale,
          "Opening balances and source coverage remain unknown. A contribution does not establish repayment rights. No payment is initiated here.",
          "Ingående balanser och underlagens fullständighet är okända. Ett tillskott innebär inte att återbetalningsrätt har fastställts. Inga betalningar startas här.",
        )}
      </Text>
      <Details title={words(locale, "1. Owner identities", "1. Ägaridentiteter")}>
        <OwnerIdentities {...props} />
      </Details>
      <Details
        title={words(
          locale,
          "2. Sources and classification review",
          "2. Underlag och klassificering",
        )}
      >
        <OwnerRecords {...props} />
      </Details>
      <Details
        title={words(
          locale,
          "3. Reimbursement and loan allocation",
          "3. Fördelning av ersättning och lån",
        )}
      >
        <OwnerAllocations {...props} />
      </Details>
      <Details
        title={words(
          locale,
          "4. Opening and movement controls",
          "4. Kontroller av ingående belopp och rörelser",
        )}
      >
        <OwnerControls {...props} />
      </Details>
      <Details title={words(locale, "Recover a saved command", "Återställ ett sparat kommando")}>
        <OwnerRecovery {...props} />
      </Details>
    </Box>
  );
}
function OwnerIdentities(props: Props) {
  const { book, locale } = props;
  const [after, setAfter] = useState("");
  const [id, setId] = useState("");
  const page = useOwnerRead(
    props,
    `/owners${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    Owners.OwnerPage,
  );
  const detail = useOwnerRead(props, `/owners/${encodeURIComponent(id)}`, Owners.Owner, !!id);
  return (
    <Box display="grid" gap="lg">
      <OwnerCommand
        {...props}
        path={`${ownerPath(book)}/owners`}
        schema={Owners.CreateOwner}
        output={Owners.Owner}
        label={words(locale, "Retain owner identity", "Bevara ägaridentitet")}
        input={(fields) => ({
          sourceKey: fields.get("sourceKey"),
          displayName: fields.get("displayName"),
          dataNature: fields.get("dataNature"),
          evidenceId: fields.get("evidenceId"),
          reason: fields.get("reason"),
        })}
        onSuccess={(value) => setId(value.id)}
      >
        <Field
          name="sourceKey"
          maxLength={200}
          label={words(locale, "Stable owner source identity", "Stabil ägaridentitet från källan")}
        />
        <Field
          name="displayName"
          maxLength={200}
          label={words(locale, "Owner name as supplied", "Ägarens angivna namn")}
        />
        <Nature locale={locale} />
        <EvidenceField locale={locale} />
        <Field
          name="reason"
          label={words(
            locale,
            "Identity evidence and context",
            "Identitetsunderlag och sammanhang",
          )}
        />
      </OwnerCommand>
      <Lookup label={words(locale, "Open saved owner ID", "Öppna sparat ägar-ID")} onOpen={setId} />
      <AccountingStatus locale={locale} pending={!!id && detail.isPending} error={detail.error} />
      {detail.data ? (
        <>
          <Text>
            {detail.data.displayName} · {detail.data.id} · {detail.data.dataNature}
          </Text>
          <Evidence {...props} reference={detail.data.evidence} />
          <Facts
            title={words(
              locale,
              "Retained identity (not legally verified)",
              "Bevarad identitet (inte rättsligt verifierad)",
            )}
            value={detail.data}
          />
        </>
      ) : null}
      <Refresh
        locale={locale}
        pending={page.isFetching}
        onRefresh={() => {
          void page.refetch();
          if (id) void detail.refetch();
        }}
      />
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.data?.items.map((owner) => (
        <Box key={owner.id}>
          <Button size="xl" variant="outline" onClick={() => setId(owner.id)}>
            {owner.displayName} · {owner.id}
          </Button>
        </Box>
      ))}
      <Pager locale={locale} first={!after} next={page.data?.next} onPage={setAfter} />
    </Box>
  );
}
function OwnerRecords(props: Props) {
  const { book, locale } = props;
  const [after, setAfter] = useState("");
  const [id, setId] = useState("");
  const page = useOwnerRead(
    props,
    `/records${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    Owners.RecordPage,
  );
  return (
    <Box display="grid" gap="lg">
      <Details title={words(locale, "Retain a source", "Bevara ett underlag")}>
        <Text>
          {words(
            locale,
            "Owner, source identity, original evidence/locator, date, amount and currency cannot be rewritten. Check them before sending. Leave classification and origin unknown when facts are missing. Counterparty fields may both stay empty.",
            "Ägare, källidentitet, ursprungligt underlag, delnyckel, datum, belopp och valuta kan inte skrivas om. Kontrollera dem innan du skickar. Lämna klassificering och ursprung okända när uppgifter saknas. Båda motpartsfälten kan lämnas tomma.",
          )}
        </Text>
        <OwnerCommand
          {...props}
          path={`${ownerPath(book)}/records`}
          schema={Owners.CreateRecord}
          output={Owners.RecordView}
          label={words(locale, "Retain source for review", "Bevara underlag för granskning")}
          onSuccess={(value) => setId(value.source.id)}
          input={(fields) => ({
            ownerId: fields.get("ownerId"),
            dataNature: fields.get("dataNature"),
            sourceKey: fields.get("sourceKey"),
            sourceKind: fields.get("sourceKind"),
            evidenceId: fields.get("evidenceId"),
            locator: fields.get("locator"),
            occurredOn: fields.get("occurredOn"),
            currency: fields.get("currency"),
            currencyScale: Number(fields.get("currencyScale")),
            amountMinor: fields.get("amountMinor"),
            counterparty:
              textValue(fields, "counterpartyKey") || textValue(fields, "counterpartyName")
                ? {
                    sourceKey: fields.get("counterpartyKey"),
                    displayName: fields.get("counterpartyName"),
                  }
                : null,
            ...revisionInput(fields),
          })}
        >
          <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
            <Field
              name="ownerId"
              maxLength={128}
              label={words(locale, "Retained owner ID", "Bevarat ägar-ID")}
            />
            <Nature locale={locale} />
            <Field
              name="sourceKey"
              maxLength={200}
              label={words(
                locale,
                "Stable source occurrence ID",
                "Stabil identitet för källhändelsen",
              )}
            />
            <SelectField
              name="sourceKind"
              required
              label={words(locale, "Source kind", "Underlagstyp")}
              defaultValue="expense"
              options={[
                {
                  value: "expense",
                  label: words(locale, "Privately paid expense", "Privat betald utgift"),
                },
                {
                  value: "funding",
                  label: words(locale, "Funding received", "Mottagen finansiering"),
                },
                {
                  value: "settlement",
                  label: words(
                    locale,
                    "Reimbursement or repayment sent",
                    "Skickad ersättning eller återbetalning",
                  ),
                },
              ]}
            />
            <EvidenceField locale={locale} />
            <Field
              name="locator"
              maxLength={128}
              label={words(
                locale,
                "Stable source component / kernel event key",
                "Stabil delnyckel i underlaget / händelsenyckel",
              )}
            />
            <Field
              name="occurredOn"
              type="date"
              label={words(locale, "Original occurrence date", "Ursprungligt händelsedatum")}
            />
            <Field
              name="currency"
              maxLength={3}
              label={words(
                locale,
                "Original currency (three letters)",
                "Ursprunglig valuta (tre bokstäver)",
              )}
            />
            <InputField
              name="currencyScale"
              label={words(
                locale,
                "Original currency scale (0–6)",
                "Ursprunglig valutaskala (0–6)",
              )}
              required
              pattern="[0-6]"
              maxLength={1}
              autoComplete="off"
            />
            <Field
              name="amountMinor"
              maxLength={38}
              label={words(
                locale,
                "Exact positive amount in minor units",
                "Exakt positivt belopp i minsta valutaenhet",
              )}
            />
            <InputField
              name="counterpartyKey"
              label={words(
                locale,
                "Counterparty source ID (optional)",
                "Motpartens käll-ID (valfritt)",
              )}
              maxLength={200}
              autoComplete="off"
            />
            <InputField
              name="counterpartyName"
              label={words(locale, "Counterparty name (optional)", "Motpartens namn (valfritt)")}
              maxLength={200}
              autoComplete="off"
            />
          </Box>
          <RevisionFields locale={locale} />
        </OwnerCommand>
      </Details>
      <Lookup
        label={words(locale, "Open saved source ID", "Öppna sparat underlags-ID")}
        onOpen={setId}
      />
      {id ? <OwnerRecordDetail {...props} key={id} id={id} /> : null}
      <Refresh
        locale={locale}
        pending={page.isFetching}
        onRefresh={() => {
          void page.refetch();
        }}
      />
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.data ? (
        <DataTable
          title={words(locale, "Retained sources", "Bevarade underlag")}
          narrow="stack"
          columns={[
            { id: "source", label: words(locale, "Source", "Underlag") },
            {
              id: "amount",
              label: words(
                locale,
                "Original amount / currency / scale",
                "Ursprungligt belopp / valuta / skala",
              ),
              numeric: true,
            },
            { id: "review", label: words(locale, "Review", "Granskning") },
            { id: "open", label: words(locale, "Open", "Öppna") },
          ]}
          rows={page.data.items.map((record) => ({
            id: record.source.id,
            cells: [
              `${record.source.ownerName} · ${record.source.sourceKey}`,
              `${record.source.amountMinor} ${record.source.currency} / ${record.source.currencyScale}`,
              `${record.currentRevision.classification} · ${record.review ? words(locale, "Operator reviewed", "Operatörsgranskad") : words(locale, "Not reviewed", "Inte granskad")}`,
              <Button size="xl" variant="outline" onClick={() => setId(record.source.id)}>
                {record.source.id}
              </Button>,
            ],
          }))}
        />
      ) : null}
      <Pager locale={locale} first={!after} next={page.data?.next} onPage={setAfter} />
    </Box>
  );
}
function OwnerRecordDetail(props: Props & { id: string }) {
  const { locale, id } = props;
  const [after, setAfter] = useState("");
  const view = useOwnerRead(props, `/records/${encodeURIComponent(id)}`, Owners.RecordView);
  const history = useOwnerRead(
    props,
    `/records/${encodeURIComponent(id)}/revisions${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    Owners.RecordHistory,
  );
  const ready = view.isSuccess && !view.isFetching;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{words(locale, "Source review", "Granskning av underlag")}</Heading>
      <Text>{id}</Text>
      <Refresh
        locale={locale}
        pending={view.isFetching}
        onRefresh={() => {
          void view.refetch();
          void history.refetch();
        }}
      />
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {view.data ? (
        <>
          <Text>
            {view.data.currentRevision.description} · {view.data.source.amountMinor}{" "}
            {view.data.source.currency} / {view.data.source.currencyScale}
          </Text>
          <Text>
            {words(locale, "Classification / origin:", "Klassificering / ursprung:")}{" "}
            {view.data.currentRevision.classification} / {view.data.currentRevision.origin}
          </Text>
          <Text>
            {words(locale, "Review status:", "Granskningsstatus:")}{" "}
            {view.data.review
              ? words(
                  locale,
                  "Operator review retained; this is not company activation.",
                  "Operatörsgranskning bevarad; detta aktiverar inte företagets bokföring.",
                )
              : words(locale, "Not reviewed", "Inte granskad")}
          </Text>
          {view.data.blockers.map((blocker) => (
            <Text key={blocker}>{blocker}</Text>
          ))}
          <EvidenceInspector
            {...props}
            reference={{ ...view.data.source.evidence, locator: view.data.source.locator }}
          />
          <Facts
            title={words(
              locale,
              "Exact source, reviews and posted references",
              "Exakt underlag, granskningar och bokförda referenser",
            )}
            value={view.data}
          />
          <RecordActions {...props} value={view.data} ready={ready} />
          {view.data.effect ? (
            <Text>
              {words(
                locale,
                "Posted effect / allocated / remaining minor units:",
                "Bokförd effekt / fördelat / återstående i minsta valutaenhet:",
              )}{" "}
              {view.data.effect.id} · {view.data.allocatedMinor} / {view.data.remainingMinor}.{" "}
              {words(
                locale,
                "Contribution residuals are not repayment entitlements.",
                "Återstående tillskott innebär inte återbetalningsrätt.",
              )}
            </Text>
          ) : null}
        </>
      ) : null}
      <Details
        title={words(locale, "Immutable revision history", "Oföränderlig revisionshistorik")}
      >
        <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
        {history.data?.items.map((item) => (
          <Facts
            key={item.revision.revision}
            title={`${words(locale, "Revision", "Revision")} ${item.revision.revision}`}
            value={item}
          />
        ))}
        <Pager locale={locale} first={!after} next={history.data?.next} onPage={setAfter} />
      </Details>
    </Box>
  );
}
function RecordActions(
  props: Props & { id: string; value: typeof Owners.RecordView.Type; ready: boolean },
) {
  const { book, locale, id, value } = props;
  const ready = props.ready;
  const [baseline, setBaseline] = useState(value.currentRevision);
  const [reviewBaseline, setReviewBaseline] = useState(value.currentRevision);
  const base = `${ownerPath(book)}/records/${encodeURIComponent(id)}`;
  return (
    <>
      <Details
        title={words(locale, "Append classification revision", "Lägg till klassificeringsrevision")}
      >
        <OwnerCommand
          {...props}
          path={`${base}/revisions`}
          schema={Owners.ReviseRecord}
          output={Owners.RecordView}
          label={words(locale, "Append revision", "Lägg till revision")}
          allowed={ready && !value.effect}
          onNewCommand={() => setBaseline(value.currentRevision)}
          input={(fields) => ({
            ...revisionInput(fields),
            expectedRevision: fields.get("expectedRevision"),
            evidenceId: fields.get("evidenceId"),
          })}
        >
          <Field
            name="expectedRevision"
            value={baseline.revision}
            label={words(locale, "Exact prior revision", "Exakt föregående revision")}
          />
          <RevisionFields locale={locale} value={baseline} />
          <EvidenceField locale={locale} />
        </OwnerCommand>
      </Details>
      {book.role === "operator" ? (
        <Details
          title={words(
            locale,
            "Record operator classification review",
            "Registrera operatörens klassificeringsgranskning",
          )}
        >
          <OwnerCommand
            {...props}
            path={`${base}/reviews`}
            schema={Owners.ReviewRecord}
            output={Owners.Review}
            onNewCommand={() => setReviewBaseline(value.currentRevision)}
            label={words(locale, "Retain exact review", "Bevara exakt granskning")}
            allowed={ready && !value.review && !value.effect}
            input={(fields) => ({
              expectedRevision: fields.get("expectedRevision"),
              revisionDigest: fields.get("revisionDigest"),
              controlAccountId: textValue(fields, "controlAccountId") || null,
              syntheticNoTaxConfirmed: fields.get("syntheticNoTaxConfirmed") === "on",
              evidenceId: fields.get("evidenceId"),
              reason: fields.get("reason"),
            })}
          >
            <Facts
              title={words(
                locale,
                "Exact revision being reviewed (use Start a new command to load a newer revision)",
                "Exakt revision som granskas (välj Starta nytt kommando för att läsa in en nyare revision)",
              )}
              value={reviewBaseline}
            />
            <Field
              name="expectedRevision"
              value={reviewBaseline.revision}
              label={words(locale, "Reviewed revision", "Granskad revision")}
            />
            <Field
              name="revisionDigest"
              value={reviewBaseline.digest}
              label={words(locale, "Exact revision digest", "Exakt revisionshash")}
            />
            <InputField
              name="controlAccountId"
              label={words(
                locale,
                "Explicit control account ID (empty if unresolved)",
                "Uttryckligt kontrollkonto-ID (tomt om oklart)",
              )}
              maxLength={128}
              autoComplete="off"
            />
            <Box as="label" display="flex" gap="md" alignItems="start">
              <input type="checkbox" name="syntheticNoTaxConfirmed" />
              <span>
                {words(
                  locale,
                  "This is genuinely synthetic and its example has no tax treatment. Never select this for actual company facts.",
                  "Detta är helt syntetiskt och exemplet saknar skattebehandling. Välj aldrig detta för verkliga företagsuppgifter.",
                )}
              </span>
            </Box>
            <EvidenceField locale={locale} />
            <Field
              name="reason"
              label={words(
                locale,
                "Classification decision and supporting basis",
                "Klassificeringsbeslut och beslutsunderlag",
              )}
            />
            <Box as="label" display="flex" gap="md" alignItems="start">
              <input type="checkbox" required />
              <span>
                {words(
                  locale,
                  "I reviewed this exact source, classification, origin and account. Unknown company facts remain unresolved.",
                  "Jag har granskat exakt detta underlag, dess klassificering, ursprung och konto. Okända företagsuppgifter är fortfarande olösta.",
                )}
              </span>
            </Box>
          </OwnerCommand>
        </Details>
      ) : (
        <Text>
          {words(
            locale,
            "Only an operator can record the classification review.",
            "Endast en operatör kan registrera klassificeringsgranskningen.",
          )}
        </Text>
      )}
      <Details
        title={words(
          locale,
          "Attach existing synthetic kernel references",
          "Koppla befintliga syntetiska bokföringsreferenser",
        )}
      >
        <Text>
          {words(
            locale,
            "Use the journal workbench with the original evidence ID and stable source component as event key. Supply exact accounts and amounts yourself. Attach its proposal here before ordinary kernel approval/execution. After posting, attach the exact posted control line. No second recognition is created.",
            "Använd verifikationsvyn med ursprungligt underlags-ID och stabil delnyckel som händelsenyckel. Ange exakta konton och belopp själv. Koppla förslaget här före vanlig attest och bokföring. Koppla därefter exakt bokförd kontrollrad. Ingen andra bokföring skapas.",
          )}
        </Text>
        <OwnerCommand
          {...props}
          path={`${base}/proposals`}
          schema={Owners.AttachProposal}
          output={Owners.ProposalLink}
          label={words(locale, "Attach reviewed proposal", "Koppla granskat förslag")}
          allowed={ready && !value.effect && value.blockers.length === 0}
          input={(fields) => ({
            reviewId: fields.get("reviewId"),
            changeSetId: fields.get("changeSetId"),
            lineId: fields.get("lineId"),
          })}
        >
          <Field
            name="reviewId"
            value={value.review?.id}
            label={words(
              locale,
              "Exact classification review ID",
              "Exakt klassificeringsgransknings-ID",
            )}
          />
          <Field
            name="changeSetId"
            label={words(locale, "Existing kernel proposal ID", "Befintligt förslags-ID")}
          />
          <Field
            name="lineId"
            label={words(locale, "Proposal control-line ID", "Förslagets kontrollrad-ID")}
          />
        </OwnerCommand>
        <OwnerCommand
          {...props}
          path={`${base}/posted-lines`}
          schema={Owners.AttachPostedLine}
          output={Owners.PostedEffect}
          label={words(locale, "Attach existing posted line", "Koppla befintlig bokförd rad")}
          allowed={ready && !value.effect && value.blockers.length === 0}
          input={(fields) => ({
            reviewId: fields.get("reviewId"),
            voucherId: fields.get("voucherId"),
            lineId: fields.get("lineId"),
          })}
        >
          <Field
            name="reviewId"
            value={value.review?.id}
            label={words(
              locale,
              "Exact classification review ID",
              "Exakt klassificeringsgransknings-ID",
            )}
          />
          <Field
            name="voucherId"
            label={words(locale, "Posted voucher ID", "Bokfört verifikations-ID")}
          />
          <Field
            name="lineId"
            label={words(locale, "Posted control-line ID", "Bokförd kontrollrad-ID")}
          />
        </OwnerCommand>
      </Details>
    </>
  );
}

function OwnerAllocations(props: Props) {
  const { book, locale } = props;
  const [id, setId] = useState("");
  const [legs, setLegs] = useState([0]);
  const [nextLeg, setNextLeg] = useState(1);
  return (
    <Box display="grid" gap="lg">
      <Text>
        {words(
          locale,
          "Use posted owner effect IDs, not invoice IDs or bank rows. Reimbursements allocate only expense claims; loan repayments allocate only loans. Owner, account, currency and timing must agree. Contributions cannot use this flow.",
          "Använd ID:n för bokförda ägareffekter, inte faktura-ID:n eller bankrader. Ersättningar fördelas endast mot utlägg; låneåterbetalningar endast mot lån. Ägare, konto, valuta och tidpunkt måste stämma. Tillskott kan inte använda detta flöde.",
        )}
      </Text>
      <OwnerCommand
        {...props}
        path={`${ownerPath(book)}/allocation-plans`}
        schema={Owners.PrepareAllocation}
        output={Owners.AllocationPlan}
        label={words(locale, "Prepare allocation", "Förbered fördelning")}
        onSuccess={(plan) => setId(plan.id)}
        input={(fields) => ({
          settlementId: fields.get("settlementId"),
          evidenceId: fields.get("evidenceId"),
          rationale: fields.get("rationale"),
          allocations: legs.map((leg) => ({
            claimId: fields.get(`claim-${leg}`),
            amountMinor: fields.get(`amount-${leg}`),
          })),
        })}
      >
        <Field
          name="settlementId"
          label={words(
            locale,
            "Posted reimbursement / loan repayment effect ID",
            "ID för bokförd ersättning / låneåterbetalning",
          )}
        />
        {legs.map((leg, index) => (
          <Box
            as="fieldset"
            key={leg}
            display="grid"
            gap="md"
            minWidth="zero"
            borderWidth="thin"
            borderColor="default"
            padding="md"
            margin="none"
          >
            <legend>
              {words(locale, "Claim", "Fordran")} {index + 1}
            </legend>
            <Field
              name={`claim-${leg}`}
              label={words(
                locale,
                "Posted expense / loan claim effect ID",
                "ID för bokfört utlägg / lån",
              )}
            />
            <Field
              name={`amount-${leg}`}
              maxLength={38}
              label={words(
                locale,
                "Exact allocation minor units",
                "Exakt fördelning i minsta valutaenhet",
              )}
            />
            <Box>
              <Button
                type="button"
                size="xl"
                variant="outline"
                disabled={legs.length === 1}
                onClick={() => setLegs((current) => current.filter((value) => value !== leg))}
              >
                {words(locale, "Remove claim", "Ta bort fordran")} {index + 1}
              </Button>
            </Box>
          </Box>
        ))}
        <Box>
          <Button
            type="button"
            size="xl"
            variant="outline"
            disabled={legs.length >= 50}
            onClick={() => {
              setLegs((current) => [...current, nextLeg]);
              setNextLeg((current) => current + 1);
            }}
          >
            {words(locale, "Add claim (maximum 50)", "Lägg till fordran (högst 50)")}
          </Button>
        </Box>
        <EvidenceField locale={locale} />
        <Field
          name="rationale"
          label={words(locale, "Allocation rationale", "Skäl för fördelning")}
        />
      </OwnerCommand>
      <Lookup
        label={words(locale, "Open saved allocation plan ID", "Öppna sparat fördelningsförslag")}
        onOpen={setId}
      />
      {id ? <OwnerAllocationReview {...props} key={id} id={id} /> : null}
    </Box>
  );
}
function OwnerAllocationReview(props: Props & { id: string }) {
  const { book, locale, id } = props;
  const view = useOwnerRead(
    props,
    `/allocation-plans/${encodeURIComponent(id)}`,
    Owners.AllocationView,
  );
  const plan = view.data?.plan;
  const approval = view.data?.approval;
  const actionable =
    view.isSuccess && !view.isFetching && view.data.dependenciesCurrent && !view.data.application;
  return (
    <Box display="grid" gap="lg">
      <Refresh
        locale={locale}
        pending={view.isFetching}
        onRefresh={() => {
          void view.refetch();
        }}
      />
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {plan ? (
        <>
          <Text>
            {words(locale, "Exact plan digest:", "Exakt förslagshash:")} {plan.digest}
          </Text>
          <Text>
            {words(
              locale,
              "Total / unallocated settlement after (minor units):",
              "Totalt / ofördelad ersättning efter (minsta valutaenhet):",
            )}{" "}
            {plan.totalMinor} / {plan.settlementRemainingAfterMinor} ·{" "}
            {plan.settlement.effect.currency} / {plan.settlement.effect.currencyScale}
          </Text>
          <Text>{plan.input.rationale}</Text>
          <Text>
            {actionable
              ? words(
                  locale,
                  "Current proposal. The server rechecks every capacity before applying.",
                  "Aktuellt förslag. Servern kontrollerar all kapacitet igen före tillämpning.",
                )
              : words(
                  locale,
                  "Not actionable: refresh, inspect a receipt, or prepare a new plan after dependencies change.",
                  "Kan inte tillämpas: uppdatera, kontrollera kvittot eller skapa ett nytt förslag efter ändrade beroenden.",
                )}
          </Text>
          <Evidence {...props} reference={plan.evidence} />
          <DataTable
            title={words(locale, "Every selected claim", "Alla valda fordringar")}
            narrow="stack"
            columns={[
              { id: "claim", label: words(locale, "Claim effect", "Fordringseffekt") },
              {
                id: "before",
                label: words(locale, "Remaining before", "Återstående före"),
                numeric: true,
              },
              { id: "amount", label: words(locale, "Allocate", "Fördela"), numeric: true },
              {
                id: "after",
                label: words(locale, "Remaining after", "Återstående efter"),
                numeric: true,
              },
            ]}
            rows={plan.legs.map((leg) => ({
              id: leg.claim.effect.id,
              cells: [
                leg.claim.effect.id,
                leg.claim.remainingMinor,
                leg.amountMinor,
                leg.remainingAfterMinor,
              ],
            }))}
          />
          <Facts
            title={words(
              locale,
              "Exact source, all legs and approval",
              "Exakt underlag, samtliga delar och attest",
            )}
            value={view.data}
          />
          {plan.legs.map((leg) => (
            <Details key={leg.claim.effect.id} title={leg.claim.effect.id}>
              <EvidenceInspector
                {...props}
                reference={{ ...leg.claim.effect.evidence, locator: leg.claim.effect.locator }}
              />
            </Details>
          ))}
          {book.role === "operator" ? (
            <OwnerCommand
              {...props}
              path={`${ownerPath(book)}/allocation-plans/${encodeURIComponent(id)}/approvals`}
              schema={Owners.ApproveAllocation}
              output={Owners.AllocationApproval}
              label={words(
                locale,
                "Approve exact allocation for one hour",
                "Godkänn exakt fördelning i en timme",
              )}
              allowed={actionable}
              input={() => ({ version: plan.version, planDigest: plan.digest })}
            >
              <Box as="label" display="flex" gap="md" alignItems="start">
                <input type="checkbox" required />
                <span>
                  {words(
                    locale,
                    "I reviewed this digest, all source evidence, claim amounts and the settlement remainder. This authorizes only allocation, not payment or posting.",
                    "Jag har granskat denna hash, samtliga underlag, fordringsbelopp och återstående ersättning. Detta godkänner bara fördelning, inte betalning eller bokföring.",
                  )}
                </span>
              </Box>
            </OwnerCommand>
          ) : null}
          <OwnerCommand
            {...props}
            path={`${ownerPath(book)}/allocation-plans/${encodeURIComponent(id)}/apply`}
            schema={Owners.ApplyAllocation}
            output={Owners.AllocationReceipt}
            label={words(
              locale,
              "Apply exact approved allocation",
              "Tillämpa exakt godkänd fördelning",
            )}
            allowed={actionable && !!approval && Date.parse(approval.expiresAt) > Date.now()}
            input={(fields) => ({
              version: plan.version,
              planDigest: plan.digest,
              approvalId: fields.get("approvalId"),
            })}
          >
            <Field
              name="approvalId"
              value={approval?.id}
              label={words(locale, "Exact operator approval ID", "Exakt operatörsattest-ID")}
            />
          </OwnerCommand>
          {view.data?.application ? (
            <Text role="status">
              {words(
                locale,
                "Allocation recorded without posting or payment.",
                "Fördelning registrerad utan bokföring eller betalning.",
              )}{" "}
              {view.data.application.id}
            </Text>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
function OwnerControls(props: Props) {
  const { book, locale } = props;
  const [id, setId] = useState("");
  const view = useOwnerRead(props, `/controls/${encodeURIComponent(id)}`, Owners.ControlView, !!id);
  const snapshot = view.data?.snapshot;
  return (
    <Box display="grid" gap="lg">
      <Text>
        {words(
          locale,
          "A snapshot freezes the registered subset through its cutoff. Opening balance is unknown, not zero. Registered opening, earlier current movements and this interval stay separate. Ledger controls include all registered owners on each account; a zero difference does not prove completeness.",
          "En ögonblicksbild fryser den registrerade delmängden till brytdatumet. Ingående balans är okänd, inte noll. Registrerat ingående belopp, tidigare löpande rörelser och detta intervall hålls isär. Huvudbokskontroller omfattar alla registrerade ägare på varje konto; noll i differens bevisar inte fullständighet.",
        )}
      </Text>
      <OwnerCommand
        {...props}
        path={`${ownerPath(book)}/controls`}
        schema={Owners.PrepareControl}
        output={Owners.Control}
        label={words(locale, "Freeze owner control", "Frys ägarkontroll")}
        onSuccess={(value) => setId(value.id)}
        input={(fields) => ({
          ownerId: fields.get("ownerId"),
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
        })}
      >
        <Field name="ownerId" label={words(locale, "Retained owner ID", "Bevarat ägar-ID")} />
        <Field
          name="startsOn"
          type="date"
          label={words(locale, "Interval starts", "Intervallets början")}
        />
        <Field
          name="endsOn"
          type="date"
          label={words(locale, "As-of date (inclusive)", "Brytdatum (inklusive)")}
        />
      </OwnerCommand>
      <Lookup
        label={words(locale, "Open saved control ID", "Öppna sparat kontroll-ID")}
        onOpen={setId}
      />
      {id ? (
        <>
          <Refresh
            locale={locale}
            pending={view.isFetching}
            onRefresh={() => {
              void view.refetch();
            }}
          />
          <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
        </>
      ) : null}
      {snapshot ? (
        <>
          <Text>
            {snapshot.owner.displayName} · {snapshot.startsOn} — {snapshot.endsOn} ·{" "}
            {snapshot.currency} / {snapshot.currencyScale}
          </Text>
          <Text>
            {words(
              locale,
              "Complete opening balance: unknown. Unlinked source count:",
              "Fullständig ingående balans: okänd. Antal underlag utan bokförd koppling:",
            )}{" "}
            {snapshot.unlinkedRecordCount}
          </Text>
          <Text>
            {view.data?.current
              ? words(
                  locale,
                  "Snapshot sources remain current.",
                  "Ögonblicksbildens underlag är aktuella.",
                )
              : words(
                  locale,
                  "Sources changed. Keep this historical snapshot and prepare a new one.",
                  "Underlagen har ändrats. Behåll denna historiska bild och skapa en ny.",
                )}
          </Text>
          <DataTable
            title={words(
              locale,
              "Owner's registered balances — incomplete coverage",
              "Ägarens registrerade saldon — ofullständig täckning",
            )}
            narrow="stack"
            columns={[
              { id: "account", label: words(locale, "Account", "Konto") },
              {
                id: "net",
                label: words(
                  locale,
                  "Net credit (includes contributions)",
                  "Nettokredit (inklusive tillskott)",
                ),
                numeric: true,
              },
              {
                id: "expenses",
                label: words(locale, "Unallocated expense claims", "Ofördelade utlägg"),
                numeric: true,
              },
              {
                id: "loans",
                label: words(locale, "Unallocated loan claims", "Ofördelade lånefordringar"),
                numeric: true,
              },
              {
                id: "reimbursement",
                label: words(locale, "Unapplied reimbursements", "Ej fördelade ersättningar"),
                numeric: true,
              },
              {
                id: "repayment",
                label: words(
                  locale,
                  "Unapplied loan repayments",
                  "Ej fördelade låneåterbetalningar",
                ),
                numeric: true,
              },
            ]}
            rows={snapshot.ownerBalances.map((row) => ({
              id: row.accountId,
              cells: [
                row.accountId,
                row.recordedNetCreditMinor,
                row.openExpenseMinor,
                row.openLoanMinor,
                row.unappliedReimbursementMinor,
                row.unappliedLoanRepaymentMinor,
              ],
            }))}
          />
          <DataTable
            title={words(
              locale,
              "Recorded movements by classification",
              "Registrerade rörelser per klassificering",
            )}
            narrow="stack"
            columns={[
              {
                id: "class",
                label: words(locale, "Account / classification", "Konto / klassificering"),
              },
              {
                id: "opening",
                label: words(
                  locale,
                  "Registered opening only",
                  "Endast registrerat ingående belopp",
                ),
                numeric: true,
              },
              {
                id: "prior",
                label: words(locale, "Prior current", "Tidigare löpande"),
                numeric: true,
              },
              {
                id: "current",
                label: words(locale, "Current interval", "Aktuellt intervall"),
                numeric: true,
              },
              {
                id: "closing",
                label: words(locale, "Recorded closing only", "Endast registrerat utgående belopp"),
                numeric: true,
              },
            ]}
            rows={snapshot.movements.map((row) => ({
              id: `${row.accountId}:${row.classification}`,
              cells: [
                `${row.accountId} / ${row.classification}`,
                row.registeredOpeningMinor,
                row.priorCurrentMinor,
                row.currentMovementMinor,
                row.recordedClosingMinor,
              ],
            }))}
          />
          <DataTable
            title={words(
              locale,
              "Account control — all registered owners",
              "Kontokontroll — alla registrerade ägare",
            )}
            narrow="stack"
            columns={[
              { id: "account", label: words(locale, "Account", "Konto") },
              {
                id: "registered",
                label: words(locale, "Registered credit balance", "Registrerad kreditbalans"),
                numeric: true,
              },
              {
                id: "ledger",
                label: words(locale, "Ledger credit balance", "Huvudbokens kreditbalans"),
                numeric: true,
              },
              {
                id: "difference",
                label: words(locale, "Unexplained difference", "Oförklarad differens"),
                numeric: true,
              },
            ]}
            rows={snapshot.accountControls.map((row) => ({
              id: row.accountId,
              cells: [
                row.accountId,
                row.allOwnersRegisteredMinor,
                row.ledgerCreditBalanceMinor,
                row.unexplainedMinor,
              ],
            }))}
          />
          <Text>
            {words(
              locale,
              "All amounts are exact minor units in the linked book currency. Repayment debits and contribution credits remain separate classes; these are not legal amounts owed.",
              "Alla belopp är exakta minsta valutaenheter i den kopplade bokens valuta. Återbetalningsdebiteringar och tillskottskrediter förblir separata klasser; detta är inte rättsligt fastställda skulder.",
            )}
          </Text>
          <Facts
            title={words(
              locale,
              "Frozen digest, sources, effects and allocation legs",
              "Fryst hash, underlag, effekter och fördelningsdelar",
            )}
            value={snapshot}
          />
          <Box>
            <Button
              size="xl"
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `owner-control-${snapshot.id}.json`;
                document.body.append(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
              }}
            >
              {words(locale, "Save frozen control JSON", "Spara fryst kontroll som JSON")}
            </Button>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
function OwnerRecovery(props: Props) {
  const { locale } = props;
  const [key, setKey] = useState("");
  const result = useOwnerRead(
    props,
    `/commands/${encodeURIComponent(key)}`,
    Owners.CommandRecovery,
    !!key,
  );
  return (
    <Box display="grid" gap="lg">
      <Text>
        {words(
          locale,
          "Save the request key before sending. This reads a committed receipt using the same actor and book; it does not repeat the command. No automatic browser persistence exists. A missing receipt is not proof that an in-flight request cannot still commit. Retry only the exact original fields and key.",
          "Spara kommandonyckeln innan du skickar. Detta läser ett sparat kvitto med samma användare och bok; kommandot upprepas inte. Webbläsaren sparar inte automatiskt. Ett saknat kvitto bevisar inte att ett pågående anrop inte kan slutföras. Försök endast igen med exakt samma fält och nyckel.",
        )}
      </Text>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          setKey(textValue(new FormData(event.currentTarget), "key"));
        }}
      >
        <InputField
          name="key"
          label={words(locale, "Exact saved request key", "Exakt sparad kommandonyckel")}
          required
          pattern="[a-zA-Z0-9_-]{8,128}"
          minLength={8}
          maxLength={128}
          autoComplete="off"
        />
        <Box>
          <Button type="submit" size="xl">
            {words(locale, "Recover retained receipt", "Återställ sparat kvitto")}
          </Button>
        </Box>
      </Box>
      {key ? (
        <>
          <Refresh
            locale={locale}
            pending={result.isFetching}
            onRefresh={() => {
              void result.refetch();
            }}
          />
          <AccountingStatus locale={locale} pending={result.isPending} error={result.error} />
        </>
      ) : null}
      {result.data ? (
        <Facts
          title={words(
            locale,
            "Original committed result — inspect live records before any new action",
            "Ursprungligt sparat resultat — kontrollera aktuella poster före ny åtgärd",
          )}
          value={result.data}
        />
      ) : null}
    </Box>
  );
}

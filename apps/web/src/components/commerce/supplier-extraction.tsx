import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { formatMinorAmount, signedDecimalToMinor } from "@/lib/workspace-api";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { CommandForm, commercePath, type CommerceProps } from "./shared";
import { ExtractionDiagnostics } from "./extraction-diagnostics";

type State = typeof Extraction.SupplierExtractionState.Type;

type Preparation = typeof Extraction.SupplierExtractionReviewPreparation.Type;

type MergedField = typeof Extraction.MergedField.Type;

type FieldDecision = typeof Extraction.ExtractionFieldDecision.Type;

type LineDecision = typeof Extraction.ExtractionLineDecision.Type;

type Choice = "accept" | "retain" | "resolve";

function copy(locale: Locale) {
  const sv = locale === "sv";

  return {
    title: sv ? "Tolkning av original" : "Extraction from the original",
    scope: sv
      ? "Tolkningen läser originalets egna bytes och föreslår värden med källhänvisning. Ett försök är ett förslag, aldrig en granskad uppgift."
      : "Extraction reads the original's own bytes and proposes values with a source locator. An attempt is a suggestion, never a reviewed fact.",
    requestLabel: sv ? "Begär tolkning" : "Request extraction",
    keepOutput: sv ? "Behåll förslagen" : "Keep the suggestions",
    engine: sv ? "Läsare" : "Reader",
    engineValue: sv ? "Inbyggd textläsning" : "Built-in text reader",
    none: sv ? "Ingen tolkning är begärd." : "No extraction has been requested.",
    attempt: sv ? "Tolkningsförsök" : "Extraction attempt",
    diagnostics: sv ? "Diagnoser" : "Diagnostics",
    candidates: sv ? "Föreslagna rader" : "Proposed lines",
    noAttempt: sv ? "Inget tolkningsförsök är sparat." : "No extraction attempt is retained.",
    requestState: (sv
      ? {
          ready: "redo",
          completed: "klar",
          unknown: "okänd",
          superseded: "ersatt",
          cancelled: "avbruten",
        }
      : {
          ready: "ready",
          completed: "completed",
          unknown: "unknown",
          superseded: "superseded",
          cancelled: "cancelled",
        }) satisfies Readonly<Record<State["requests"][number]["state"], string>>,
  };
}

function mergeCopy(locale: Locale) {
  const sv = locale === "sv";

  return {
    review: sv ? "Granska förslagen" : "Review suggestions",
    state: sv ? "Läge" : "State",
    candidates: sv ? "Föreslagna rader" : "Proposed lines",
    reason: sv ? "Granskningsskäl" : "Review reason",
    base: sv ? "Vid begäran" : "When requested",
    current: sv ? "Granskat utkast nu" : "Reviewed draft now",
    suggested: sv ? "Förslag" : "Suggested",
    chosen: sv ? "Valt värde" : "Chosen value",
    locator: sv ? "Källhänvisning" : "Source locator",
    line: sv ? "Rad" : "Line",
    map: sv ? "Mappa mot granskad rad" : "Map to a reviewed line",
    keepOutside: sv ? "Behåll utanför utkastet" : "Keep outside the draft",
    discrepancies: sv ? "Avvikelser" : "Discrepancies",
    totals: sv ? "Föreslagna totalsummor" : "Proposed source totals",
    blockers: sv ? "Blockerare" : "Blockers",
    confirm: sv
      ? "Välj ett värde för varje konflikt och varje föreslagen ändring. Utan val sparas inget."
      : "Choose a value for every conflict and every proposed change. Without a choice nothing is saved.",
    accept: sv ? "Godkänn förslaget" : "Accept the suggestion",
    retain: sv ? "Behåll det granskade värdet" : "Retain the reviewed value",
    resolve: sv ? "Ange ett eget värde" : "Resolve with another value",
    accepted: sv
      ? "Originalet är redan godkänt. Förslagen sparas som ett granskningsärende. Den ekonomiska handlingen ändras inte här."
      : "The original is already accepted. The suggestions are retained as a review case. The economic document is not changed here.",
    absent: sv
      ? "Inkorgsposterna har inget granskat utkast än. Skapa utkastet genom inkorgens granskning först."
      : "This inbox record has no reviewed draft yet. Create the draft through the inbox review first.",
    requiredBase: sv
      ? "Granskningen har inget granskat utkast att jämföra mot. Ange dessa grunduppgifter själv; extrahenteringen hittar dem inte och hittar inte på dem."
      : "This review has no reviewed draft to compare against. Supply these base facts yourself; extraction does not read them and will not invent them.",
    resolved: sv ? "Angett värde" : "Resolved value",
    fieldState: (sv
      ? {
          unchanged: "oförändrad",
          proposed_change: "föreslagen ändring",
          convergent: "sammanfallande",
          conflict: "konflikt",
          retained_reviewed: "behållen efter granskning",
          needs_review: "måste granskas",
        }
      : {
          unchanged: "unchanged",
          proposed_change: "proposed change",
          convergent: "convergent",
          conflict: "conflict",
          retained_reviewed: "retained after review",
          needs_review: "needs review",
        }) satisfies Readonly<Record<MergedField["state"], string>>,
    draftState: (sv
      ? { absent: "saknas", open: "öppet", accepted: "accepterat" }
      : { absent: "absent", open: "open", accepted: "accepted" }) satisfies Readonly<
      Record<Preparation["draft"]["state"], string>
    >,
    attemptResult: (sv
      ? {
          succeeded: "lyckades",
          rejected_output: "avvisad utdata",
          failed: "misslyckades",
          unknown: "okänt",
        }
      : {
          succeeded: "succeeded",
          rejected_output: "rejected output",
          failed: "failed",
          unknown: "unknown",
        }) satisfies Readonly<Record<Preparation["attempt"]["result"], string>>,
  };
}

export function SourceLocators(props: {
  locators: ReadonlyArray<typeof Extraction.SourceLocator.Type>;
  locale: Locale;
  onQuote: (quote: typeof Extraction.DocumentSourceLocator.Type) => void;
}) {
  return (
    <Box display="flex" flexWrap="wrap" alignItems="center" gap="sm">
      {props.locators.length === 0 ? <Text>—</Text> : null}
      {props.locators.map((locator, index) =>
        typeof locator === "string" ? (
          <Text key={index}>{locator}</Text>
        ) : (
          <Button key={index} type="button" variant="ghost" onClick={() => props.onQuote(locator)}>
            {props.locale === "sv" ? "Sida" : "Page"} {locator.page}: “{locator.quote}”
          </Button>
        ),
      )}
    </Box>
  );
}

const fieldNames = {
  title: ["Title", "Titel"],
  supplierDocumentNumber: ["Invoice number", "Fakturanummer"],
  documentDate: ["Invoice date", "Fakturadatum"],
  supplyDate: ["Supply date", "Leveransdatum"],
  dueDate: ["Due date", "Förfallodatum"],
  paymentTerms: ["Payment terms", "Betalningsvillkor"],
  sourceTotalMinor: ["Invoice total", "Fakturans totalsumma"],
  description: ["Description", "Beskrivning"],
  quantity: ["Quantity", "Antal"],
  unitPriceMinor: ["Unit price", "Styckepris"],
  baseMinor: ["Line amount", "Radbelopp"],
  discountMinor: ["Discount", "Rabatt"],
  chargeMinor: ["Charge", "Avgift"],
  taxMinor: ["Tax amount", "Momsbelopp"],
  taxDescription: ["Tax description", "Momsbeskrivning"],
  sourceGrossMinor: ["Line total", "Radsumma"],
} satisfies Record<typeof Extraction.ExtractionFieldKey.Type, readonly [string, string]>;

function fieldName(key: typeof Extraction.ExtractionFieldKey.Type, locale: Locale) {
  return fieldNames[key][locale === "sv" ? 1 : 0];
}

function valueText(
  value: MergedField["base"],
  fieldKey: string,
  book: CommerceProps["book"],
  scale: number,
  locale: Locale,
) {
  if (value === null) return "—";

  return fieldKey.endsWith("Minor") && /^-?[0-9]+$/.test(value)
    ? `${formatMinorAmount(value, scale, locale)} ${book.currency}`
    : value;
}

// The reviewer chooses one disposition per affected field. Anything left unchosen
// is refused by the API, so an unresolved conflict cannot become a draft revision.
function fieldDecision(
  merged: MergedField,
  choice: Choice | null,
  resolved: string,
  currencyScale: number,
): FieldDecision | null {
  if (merged.state === "unchanged" || merged.state === "convergent") return null;

  if (choice === "retain" || merged.state === "retained_reviewed") {
    return {
      lineOrdinal: merged.lineOrdinal,
      fieldKey: merged.fieldKey,
      decisionKind: "retained_reviewed",
      selectedValue: merged.current,
    };
  }

  if (choice === "accept" && merged.state === "proposed_change") {
    return {
      lineOrdinal: merged.lineOrdinal,
      fieldKey: merged.fieldKey,
      decisionKind: "accepted_suggestion",
      selectedValue: merged.suggestion,
    };
  }

  if (choice === "resolve" && merged.state === "conflict") {
    const selectedValue =
      resolved === ""
        ? null
        : merged.fieldKey.endsWith("Minor")
          ? signedDecimalToMinor(resolved, currencyScale)
          : resolved;

    if (resolved !== "" && selectedValue === null) return null;

    return {
      lineOrdinal: merged.lineOrdinal,
      fieldKey: merged.fieldKey,
      decisionKind: "resolved_conflict",
      selectedValue,
    };
  }

  return null;
}

function MergedFieldCard(props: {
  currencyScale: number;
  book: CommerceProps["book"];
  locale: Locale;
  text: ReturnType<typeof mergeCopy>;
  merged: MergedField;
  choice: Choice | null;
  resolved: string;
  onChoice: (choice: Choice) => void;
  onResolved: (value: string) => void;
  onQuote: (quote: typeof Extraction.DocumentSourceLocator.Type) => void;
}) {
  const name = `field-${props.merged.lineOrdinal}-${props.merged.fieldKey}`;
  const label = `${fieldName(props.merged.fieldKey, props.locale)}, ${props.text.line} ${props.merged.lineOrdinal}`;

  return (
    <Box
      as="fieldset"
      display="grid"
      gap="md"
      margin="none"
      padding="lg"
      borderWidth="thin"
      borderColor="default"
      borderRadius="surface"
      minWidth="zero"
    >
      <legend>
        {props.merged.lineOrdinal === 0 ? fieldName(props.merged.fieldKey, props.locale) : label}
      </legend>
      <Text>
        {props.text.state}: {props.text.fieldState[props.merged.state]}
      </Text>
      <Box display="grid" gap="sm">
        {(
          [
            [props.text.base, props.merged.base],
            [props.text.current, props.merged.current],
            [props.text.suggested, props.merged.suggestion],
            [props.text.chosen, props.merged.selected],
          ] as const
        ).map(([label, value]) => (
          <Text key={label}>
            {label}:{" "}
            {valueText(value, props.merged.fieldKey, props.book, props.currencyScale, props.locale)}
          </Text>
        ))}
      </Box>
      <Text>{props.text.locator}:</Text>
      <SourceLocators
        locators={props.merged.evidenceLocators}
        locale={props.locale}
        onQuote={props.onQuote}
      />
      <Box display="flex" flexWrap="wrap" gap="lg">
        {props.merged.state === "proposed_change" ? (
          <Box as="label" display="flex" alignItems="center" gap="md">
            <input
              type="radio"
              name={`${name}-choice`}
              checked={props.choice === "accept"}
              onChange={() => props.onChoice("accept")}
            />
            {props.text.accept}
          </Box>
        ) : null}
        <Box as="label" display="flex" alignItems="center" gap="md">
          <input
            type="radio"
            name={`${name}-choice`}
            checked={props.choice === "retain"}
            onChange={() => props.onChoice("retain")}
          />
          {props.text.retain}
        </Box>
        {props.merged.state === "conflict" ? (
          <Box as="label" display="flex" alignItems="center" gap="md">
            <input
              type="radio"
              name={`${name}-choice`}
              checked={props.choice === "resolve"}
              onChange={() => props.onChoice("resolve")}
            />
            {props.text.resolve}
          </Box>
        ) : null}
      </Box>
      {props.choice === "resolve" ? (
        <InputField
          name={`${name}-value`}
          label={
            props.merged.fieldKey.endsWith("Minor")
              ? `${props.text.resolved} (${props.book.currency})`
              : props.text.resolved
          }
          value={props.resolved}
          maxLength={1000}
          autoComplete="off"
          onChange={(event) => props.onResolved(event.target.value)}
        />
      ) : null}
    </Box>
  );
}

function ExtractionMerge(
  props: CommerceProps & {
    preparation: Preparation;
    onQuote: (quote: typeof Extraction.DocumentSourceLocator.Type) => void;
  },
) {
  const { book, locale, preparation } = props;
  const text = mergeCopy(locale);

  const [choices, setChoices] = useState<Record<string, Choice | null>>({});
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Record<string, LineDecision>>({});

  const base = `${commercePath(book)}/supplier-inbox/${encodeURIComponent(
    preparation.occurrenceId,
  )}/extraction`;

  const targetIds = (preparation.proposed?.lines ?? []).map((line) => line.id);

  const affected = preparation.fields.filter(
    (field) => field.state !== "unchanged" && field.state !== "convergent",
  );

  const decisions = affected
    .map((merged) =>
      fieldDecision(
        merged,
        choices[`${merged.lineOrdinal}:${merged.fieldKey}`] ?? null,
        resolved[`${merged.lineOrdinal}:${merged.fieldKey}`] ?? "",
        preparation.currencyScale,
      ),
    )
    .filter((decision): decision is FieldDecision => decision !== null);

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{text.review}</Heading>
      <Text>
        {text.state}: {text.draftState[preparation.draft.state]},{" "}
        {preparation.draft.revision ?? "—"}, {text.attemptResult[preparation.attempt.result]},{" "}
        {preparation.attempt.engineRelease}
      </Text>
      {preparation.draft.state === "accepted" ? <Text>{text.accepted}</Text> : null}
      {preparation.draft.state === "absent" ? <Text>{text.absent}</Text> : null}
      {preparation.lines.length > 0 ? (
        <Box display="grid" gap="md" minWidth="zero">
          <Heading>{text.candidates}</Heading>
          {preparation.lines.map((line) => (
            <Box
              key={line.candidateLineId}
              display="grid"
              gap="md"
              padding="lg"
              borderWidth="thin"
              borderColor="default"
              borderRadius="surface"
              minWidth="zero"
            >
              <Text>
                {line.candidateLineId}, {text.fieldState[line.state]}, {line.detail || "—"}
              </Text>
              <Text>{text.locator}:</Text>
              <SourceLocators
                locators={line.sourceLocators}
                locale={locale}
                onQuote={props.onQuote}
              />
              <Box as="label" display="grid" gap="sm" minWidth="zero">
                {text.map}
                <select
                  name={`line-${line.candidateLineId}`}
                  value={
                    lines[line.candidateLineId]?.disposition === "map_to_line"
                      ? (lines[line.candidateLineId]?.targetLineId ?? "")
                      : ""
                  }
                  onChange={(event) =>
                    setLines((current) => ({
                      ...current,
                      [line.candidateLineId]:
                        event.target.value === ""
                          ? {
                              candidateLineId: line.candidateLineId,
                              disposition: "keep_reviewed",
                              targetLineId: null,
                            }
                          : {
                              candidateLineId: line.candidateLineId,
                              disposition: "map_to_line",
                              targetLineId: event.target.value,
                            },
                    }))
                  }
                >
                  <option value="">{text.keepOutside}</option>
                  {targetIds.map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
      {affected.length > 0 ? (
        <Box display="grid" gap="md" minWidth="zero">
          {affected.map((merged) => {
            const key = `${merged.lineOrdinal}:${merged.fieldKey}`;

            return (
              <MergedFieldCard
                key={key}
                book={book}
                locale={locale}
                text={text}
                currencyScale={preparation.currencyScale}
                merged={merged}
                choice={choices[key] ?? null}
                resolved={resolved[key] ?? ""}
                onChoice={(choice) => setChoices((current) => ({ ...current, [key]: choice }))}
                onResolved={(value) => setResolved((current) => ({ ...current, [key]: value }))}
                onQuote={props.onQuote}
              />
            );
          })}
        </Box>
      ) : null}
      {preparation.discrepancies.length > 0 ? (
        <Box display="grid" gap="sm" minWidth="zero">
          <Heading>{text.discrepancies}</Heading>
          {preparation.discrepancies.map((item, index) => (
            <Text key={index}>
              {item.code}, {item.lineOrdinal}, {item.fieldKey} {item.detail}
            </Text>
          ))}
        </Box>
      ) : null}
      {preparation.requiredBaseFacts.length > 0 ? (
        <Box display="grid" gap="sm" minWidth="zero">
          <Heading>{text.requiredBase}</Heading>
          {preparation.requiredBaseFacts.map((fact) => (
            <Text key={fact}>{fact}</Text>
          ))}
        </Box>
      ) : null}
      {preparation.proposedTotals ? (
        <Box display="grid" gap="sm" minWidth="zero">
          <Heading>{text.totals}</Heading>
          <pre>{JSON.stringify(preparation.proposedTotals, null, 2)}</pre>
        </Box>
      ) : null}
      {preparation.proposedBlockers.length > 0 ? (
        <Box display="grid" gap="sm" minWidth="zero">
          <Heading>{text.blockers}</Heading>
          {preparation.proposedBlockers.map((blocker, index) => (
            <Text key={index}>
              {blocker.code}, {blocker.lineId ?? "—"}
            </Text>
          ))}
        </Box>
      ) : null}
      {preparation.draft.state === "absent" ? null : (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/${encodeURIComponent(preparation.request.id)}/review`}
          schema={Extraction.CommitSupplierExtractionReview}
          output={Extraction.SupplierExtractionReview}
          label={text.reason}
          input={(form) => ({
            requestId: preparation.request.id,
            attemptId: preparation.attempt.attemptId,
            expectedDraftRevision: preparation.draft.revision,
            expectedDraftDigest: preparation.draft.digest,
            baseContent: null,
            reason: form.get("reason"),
            lines: preparation.lines
              .map((line) => lines[line.candidateLineId])
              .filter((decision): decision is LineDecision => decision !== undefined),
            fields: decisions,
          })}
        >
          <Text>{text.confirm}</Text>
          <InputField name="reason" label={text.reason} required maxLength={2000} />
        </CommandForm>
      )}
    </Box>
  );
}

function ExtractionAttempts(
  props: CommerceProps & {
    state: State;
    onQuote: (quote: typeof Extraction.DocumentSourceLocator.Type) => void;
  },
) {
  const { locale, state: extraction } = props;
  const text = copy(locale);

  if (!extraction.attempt) return <Text>{text.noAttempt}</Text>;

  return (
    <Box display="grid" gap="sm" minWidth="zero">
      <Heading>{text.attempt}</Heading>
      <Text>{mergeCopy(locale).attemptResult[extraction.attempt.result]}</Text>
      {extraction.attempt.document ? (
        <Text>
          {locale === "sv" ? "Lästa sidor" : "Pages read"}:{" "}
          {extraction.attempt.document.readPages.join(", ")} /{" "}
          {extraction.attempt.document.physicalPages},{" "}
          {extraction.attempt.document.coverage === "complete"
            ? locale === "sv"
              ? "Alla sidor"
              : "All pages"
            : locale === "sv"
              ? "Sidor saknas — granska hela originalet"
              : "Missing pages — review the whole original"}
          .{" "}
          {locale === "sv"
            ? "Öppna källhänvisningen för att kontrollera förslaget mot originalet. Källmarkering visas bara när läsaren har lämnat sidpositionen."
            : "Open the source reference to check the suggestion against the original. A source highlight appears only when the reader supplied a page location."}
        </Text>
      ) : null}
      {extraction.attempt.fields.map((field) => (
        <Box key={field.fieldKey} display="grid" gap="sm">
          <Text>
            {fieldName(field.fieldKey, locale)}:{" "}
            {valueText(
              field.proposedValue,
              field.fieldKey,
              props.book,
              extraction.currencyScale,
              locale,
            )}{" "}
          </Text>
          <SourceLocators locators={field.sourceLocators} locale={locale} onQuote={props.onQuote} />
        </Box>
      ))}
      {extraction.attempt.diagnostics.length > 0 ? (
        <Box display="grid" gap="sm" minWidth="zero">
          <Heading>{text.diagnostics}</Heading>
          <ExtractionDiagnostics diagnostics={extraction.attempt.diagnostics} locale={locale} />
        </Box>
      ) : null}
      {extraction.attempt.candidateLines.map((line) => (
        <Box key={line.candidateLineId} display="grid" gap="sm">
          <Text>{line.candidateLineId}</Text>
          <SourceLocators locators={line.sourceLocators} locale={locale} onQuote={props.onQuote} />
        </Box>
      ))}
    </Box>
  );
}

export function SupplierExtraction(
  props: CommerceProps & {
    occurrenceId: string;
    originalBytes: number;
    mediaType: string;
    onRefresh: () => void;
    onQuote: (quote: typeof Extraction.DocumentSourceLocator.Type) => void;
  },
) {
  const { book, locale, occurrenceId } = props;
  const text = copy(locale);
  const keys = useRef(new Map<string, string>());
  const [review, setReview] = useState<Preparation | null>(null);

  const base = `${commercePath(book)}/supplier-inbox/${encodeURIComponent(occurrenceId)}/extraction`;

  const state = useQuery<State>({
    queryKey: [...bookKey(book), "supplier-inbox", occurrenceId, "extraction"],
    enabled: occurrenceId !== "",
    retry: false,
    refetchInterval: (query) => (query.state.data?.requests[0]?.state === "ready" ? 2000 : false),
    queryFn: async ({ signal }) =>
      readAccounting(base, Extraction.SupplierExtractionState, { signal }),
  });

  const current = state.data?.requests[0] ?? null;
  const latest = state.data?.attempt ?? null;
  const document = ["application/pdf", "image/png", "image/jpeg"].includes(props.mediaType);
  const enabled = !document || state.data?.documentReaderAvailable === true;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{text.title}</Heading>
      <Text>{text.scope}</Text>
      {book.role === "operator" && enabled ? (
        <CommandForm
          book={book}
          locale={locale}
          path={base}
          schema={Extraction.RequestSupplierExtraction}
          output={Extraction.SupplierExtractionRequestResult}
          label={text.requestLabel}
          keys={keys.current}
          onNewCommand={() => keys.current.clear()}
          onSuccess={() => {
            setReview(null);
            props.onRefresh();
          }}
          input={(form) =>
            document
              ? {
                  engineRelease: "azure-invoice-v1",
                  pageSelection: "all",
                  amountProfile: "sv-SE-SEK",
                  dataUsePolicy: "retain_output",
                }
              : {
                  engineRelease: "native-text-v1",
                  dataUsePolicy:
                    form.get("keepOutput") === "on" ? "retain_output" : "retain_diagnostics",
                  selectedPages: [
                    {
                      page: 1,
                      startByte: 0,
                      endByte: props.originalBytes,
                    },
                  ],
                }
          }
        >
          <Text>
            {text.engine}:{" "}
            {document
              ? locale === "sv"
                ? "PDF och bild, alla sidor"
                : "PDF and image, all pages"
              : text.engineValue}
          </Text>
          {document ? (
            <Text>
              {locale === "sv"
                ? "Sidtext och förslag sparas för granskning."
                : "Page text and suggestions are retained for review."}
            </Text>
          ) : (
            <Box as="label" display="flex" alignItems="center" gap="md">
              <input type="checkbox" name="keepOutput" defaultChecked />
              {text.keepOutput}
            </Box>
          )}
        </CommandForm>
      ) : null}
      {document && !enabled ? (
        <Text>
          {locale === "sv"
            ? "Automatisk dokumentläsning är avstängd. Du kan fortfarande granska originalet och skapa ett utkast manuellt."
            : "Automatic document reading is disabled. You can still review the original and create a draft manually."}
        </Text>
      ) : null}
      {state.data ? (
        <Box display="grid" gap="sm" minWidth="zero">
          {state.data.requests.map((request) => (
            <Text key={request.id}>
              {request.generation}, {text.requestState[request.state]}, {request.requestedAt}
            </Text>
          ))}
        </Box>
      ) : (
        <Text>{text.none}</Text>
      )}
      <AccountingStatus locale={locale} pending={state.isPending} error={state.error} />
      {state.data ? (
        <ExtractionAttempts
          book={book}
          locale={locale}
          state={state.data}
          onQuote={props.onQuote}
        />
      ) : null}
      {current?.state === "ready" && book.role === "operator" ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/${encodeURIComponent(current.id)}/cancel`}
          schema={Extraction.CancelSupplierExtraction}
          output={Extraction.SupplierExtractionCancelResult}
          label={locale === "sv" ? "Avbryt läsning" : "Cancel reading"}
          input={() => ({ requestId: current.id })}
          onSuccess={() => {
            void state.refetch();
            props.onRefresh();
          }}
        >
          <Text>
            {locale === "sv"
              ? "Läsning pågår. Originalet finns kvar om du avbryter."
              : "Reading is in progress. Cancelling keeps the original."}
          </Text>
        </CommandForm>
      ) : null}
      {current && latest && latest.result === "succeeded" && current.state === "completed" ? (
        <Box display="grid" gap="md">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setReview(null);
              void state.refetch();
              props.onRefresh();
            }}
          >
            {locale === "sv" ? "Läs om" : "Refresh"}
          </Button>
          <ReviewLoader
            book={book}
            locale={locale}
            base={base}
            requestId={current.id}
            attemptId={latest.attemptId}
            onPrepared={setReview}
          />
        </Box>
      ) : null}
      {review ? (
        <ExtractionMerge book={book} locale={locale} preparation={review} onQuote={props.onQuote} />
      ) : null}
    </Box>
  );
}

function ReviewLoader(props: {
  book: CommerceProps["book"];
  locale: Locale;
  base: string;
  requestId: string;
  attemptId: string;
  onPrepared: (preparation: Preparation) => void;
}) {
  const text = mergeCopy(props.locale);

  const prepare = useMutation({
    mutationFn: async () => {
      const path = `${props.base}/${encodeURIComponent(props.requestId)}/prepare`;

      return readAccounting(path, Extraction.SupplierExtractionReviewPreparation, {
        method: "POST",
        body: JSON.stringify({ attemptId: props.attemptId }),
      });
    },
    onSuccess: (preparation) => props.onPrepared(preparation),
    retry: false,
  });

  return (
    <Box display="grid" gap="md">
      <Button
        type="button"
        disabled={prepare.isPending || prepare.isSuccess}
        onClick={() => prepare.mutate()}
      >
        {text.review}
      </Button>
      <AccountingStatus locale={props.locale} pending={prepare.isPending} error={prepare.error} />
    </Box>
  );
}

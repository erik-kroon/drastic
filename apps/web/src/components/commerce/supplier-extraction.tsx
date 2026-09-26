import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { CommandForm, commercePath, type CommerceProps } from "./shared";

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
    engine: sv ? "Motor" : "Motor",
    engineValue: sv ? "Inbyggd textläsning" : "Built-in text reader",
    none: sv ? "Ingen tolkning är begärd." : "No extraction has been requested.",
    attempt: sv ? "Tolkningsförsök" : "Extraction attempt",
    diagnostics: sv ? "Diagnoser" : "Diagnostics",
    candidates: sv ? "Föreslagna rader" : "Proposed lines",
    noAttempt: sv ? "Inget tolkningsförsök är sparat." : "No extraction attempt is retained.",
  };
}

function mergeCopy(locale: Locale) {
  const sv = locale === "sv";

  return {
    review: sv ? "Granska trevägssammanslagning" : "Review the three-way merge",
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
    totals: sv ? "Föreslagna totalsumr" : "Proposed source totals",
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
    resolved: sv ? "Angett värde" : "Resolved value",
  };
}

const stateWords = {
  unchanged: "oförändrad",
  proposed_change: "föreslagen ändring",
  convergent: "sammanfallande",
  conflict: "konflikt",
  retained_reviewed: "behållen efter granskning",
  needs_review: "måste granskas",
} satisfies Readonly<Record<MergedField["state"], string>>;

const stateLabel = {
  ready: "ready",
  completed: "completed",
  unknown: "unknown",
  superseded: "superseded",
  cancelled: "cancelled",
} satisfies Readonly<Record<State["requests"][number]["state"], string>>;

function valueText(value: MergedField["base"]) {
  return value === null ? "—" : value;
}

// The reviewer chooses one disposition per affected field. Anything left unchosen
// is refused by the API, so an unresolved conflict cannot become a draft revision.
function fieldDecision(
  merged: MergedField,
  choice: Choice | null,
  resolved: string,
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
    return {
      lineOrdinal: merged.lineOrdinal,
      fieldKey: merged.fieldKey,
      decisionKind: "resolved_conflict",
      selectedValue: resolved === "" ? null : resolved,
    };
  }

  return null;
}

function MergedFieldCard(props: {
  text: ReturnType<typeof mergeCopy>;
  merged: MergedField;
  choice: Choice | null;
  resolved: string;
  onChoice: (choice: Choice) => void;
  onResolved: (value: string) => void;
}) {
  const name = `field-${props.merged.lineOrdinal}-${props.merged.fieldKey}`;
  const label = `${props.merged.fieldKey} · ${props.text.line} ${props.merged.lineOrdinal}`;

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
      <legend>{props.merged.lineOrdinal === 0 ? props.merged.fieldKey : label}</legend>
      <Text>
        {props.text.state}: {stateWords[props.merged.state]}
        {props.merged.detail ? ` · ${props.merged.detail}` : ""}
      </Text>
      <Box minWidth="zero" overflow="auto">
        <pre>
          {JSON.stringify(
            {
              [props.text.base]: valueText(props.merged.base),
              [props.text.current]: valueText(props.merged.current),
              [props.text.suggested]: valueText(props.merged.suggestion),
              [props.text.chosen]: valueText(props.merged.selected),
            },
            null,
            2,
          )}
        </pre>
      </Box>
      <Text>
        {props.text.locator}:{" "}
        {props.merged.evidenceLocators.length === 0
          ? "—"
          : props.merged.evidenceLocators.join(", ")}
      </Text>
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
          label={props.text.resolved}
          value={props.resolved}
          maxLength={1000}
          autoComplete="off"
          onChange={(event) => props.onResolved(event.target.value)}
        />
      ) : null}
    </Box>
  );
}

function ExtractionMerge(props: CommerceProps & { preparation: Preparation }) {
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
      ),
    )
    .filter((decision): decision is FieldDecision => decision !== null);

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{text.review}</Heading>
      <Text>
        {text.state}: {preparation.draft.state} · {preparation.draft.revision ?? "—"} ·{" "}
        {preparation.attempt.result} · {preparation.attempt.engineRelease}
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
                {line.candidateLineId} · {stateWords[line.state]} · {line.detail || "—"}
              </Text>
              <Text>
                {text.locator}:{" "}
                {line.sourceLocators.length === 0 ? "—" : line.sourceLocators.join(", ")}
              </Text>
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
                text={text}
                merged={merged}
                choice={choices[key] ?? null}
                resolved={resolved[key] ?? ""}
                onChoice={(choice) => setChoices((current) => ({ ...current, [key]: choice }))}
                onResolved={(value) => setResolved((current) => ({ ...current, [key]: value }))}
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
              {item.code} · {item.lineOrdinal} · {item.fieldKey} {item.detail}
            </Text>
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
              {blocker.code} · {blocker.lineId ?? "—"}
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

function ExtractionAttempts(props: CommerceProps & { state: State }) {
  const { locale, state: extraction } = props;
  const text = copy(locale);

  if (!extraction.attempt) return <Text>{text.noAttempt}</Text>;

  return (
    <Box display="grid" gap="sm" minWidth="zero">
      <Heading>{text.attempt}</Heading>
      <Text>
        {extraction.attempt.attemptId} · {extraction.attempt.result} ·{" "}
        {extraction.attempt.engineRelease} · {extraction.attempt.sourceHash}
      </Text>
      {extraction.attempt.diagnostics.length > 0 ? (
        <Box display="grid" gap="sm" minWidth="zero">
          <Heading>{text.diagnostics}</Heading>
          {extraction.attempt.diagnostics.map((item, index) => (
            <Text key={index}>
              {item.code} · {item.lineOrdinal} · {item.fieldKey} {item.detail}
            </Text>
          ))}
        </Box>
      ) : null}
      {extraction.attempt.candidateLines.map((line) => (
        <Text key={line.candidateLineId}>
          {line.candidateLineId} · {line.sourceLocators.join(", ") || "—"}
        </Text>
      ))}
    </Box>
  );
}

export function SupplierExtraction(
  props: CommerceProps & { occurrenceId: string; onRefresh: () => void },
) {
  const { book, locale, occurrenceId } = props;
  const text = copy(locale);
  const keys = useRef(new Map<string, string>());
  const [review, setReview] = useState<Preparation | null>(null);

  const base = `${commercePath(book)}/supplier-inbox/${encodeURIComponent(occurrenceId)}/extraction`;

  const state = useQuery({
    queryKey: [...bookKey(book), "supplier-inbox", occurrenceId, "extraction"],
    enabled: occurrenceId !== "",
    retry: false,
    queryFn: async ({ signal }) =>
      readAccounting(base, Extraction.SupplierExtractionState, { signal }),
  });

  const current = state.data?.requests[0] ?? null;
  const latest = state.data?.attempt ?? null;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{text.title}</Heading>
      <Text>{text.scope}</Text>
      {book.role === "operator" ? (
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
          input={(form) => ({
            engineRelease: "native-text-v1",
            dataUsePolicy: form.get("keepOutput") === "on" ? "retain_output" : "retain_diagnostics",
            selectedPages: [
              {
                page: 1,
                startByte: 0,
                endByte: current?.originalBytes ?? Number.MAX_SAFE_INTEGER,
              },
            ],
          })}
        >
          <Text>
            {text.engine}: {text.engineValue}
          </Text>
          <Box as="label" display="flex" alignItems="center" gap="md">
            <input type="checkbox" name="keepOutput" defaultChecked />
            {text.keepOutput}
          </Box>
        </CommandForm>
      ) : null}
      {state.data ? (
        <Box display="grid" gap="sm" minWidth="zero">
          {state.data.requests.map((request) => (
            <Text key={request.id}>
              {request.generation} · {request.engineRelease} · {stateLabel[request.state]} ·{" "}
              {request.originalHash} · {request.requestedAt}
            </Text>
          ))}
        </Box>
      ) : (
        <Text>{text.none}</Text>
      )}
      <AccountingStatus locale={locale} pending={state.isPending} error={state.error} />
      {state.data ? <ExtractionAttempts book={book} locale={locale} state={state.data} /> : null}
      {current && latest ? (
        <Box display="grid" gap="md">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setReview(null);
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
      {review ? <ExtractionMerge book={book} locale={locale} preparation={review} /> : null}
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

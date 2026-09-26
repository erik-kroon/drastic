import { useRef, useState } from "react";
import * as Schema from "effect/Schema";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Deadlines from "@open-erp/contracts/deadlines";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { DeadlineFulfillmentLink } from "./deadline-fulfillment-link";

type Deadline = typeof Deadlines.Deadline.Type;

const families = ["posting_eligibility", "vat", "payroll", "statements", "legal_ar"] as const;

const emptyBasis: typeof Deadlines.StatutoryBasis.Type = {
  jurisdiction: "SE",
  family: "statements",
  ruleReference: "",
  ruleVersion: 1,
  calendarReference: "",
  periodId: "",
  basisDueAt: "",
};

const emptyInput: typeof Deadlines.DeadlineInput.Type = {
  title: "",
  periodId: "",
  responsibleActorId: "",
  dueAt: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  sourceReference: "",
  sourceRevision: "",
  jurisdiction: "SE",
  statutoryBasis: emptyBasis,
  requiredEnvironment: "production",
  outcomeKind: "submitted",
};

function toInput(item: Deadline): typeof Deadlines.DeadlineInput.Type {
  const basis = item.statutory_basis ?? { ...emptyBasis, periodId: item.period_id };

  return {
    title: item.title,
    periodId: item.period_id,
    responsibleActorId: item.responsible_actor_id,
    dueAt: item.due_at,
    timeZone: item.time_zone,
    sourceReference: item.source_reference,
    sourceRevision: item.source_revision,
    overrideReason: item.override_reason ?? undefined,
    jurisdiction: item.jurisdiction ?? basis.jurisdiction,
    statutoryBasis: basis,
    requiredEnvironment: item.required_environment ?? "production",
    outcomeKind: item.outcome_kind,
  };
}

function SelectRow(props: {
  label: string;
  value: string;
  options: ReadonlyArray<string>;
  onSelect: (value: string) => void;
}) {
  return (
    <label>
      {props.label}{" "}
      <select value={props.value} onChange={(event) => props.onSelect(event.target.value)}>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DeadlineObligations(props: { book: typeof Accounting.Book.Type; locale: Locale }) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const path = `${bookPath(book)}/deadlines`;
  const key = [...bookKey(book), "deadlines"];
  const mutationKeys = useRef(new Map<string, string>());
  const client = useQueryClient();
  const [id, setId] = useState("");
  const [input, setInput] = useState(emptyInput);
  const [feed, setFeed] = useState<string | null>(null);
  const [feedId, setFeedId] = useState("");
  const [error, setError] = useState<Error | null>(null);

  const list = useQuery(
    queryOptions({
      queryKey: key,
      queryFn: ({ signal }) => readAccounting(path, Deadlines.DeadlineList, { signal }),
    }),
  );

  const save = useMutation({
    mutationFn: () => {
      const target = `${path}/${encodeURIComponent(id)}`;

      const body = JSON.stringify({
        expectedRevision: list.data?.find((item) => item.id === id)?.revision ?? null,
        input,
      });

      return readAccounting(
        target,
        Deadlines.Deadline,
        mutationOptions(target, body, mutationKeys.current),
      );
    },
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: key });
    },
    onError: setError,
  });

  const dismiss = useMutation({
    mutationFn: (item: Deadline) => {
      const target = `${path}/${encodeURIComponent(item.id)}/activity`;

      const body = JSON.stringify({ action: "dismiss_reminder" });

      return readAccounting(
        target,
        Deadlines.Deadline,
        mutationOptions(target, body, mutationKeys.current),
      );
    },
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: key });
    },
    onError: setError,
  });

  const createFeed = useMutation({
    mutationFn: async () => {
      const next = crypto.randomUUID();

      const data = await readAccounting(`${path}/feeds/${next}`, Deadlines.DeadlineFeed, {
        method: "POST",
      });

      return { id: next, secret: data.secret };
    },
    onSuccess: (data) => {
      setFeedId(data.id);
      setFeed(`${location.origin}/api/v1/deadline-feeds/${data.secret}.ics`);
      setError(null);
    },
    onError: setError,
  });

  const revokeFeed = useMutation({
    mutationFn: () => {
      const target = `${path}/feeds/${encodeURIComponent(feedId)}/revoke`;

      return readAccounting(
        target,
        Deadlines.RevokedDeadlineFeed,
        mutationOptions(target, "{}", mutationKeys.current),
      );
    },
    onSuccess: () => {
      setFeed(null);
      setFeedId("");
      setError(null);
    },
    onError: setError,
  });

  return (
    <RecordSection title={sv ? "Tidsfrister" : "Deadlines"}>
      <Box display="grid" gap="md" minWidth="zero">
        <Text>
          {sv
            ? "Varje tidsfrist bär den granskade rättsliga grunden och det datum den ger. En avfärdad påminnelse är inte ett uppfyllt krav, och en notis är inte ett verifierat utfall."
            : "Every deadline carries the reviewed statutory basis and the date it yields. A dismissed reminder is not a fulfilled obligation, and a note is not a verified outcome."}
        </Text>
        <AccountingStatus error={list.error ?? error} pending={list.isPending} locale={locale} />
        {list.data?.map((item) => (
          <Box key={item.id} display="grid" gap="sm">
            <Text>
              {item.title} — {new Date(item.due_at).toLocaleString(locale)} —{" "}
              {item.status ?? "upcoming"}
            </Text>
            <Text>
              {item.source_reference} · {item.source_revision}
            </Text>
            <Text>
              {sv ? "Grund" : "Basis"}:{" "}
              {item.statutory_basis
                ? `${item.statutory_basis.jurisdiction} · ${item.statutory_basis.family} · ${item.statutory_basis.ruleReference}@${item.statutory_basis.ruleVersion} · ${item.statutory_basis.calendarReference} · ${item.statutory_basis.basisDueAt}`
                : sv
                  ? "Saknar granskad grund"
                  : "No reviewed statutory basis recorded"}
            </Text>
            <Text>
              {sv ? "Miljö" : "Environment"}: {item.required_environment ?? "—"}
            </Text>
            <Text>
              {sv ? "Verifierat utfall" : "Verified outcome"}:{" "}
              {item.current_outcome
                ? `${item.current_outcome.kind} — ${item.current_outcome.reference} — ${new Date(item.current_outcome.recordedAt).toLocaleString(locale)}`
                : sv
                  ? "Inte verifierat"
                  : "Not verified"}
            </Text>
            {item.reported_reference && (
              <Text>
                {sv ? "Registrerad notis" : "Reported note"}: {item.reported_reference} —{" "}
                {sv
                  ? "not verifierad, och den uppfyller inget krav"
                  : "unverified, and it fulfills nothing"}
              </Text>
            )}
            <Text>
              {sv ? "Påminnelse" : "Reminder"}:{" "}
              {item.reminder_dismissed_at
                ? `${sv ? "Avfärda" : "Dismissed"} ${new Date(item.reminder_dismissed_at).toLocaleString(locale)}`
                : sv
                  ? "Aktiv"
                  : "Active"}
            </Text>
            {item.amends_obligation_id && (
              <Text>
                {sv ? "Ändrar" : "Amends"}: {item.amends_obligation_id} ·{" "}
                {item.amended_outcome_reference ?? (sv ? "inget utfall" : "no outcome")} (
                {sv ? "notis" : "notice"} {item.amendment_notice_id})
              </Text>
            )}
            <Button
              type="button"
              onClick={() => {
                setId(item.id);
                setInput(toInput(item));
              }}
            >
              {sv ? "Redigera" : "Edit"}
            </Button>
            {!item.reminder_dismissed_at && (
              <Button
                type="button"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(item)}
              >
                {sv ? "Avfärda påminnelse" : "Dismiss reminder"}
              </Button>
            )}
            <DeadlineFulfillmentLink
              obligation={item}
              path={path}
              locale={locale}
              onError={setError}
              onLinked={async () => {
                setError(null);
                await client.invalidateQueries({ queryKey: key });
              }}
            />
            <Box display="grid" gap="xs">
              <Text>{sv ? "Aktivitetshistorik" : "Activity history"}</Text>
              {item.activity_history.length === 0 ? (
                <Text>{sv ? "Ingen aktivitet registrerad." : "No activity recorded."}</Text>
              ) : (
                item.activity_history.map((event) => (
                  <Text key={event.id}>
                    {event.action === "dismiss_reminder"
                      ? sv
                        ? "Påminnelse avfärdad"
                        : "Reminder dismissed"
                      : `${sv ? "Utfall" : "Outcome"}: ${event.outcomeKind} — ${event.reference}`}{" "}
                    · {new Date(event.recordedAt).toLocaleString(locale)} · {event.actorId}
                  </Text>
                ))
              )}
            </Box>
          </Box>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Box display="grid" gap="sm">
            <InputField
              label="ID"
              required
              value={id}
              onChange={(event) => setId(event.target.value)}
            />
            <InputField
              label={sv ? "Titel" : "Title"}
              required
              value={input.title}
              onChange={(event) => setInput({ ...input, title: event.target.value })}
            />
            <InputField
              label={sv ? "Period-ID" : "Period ID"}
              required
              value={input.periodId}
              onChange={(event) => setInput({ ...input, periodId: event.target.value })}
            />
            <InputField
              label={sv ? "Ansvarig aktör-ID" : "Responsible actor ID"}
              required
              value={input.responsibleActorId}
              onChange={(event) => setInput({ ...input, responsibleActorId: event.target.value })}
            />
            <InputField
              label={sv ? "Förfallotid (ISO 8601 med tidszon)" : "Due time (ISO 8601 with offset)"}
              required
              value={input.dueAt}
              onChange={(event) => setInput({ ...input, dueAt: event.target.value })}
            />
            <InputField
              label={sv ? "Tidszon" : "Time zone"}
              required
              value={input.timeZone}
              onChange={(event) => setInput({ ...input, timeZone: event.target.value })}
            />
            <InputField
              label={sv ? "Jurisdiktion" : "Jurisdiction"}
              required
              value={input.jurisdiction}
              onChange={(event) => setInput({ ...input, jurisdiction: event.target.value })}
            />
            <SelectRow
              label={sv ? "Regelfamilj" : "Rule family"}
              value={input.statutoryBasis.family}
              options={[...families]}
              onSelect={(value) =>
                setInput({
                  ...input,
                  statutoryBasis: {
                    ...input.statutoryBasis,
                    family: Schema.decodeUnknownSync(Deadlines.RuleFamily)(value),
                  },
                })
              }
            />
            <InputField
              label={sv ? "Referens till regelrelease" : "Reviewed rule release reference"}
              required
              value={input.statutoryBasis.ruleReference}
              onChange={(event) =>
                setInput({
                  ...input,
                  statutoryBasis: { ...input.statutoryBasis, ruleReference: event.target.value },
                })
              }
            />
            <InputField
              label={sv ? "Releaseversion" : "Rule release version"}
              required
              type="number"
              value={String(input.statutoryBasis.ruleVersion)}
              onChange={(event) =>
                setInput({
                  ...input,
                  statutoryBasis: {
                    ...input.statutoryBasis,
                    ruleVersion: Number(event.target.value),
                  },
                })
              }
            />
            <InputField
              label={sv ? "Kalender- och helgregrelease" : "Holiday and timezone release reference"}
              required
              value={input.statutoryBasis.calendarReference}
              onChange={(event) =>
                setInput({
                  ...input,
                  statutoryBasis: {
                    ...input.statutoryBasis,
                    calendarReference: event.target.value,
                  },
                })
              }
            />
            <InputField
              label={sv ? "Period enligt grunden" : "Period named by the basis"}
              required
              value={input.statutoryBasis.periodId}
              onChange={(event) =>
                setInput({
                  ...input,
                  statutoryBasis: { ...input.statutoryBasis, periodId: event.target.value },
                })
              }
            />
            <InputField
              label={sv ? "Förfallotid enligt grunden" : "Due time the basis yields"}
              required
              value={input.statutoryBasis.basisDueAt}
              onChange={(event) =>
                setInput({
                  ...input,
                  statutoryBasis: { ...input.statutoryBasis, basisDueAt: event.target.value },
                })
              }
            />
            <SelectRow
              label={sv ? "Uppfyllandemiljö" : "Fulfillment environment"}
              value={input.requiredEnvironment}
              options={["production", "sandbox"]}
              onSelect={(value) =>
                setInput({
                  ...input,
                  requiredEnvironment: Schema.decodeUnknownSync(Deadlines.FulfillmentEnvironment)(
                    value,
                  ),
                })
              }
            />
            <InputField
              label={sv ? "Källreferens" : "Source reference"}
              required
              value={input.sourceReference}
              onChange={(event) => setInput({ ...input, sourceReference: event.target.value })}
            />
            <InputField
              label={sv ? "Källrevision" : "Source revision"}
              required
              value={input.sourceRevision}
              onChange={(event) => setInput({ ...input, sourceRevision: event.target.value })}
            />
            <SelectRow
              label={sv ? "Krav på utfall" : "Required outcome"}
              value={input.outcomeKind}
              options={["prepared", "submitted", "accepted"]}
              onSelect={(value) =>
                setInput({
                  ...input,
                  outcomeKind: Schema.decodeUnknownSync(Deadlines.OutcomeKind)(value),
                })
              }
            />
            <InputField
              label={
                sv ? "Skäl för ändring av datum eller källa" : "Reason for changed date or source"
              }
              value={input.overrideReason ?? ""}
              onChange={(event) =>
                setInput({ ...input, overrideReason: event.target.value || undefined })
              }
            />
            <Button type="submit" disabled={save.isPending}>
              {sv ? "Spara tidsfrist" : "Save deadline"}
            </Button>
          </Box>
        </form>
        <Button type="button" disabled={createFeed.isPending} onClick={() => createFeed.mutate()}>
          {sv ? "Skapa privat kalenderlänk" : "Create private calendar link"}
        </Button>
        {feed && (
          <Box display="grid" gap="sm">
            <Text>
              {sv
                ? "Kopiera länken nu. Den visas inte igen. Dela den inte offentligt."
                : "Copy this link now. It will not be shown again. Do not share it publicly."}
            </Text>
            <Text>{feed}</Text>
            <Button
              type="button"
              disabled={revokeFeed.isPending}
              onClick={() => revokeFeed.mutate()}
            >
              {sv ? "Spärra kalenderlänk" : "Revoke calendar link"}
            </Button>
          </Box>
        )}
      </Box>
    </RecordSection>
  );
}

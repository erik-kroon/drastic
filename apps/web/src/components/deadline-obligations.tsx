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

export function DeadlineObligations({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const sv = locale === "sv";
  const path = `${bookPath(book)}/deadlines`;
  const key = [...bookKey(book), "deadlines"];
  const mutationKeys = useRef(new Map<string, string>());
  const client = useQueryClient();

  const list = useQuery(
    queryOptions({
      queryKey: key,
      queryFn: ({ signal }) => readAccounting(path, Deadlines.DeadlineList, { signal }),
    }),
  );

  const [id, setId] = useState("");

  const [input, setInput] = useState<typeof Deadlines.DeadlineInput.Type>({
    title: "",
    periodId: "",
    responsibleActorId: "",
    dueAt: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sourceReference: "",
    sourceRevision: "",
    outcomeKind: "submitted",
  });

  const [feed, setFeed] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<Error | null>(null);

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

  const activity = useMutation({
    mutationFn: ({
      item,
      action,
      outcomeReference,
    }: {
      item: typeof Deadlines.Deadline.Type;
      action: "dismiss_reminder" | "record_outcome";
      outcomeReference?: string;
    }) => {
      const target = `${path}/${encodeURIComponent(item.id)}/activity`;

      const body = JSON.stringify(
        action === "record_outcome" ? { action, reference: outcomeReference } : { action },
      );

      return readAccounting(
        target,
        Deadlines.Deadline,
        mutationOptions(target, body, mutationKeys.current),
      );
    },
    onSuccess: async () => {
      setError(null);
      setReference("");
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

  const [feedId, setFeedId] = useState("");

  return (
    <RecordSection title={sv ? "Tidsfrister" : "Deadlines"}>
      <Box display="grid" gap="md" minWidth="zero">
        <Text>
          {sv
            ? "Registrera granskade tidsfrister manuellt. En avfärdad påminnelse är inte ett uppfyllt krav."
            : "Enter reviewed deadlines manually. Dismissing a reminder does not fulfill an obligation."}
        </Text>
        <AccountingStatus error={list.error ?? error} pending={list.isPending} locale={locale} />
        {list.data?.map((item) => (
          <Box key={item.id} display="grid" gap="sm">
            <Text>
              {item.title} — {new Date(item.due_at).toLocaleString(locale)} (Status:{" "}
              {item.status ?? (item.outcome_reference ? item.outcome_kind : "upcoming")})
            </Text>
            <Text>
              {item.source_reference} · {item.source_revision}
            </Text>
            <Text>
              {sv ? "Aktuellt utfall" : "Current outcome"}:{" "}
              {item.current_outcome
                ? `${item.current_outcome.kind} — ${item.current_outcome.reference} — ${new Date(item.current_outcome.recordedAt).toLocaleString(locale)}`
                : sv
                  ? "Inte registrerat"
                  : "Not recorded"}
            </Text>
            <Text>
              {sv ? "Påminnelse" : "Reminder"}:{" "}
              {item.reminder_dismissed_at
                ? `${sv ? "Avfärda" : "Dismissed"} ${new Date(item.reminder_dismissed_at).toLocaleString(locale)}`
                : sv
                  ? "Aktiv"
                  : "Active"}
            </Text>
            <Button
              type="button"
              onClick={() => {
                setId(item.id);
                setInput({
                  title: item.title,
                  periodId: item.period_id,
                  responsibleActorId: item.responsible_actor_id,
                  dueAt: new Date(item.due_at).toISOString(),
                  timeZone: item.time_zone,
                  sourceReference: item.source_reference,
                  sourceRevision: item.source_revision,
                  outcomeKind: item.outcome_kind,
                });
              }}
            >
              {sv ? "Redigera" : "Edit"}
            </Button>
            {!item.reminder_dismissed_at && (
              <Button
                type="button"
                disabled={activity.isPending}
                onClick={() => activity.mutate({ item, action: "dismiss_reminder" })}
              >
                {sv ? "Avfärda påminnelse" : "Dismiss reminder"}
              </Button>
            )}
            <Box display="grid" gap="sm">
              <InputField
                label={sv ? "Ny referens för utfall" : "New outcome reference"}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
              <Button
                type="button"
                disabled={!reference.trim() || activity.isPending}
                onClick={() =>
                  activity.mutate({
                    item,
                    action: "record_outcome",
                    outcomeReference: reference.trim(),
                  })
                }
              >
                {item.current_outcome
                  ? sv
                    ? "Registrera nytt utfall"
                    : "Record new outcome"
                  : sv
                    ? "Registrera utfall"
                    : "Record outcome"}
              </Button>
            </Box>
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
            <label>
              {sv ? "Utfall" : "Outcome"}{" "}
              <select
                value={input.outcomeKind}
                onChange={(event) =>
                  setInput({
                    ...input,
                    outcomeKind: Schema.decodeUnknownSync(
                      Deadlines.DeadlineInput.fields.outcomeKind,
                    )(event.target.value),
                  })
                }
              >
                <option value="prepared">{sv ? "Förberedd" : "Prepared"}</option>
                <option value="submitted">{sv ? "Inlämnad" : "Submitted"}</option>
                <option value="accepted">{sv ? "Godkänd" : "Accepted"}</option>
              </select>
            </label>
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

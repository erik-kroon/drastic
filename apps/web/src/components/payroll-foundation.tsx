import { useState } from "react";
import * as Schema from "effect/Schema";
import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Payroll from "@open-erp/contracts/payroll-foundation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

type Kind = "employment" | "work" | "opening";
type RevisionDraft = {
  kind: Kind;
  effectiveOn: string;
  supersedes: string;
  evidenceId: string;
  body: string;
};
const examples = {
  employment: JSON.stringify(
    {
      personRef: "",
      jurisdiction: "",
      residency: "",
      payTerms: "",
      workSchedule: "",
      taxFacts: "",
    },
    null,
    2,
  ),
  work: JSON.stringify({ periodStart: "", periodEnd: "", inputs: [] }, null, 2),
  opening: JSON.stringify({ asOf: "", balanceMinor: "", obligation: "" }, null, 2),
} satisfies Record<Kind, string>;

export function PayrollFoundation({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const sv = locale === "sv";
  const client = useQueryClient();
  const [employee, setEmployee] = useState("");
  const [historyEmployee, setHistoryEmployee] = useState("");
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<RevisionDraft>({
    kind: "employment",
    effectiveOn: "",
    supersedes: "",
    evidenceId: "",
    body: examples.employment,
  });
  const [actor, setActor] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [notice, setNotice] = useState("");
  const [inputError, setInputError] = useState("");
  const [keys] = useState(() => new Map<string, string>());
  const root = `${bookPath(book)}/payroll`;
  const payrollKey = [...bookKey(book), "payroll"];
  const directory = useInfiniteQuery({
    queryKey: [...payrollKey, "employees"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${root}/employees${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Payroll.PayrollEmployeePage,
        { signal },
      );
      if (page.scope.entityId !== book.entityId || page.scope.bookId !== book.id) {
        throw new Error("Payroll employee scope mismatch");
      }
      page.items.forEach((entry) => {
        if (entry.scope.entityId !== book.entityId || entry.scope.bookId !== book.id) {
          throw new Error("Payroll employee scope mismatch");
        }
      });
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const employees = directory.data?.pages.flatMap((page) => page.items) ?? [];
  const history = useQuery(
    queryOptions({
      queryKey: [...payrollKey, "employees", selected, "revisions"],
      enabled: Boolean(selected),
      retry: false,
      queryFn: async ({ signal }) => {
        const page = await readAccounting(
          `${root}/employees/${encodeURIComponent(selected)}/revisions`,
          Payroll.PayrollHistory,
          { signal },
        );
        if (
          page.scope.entityId !== book.entityId ||
          page.scope.bookId !== book.id ||
          page.employeeId !== selected
        ) {
          throw new Error("Payroll history scope mismatch");
        }
        return page;
      },
    }),
  );
  const capture = useMutation({
    mutationFn: (payload: typeof Payroll.CapturePayrollRevision.Type) => {
      const path = `${root}/revisions`;
      return readAccounting(
        path,
        Payroll.PayrollRevision,
        mutationOptions(path, JSON.stringify(payload), keys),
      );
    },
    onSuccess: async (revision) => {
      setSelected(revision.employeeId);
      setHistoryEmployee(revision.employeeId);
      setDraft((current) => ({ ...current, supersedes: revision.id }));
      setNotice(sv ? "Faktarevision sparad." : "Fact revision saved.");
      await client.invalidateQueries({ queryKey: payrollKey });
    },
    onError: async () => {
      setNotice("");
      await client.invalidateQueries({ queryKey: payrollKey });
    },
  });
  const access = useMutation({
    mutationFn: () =>
      readAccounting(`${root}/access`, Payroll.PayrollAccessResult, {
        method: "POST",
        body: JSON.stringify({ actorId: actor, allowed }),
      }),
    onSuccess: () => {
      client.removeQueries({ queryKey: payrollKey });
      setSelected("");
      setNotice(sv ? "Behörigheten ändrades." : "Access changed.");
    },
    onError: () => setNotice(""),
  });
  const chooseEmployee = (employeeId: string) => {
    setHistoryEmployee(employeeId);
    setSelected(employeeId);
    setInputError("");
    setNotice("");
  };
  return (
    <RecordSection title={sv ? "Personaluppgifter för lön" : "Payroll employee facts"}>
      <Box display="grid" gap="lg" minWidth="zero">
        <Text>
          {sv
            ? "Endast användare med särskild lönebehörighet kan läsa och spara uppgifter. Detta beräknar inte lön eller skapar deklarationer."
            : "Only users with explicit payroll access can read or save facts. This does not calculate pay or prepare declarations."}
        </Text>
        {book.role === "operator" ? (
          <PayrollAccessSection
            locale={locale}
            actor={actor}
            allowed={allowed}
            pending={access.isPending}
            error={access.error}
            onActorChange={(value) => {
              setActor(value);
              setNotice("");
            }}
            onAllowedChange={(value) => {
              setAllowed(value);
              setNotice("");
            }}
            onSubmit={() => {
              setNotice("");
              access.mutate();
            }}
          />
        ) : null}
        <PayrollEmployeeDirectory
          locale={locale}
          employees={employees}
          pending={directory.isPending}
          success={directory.isSuccess}
          error={directory.error}
          hasNextPage={directory.hasNextPage}
          fetchingNextPage={directory.isFetchingNextPage}
          onSelect={chooseEmployee}
          onNext={() => void directory.fetchNextPage()}
        />
        <PayrollHistoryLookup
          locale={locale}
          employee={historyEmployee}
          onEmployeeChange={(value) => {
            setHistoryEmployee(value);
            setInputError("");
            setNotice("");
          }}
          onShow={() => setSelected(historyEmployee)}
        />
        <PayrollHistoryPanel
          locale={locale}
          data={history.data}
          pending={history.isPending && Boolean(selected)}
          error={history.error}
          onCorrect={(item) => {
            setEmployee(item.employeeId);
            setHistoryEmployee(item.employeeId);
            setSelected(item.employeeId);
            setDraft({
              kind: item.kind,
              effectiveOn: item.effectiveOn,
              supersedes: item.id,
              evidenceId: item.evidenceId,
              body: JSON.stringify(item.body, null, 2),
            });
            setInputError("");
            setNotice("");
          }}
        />
        <PayrollRevisionForm
          locale={locale}
          employee={employee}
          draft={draft}
          pending={capture.isPending}
          error={capture.error}
          inputError={inputError}
          onInputErrorChange={setInputError}
          onEmployeeChange={(value) => {
            setEmployee(value);
            setInputError("");
            setNotice("");
          }}
          onDraftChange={(value) => {
            setDraft(value);
            setInputError("");
            setNotice("");
          }}
          onNewFact={() => {
            keys.clear();
             setDraft((current) => ({ ...current, effectiveOn: "", supersedes: "" }));
            setInputError("");
            setNotice("");
          }}
          onSave={(payload) => {
            setNotice("");
            capture.mutate(payload);
          }}
        />
        <Text role="status" aria-live="polite">
          {notice}
        </Text>
      </Box>
    </RecordSection>
  );
}

function PayrollAccessSection(props: {
  locale: Locale;
  actor: string;
  allowed: boolean;
  pending: boolean;
  error: Error | null;
  onActorChange: (value: string) => void;
  onAllowedChange: (value: boolean) => void;
  onSubmit: () => void;
}) {
  const sv = props.locale === "sv";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <Box display="grid" gap="sm">
        <Text>
          {sv
            ? "Hantera lönebehörighet (kräver administratör)"
            : "Manage payroll access (administrator required)"}
        </Text>
        <InputField
          label={sv ? "Medlems-ID" : "Member ID"}
          value={props.actor}
          required
          pattern="[a-z][a-z0-9_-]{2,127}"
          onChange={(event) => props.onActorChange(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={props.allowed}
            onChange={(event) => props.onAllowedChange(event.target.checked)}
          />{" "}
          {sv ? "Tillåt åtkomst" : "Allow access"}
        </label>
        <Button type="submit" disabled={props.pending}>
          {sv ? "Ändra behörighet" : "Change access"}
        </Button>
        <AccountingStatus error={props.error} pending={props.pending} write locale={props.locale} />
      </Box>
    </form>
  );
}

function PayrollEmployeeDirectory(props: {
  locale: Locale;
  employees: readonly (typeof Payroll.PayrollEmployee.Type)[];
  pending: boolean;
  success: boolean;
  error: Error | null;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  onSelect: (employeeId: string) => void;
  onNext: () => void;
}) {
  const sv = props.locale === "sv";
  return (
    <Box display="grid" gap="sm">
      <Text>{sv ? "Anställda i denna bok" : "Employees in this book"}</Text>
      <AccountingStatus error={props.error} pending={props.pending} locale={props.locale} />
      {props.success && props.employees.length === 0 ? (
        <Text>{sv ? "Inga anställda ännu." : "No employees yet."}</Text>
      ) : null}
      {props.employees.map((entry) => (
        <Box key={entry.employeeId} display="flex" flexWrap="wrap" gap="sm" alignItems="center">
          <Text>{entry.employeeId}</Text>
          <Button type="button" variant="outline" onClick={() => props.onSelect(entry.employeeId)}>
            {sv ? "Visa historik" : "View history"}
          </Button>
        </Box>
      ))}
      {props.hasNextPage ? (
        <Box>
          <Button
            type="button"
            variant="outline"
            disabled={props.fetchingNextPage}
            onClick={props.onNext}
          >
            {sv ? "Läs in fler anställda" : "Load more employees"}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function PayrollHistoryLookup(props: {
  locale: Locale;
  employee: string;
  onEmployeeChange: (value: string) => void;
  onShow: () => void;
}) {
  const sv = props.locale === "sv";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.onShow();
      }}
    >
      <Box display="grid" gap="sm">
        <InputField
          label={sv ? "Sök historik för anställd-ID" : "Employee ID for history"}
          required
          pattern="[a-z][a-z0-9_-]{2,127}"
          value={props.employee}
          onChange={(event) => props.onEmployeeChange(event.target.value)}
        />
        <Button type="submit" variant="outline">
          {sv ? "Visa historik" : "View history"}
        </Button>
      </Box>
    </form>
  );
}

function PayrollHistoryPanel(props: {
  locale: Locale;
  data: typeof Payroll.PayrollHistory.Type | undefined;
  pending: boolean;
  error: Error | null;
  onCorrect: (item: typeof Payroll.PayrollHistoryItem.Type) => void;
}) {
  const sv = props.locale === "sv";
  return (
    <>
      <AccountingStatus error={props.error} pending={props.pending} locale={props.locale} />
      {props.data ? (
        <Box display="grid" gap="sm">
          <Text>
            {sv ? "Historik" : "History"}: {props.data.employeeId}
          </Text>
          {props.data.items.length === 0 ? (
            <Text>{sv ? "Inga revisioner." : "No revisions."}</Text>
          ) : null}
          {props.data.items.map((item) => (
            <Box key={item.id} display="grid" gap="sm">
              <Text>
                {item.isCurrent
                  ? sv
                    ? "Aktuell revision"
                    : "Current revision"
                  : sv
                    ? "Historisk revision"
                    : "Historical revision"}{" "}
                · {item.kind} · {item.effectiveOn} · {item.id} · {item.createdAt}
              </Text>
              <Text>
                {sv ? "Underlag" : "Evidence"}: {item.evidenceId} ·{" "}
                {sv ? "Skapad av" : "Created by"}: {item.createdBy}
              </Text>
              {item.supersedes ? (
                <Text>
                  {sv ? "Ersätter" : "Supersedes"}: {item.supersedes}
                </Text>
              ) : null}
              <Text>{JSON.stringify(item.body, null, 2)}</Text>
              {item.isCurrent ? (
                <Button type="button" variant="outline" onClick={() => props.onCorrect(item)}>
                  {sv ? "Rätta med ny revision" : "Correct with new revision"}
                </Button>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}
    </>
  );
}

function PayrollRevisionForm(props: {
  locale: Locale;
  employee: string;
  draft: RevisionDraft;
  pending: boolean;
  error: Error | null;
  inputError: string;
  onInputErrorChange: (value: string) => void;
  onEmployeeChange: (value: string) => void;
  onDraftChange: (value: RevisionDraft) => void;
  onNewFact: () => void;
  onSave: (payload: typeof Payroll.CapturePayrollRevision.Type) => void;
}) {
  const sv = props.locale === "sv";
  const update = (change: Partial<RevisionDraft>) =>
    props.onDraftChange({ ...props.draft, ...change });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.onInputErrorChange("");
        try {
          const parsed: unknown = JSON.parse(props.draft.body);
          props.onSave(
            Schema.decodeUnknownSync(Payroll.CapturePayrollRevision)({
              employeeId: props.employee,
              kind: props.draft.kind,
              effectiveOn: props.draft.effectiveOn,
              supersedes: props.draft.supersedes || null,
              evidenceId: props.draft.evidenceId,
              body: parsed,
            }),
          );
        } catch {
          props.onInputErrorChange(
            sv
              ? "Ange giltiga uppgifter för typen i JSON."
              : "Enter valid facts for this type in JSON.",
          );
        }
      }}
    >
      <Box display="grid" gap="sm">
        <Text>
          {props.draft.supersedes
            ? sv
              ? "Rätta aktuell revision"
              : "Correct current revision"
            : sv
              ? "Spara ny faktarevision"
              : "Save a new fact revision"}
        </Text>
        <InputField
          label={sv ? "Anställd-ID" : "Employee ID"}
          required
          pattern="[a-z][a-z0-9_-]{2,127}"
          disabled={Boolean(props.draft.supersedes)}
          value={props.employee}
          onChange={(event) => props.onEmployeeChange(event.target.value)}
        />
        <label>
          {sv ? "Typ av uppgift" : "Fact type"}
          <select
            disabled={Boolean(props.draft.supersedes)}
            value={props.draft.kind}
            onChange={(event) => {
              const kind = Schema.decodeUnknownSync(
                Schema.Literals(["employment", "work", "opening"]),
              )(event.target.value);
              update({ kind, body: examples[kind] });
            }}
          >
            <option value="employment">{sv ? "Anställning" : "Employment"}</option>
            <option value="work">{sv ? "Arbetsunderlag" : "Work inputs"}</option>
            <option value="opening">{sv ? "Ingående skuld" : "Opening obligation"}</option>
          </select>
        </label>
        <InputField
          label={sv ? "Gäller från" : "Effective date"}
          type="date"
          required
          disabled={Boolean(props.draft.supersedes)}
          value={props.draft.effectiveOn}
          onChange={(event) => update({ effectiveOn: event.target.value })}
        />
        <InputField
          label={sv ? "Underlagsreferens" : "Evidence reference"}
          required
          pattern="[a-z][a-z0-9_-]{2,127}"
          value={props.draft.evidenceId}
          onChange={(event) => update({ evidenceId: event.target.value })}
        />
        <TextareaField
          label={sv ? "Fakta (JSON)" : "Facts (JSON)"}
          required
          rows={9}
          value={props.draft.body}
          onChange={(event) => update({ body: event.target.value })}
        />
        <Text>
          {props.draft.supersedes
            ? sv
              ? `Ersätter revision ${props.draft.supersedes}. Tidigare revisioner förblir oförändrade.`
              : `Supersedes revision ${props.draft.supersedes}. Earlier revisions remain unchanged.`
            : sv
              ? "En ny uppgift för samma anställda, typ och datum måste utgå från aktuell revision."
              : "A new fact for the same employee, type and date must be based on its current revision."}
        </Text>
        {props.draft.supersedes ? (
          <Box>
            <Button type="button" variant="outline" onClick={props.onNewFact}>
              {sv ? "Lägg till en separat uppgift" : "Add a separate fact"}
            </Button>
          </Box>
        ) : null}
        {props.inputError ? <Text role="alert">{props.inputError}</Text> : null}
        <Button type="submit" disabled={props.pending}>
          {sv ? "Spara revision" : "Save revision"}
        </Button>
        <AccountingStatus error={props.error} pending={props.pending} write locale={props.locale} />
      </Box>
    </form>
  );
}

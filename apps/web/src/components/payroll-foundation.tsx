import { useState } from "react";
import * as Schema from "effect/Schema";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Payroll from "@open-erp/contracts/payroll-foundation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

type Kind = "employment" | "work" | "opening";
const examples: Record<Kind, string> = {
  employment: JSON.stringify({ personRef: "", jurisdiction: "", residency: "", payTerms: "", workSchedule: "", taxFacts: "" }, null, 2),
  work: JSON.stringify({ periodStart: "", periodEnd: "", inputs: [] }, null, 2),
  opening: JSON.stringify({ asOf: "", balanceMinor: "", obligation: "" }, null, 2),
};
export function PayrollFoundation({ book, locale }: { book: typeof Accounting.Book.Type; locale: Locale }) {
  const sv = locale === "sv";
  const client = useQueryClient();
  const [employee, setEmployee] = useState("");
  const [selected, setSelected] = useState("");
  const [kind, setKind] = useState<Kind>("employment");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [body, setBody] = useState(examples.employment);
  const [actor, setActor] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [notice, setNotice] = useState("");
  const [inputError, setInputError] = useState("");
  const [keys] = useState(() => new Map<string, string>());
  const root = `${bookPath(book)}/payroll`;
  const historyKey = [...bookKey(book), "payroll", selected];
  const history = useQuery(queryOptions({ queryKey: historyKey, enabled: Boolean(selected), queryFn: ({ signal }) =>
    readAccounting(`${root}/employees/${encodeURIComponent(selected)}/revisions`, Payroll.PayrollHistory, { signal }) }));
  const capture = useMutation({ mutationFn: (payload: typeof Payroll.CapturePayrollRevision.Type) => {
    const path = `${root}/revisions`;
    const serialized = JSON.stringify(payload);
    return readAccounting(path, Payroll.PayrollRevision, mutationOptions(path, serialized, keys));
  }, onSuccess: async (revision) => {
    setSelected(revision.employeeId); setNotice(sv ? "Faktarevision sparad." : "Fact revision saved.");
    await client.invalidateQueries({ queryKey: [...bookKey(book), "payroll", revision.employeeId] });
  }, onError: () => setNotice("") });
  const access = useMutation({ mutationFn: () => readAccounting(`${root}/access`, Payroll.PayrollAccessResult,
    { method: "POST", body: JSON.stringify({ actorId: actor, allowed }) }),
    onSuccess: () => setNotice(sv ? "Behörigheten ändrades." : "Access changed."), onError: () => setNotice("") });
  return <RecordSection title={sv ? "Personaluppgifter för lön" : "Payroll employee facts"}>
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{sv ? "Endast användare med särskild lönebehörighet kan läsa och spara uppgifter. Detta beräknar inte lön eller skapar deklarationer." : "Only users with explicit payroll access can read or save facts. This does not calculate pay or prepare declarations."}</Text>
      {book.role === "operator" ? <form onSubmit={(event) => { event.preventDefault(); setNotice(""); access.mutate(); }}><Box display="grid" gap="sm">
        <Text>{sv ? "Hantera lönebehörighet (kräver administratör)" : "Manage payroll access (administrator required)"}</Text>
        <InputField label={sv ? "Medlems-ID" : "Member ID"} value={actor} required pattern="[a-z][a-z0-9_-]{2,127}" onChange={event => setActor(event.target.value)} />
        <label><input type="checkbox" checked={allowed} onChange={event => setAllowed(event.target.checked)} /> {sv ? "Tillåt åtkomst" : "Allow access"}</label>
        <Button type="submit" disabled={access.isPending}>{sv ? "Ändra behörighet" : "Change access"}</Button>
        <AccountingStatus error={access.error} pending={access.isPending} write locale={locale} />
      </Box></form> : null}
      <form onSubmit={event => { event.preventDefault(); setSelected(employee); }}><Box display="grid" gap="sm">
        <InputField label={sv ? "Sök historik för anställd-ID" : "Employee ID for history"} required pattern="[a-z][a-z0-9_-]{2,127}" value={employee} onChange={event => setEmployee(event.target.value)} />
        <Button type="submit" variant="outline">{sv ? "Visa historik" : "View history"}</Button>
      </Box></form>
      <AccountingStatus error={history.error} pending={history.isPending && Boolean(selected)} locale={locale} />
      {history.data ? <Box display="grid" gap="sm"><Text>{sv ? "Historik" : "History"}: {history.data.employeeId}</Text>
        {history.data.items.length === 0 ? <Text>{sv ? "Inga revisioner." : "No revisions."}</Text> : null}
        {history.data.items.map(item => <Box key={item.id} display="grid" gap="sm">
          <Text>{item.kind} · {item.effectiveOn} · {item.id} · {item.createdAt}</Text>
          <Text>{sv ? "Underlag" : "Evidence"}: {item.evidenceId} · {sv ? "Skapad av" : "Created by"}: {item.createdBy}</Text>
          {item.supersedes ? <Text>{sv ? "Ersätter" : "Supersedes"}: {item.supersedes}</Text> : null}
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(item.body, null, 2)}</pre>
          <Button type="button" variant="outline" onClick={() => { setEmployee(item.employeeId); setKind(item.kind); setEffectiveOn(item.effectiveOn); setSupersedes(item.id); setEvidenceId(item.evidenceId); setBody(JSON.stringify(item.body, null, 2)); }}>{sv ? "Rätta med ny revision" : "Correct with new revision"}</Button>
        </Box>)}
      </Box> : null}
      <form onSubmit={event => { event.preventDefault(); setNotice(""); setInputError("");
        try { const parsed: unknown = JSON.parse(body); capture.mutate(Schema.decodeUnknownSync(Payroll.CapturePayrollRevision)({ employeeId: employee, kind, effectiveOn, supersedes: supersedes || null, evidenceId, body: parsed })); }
        catch { setInputError(sv ? "Ange giltiga uppgifter för typen i JSON." : "Enter valid facts for this type in JSON."); }
      }}><Box display="grid" gap="sm">
        <Text>{sv ? "Spara ny faktarevision" : "Save a new fact revision"}</Text>
        <InputField label={sv ? "Anställd-ID" : "Employee ID"} required pattern="[a-z][a-z0-9_-]{2,127}" value={employee} onChange={event => setEmployee(event.target.value)} />
        <label>{sv ? "Typ av uppgift" : "Fact type"}<select value={kind} onChange={event => { const next = event.target.value as Kind; setKind(next); setBody(examples[next]); setSupersedes(""); }}>
          <option value="employment">{sv ? "Anställning" : "Employment"}</option><option value="work">{sv ? "Arbetsunderlag" : "Work inputs"}</option><option value="opening">{sv ? "Ingående skuld" : "Opening obligation"}</option>
        </select></label>
        <InputField label={sv ? "Gäller från" : "Effective date"} type="date" required value={effectiveOn} onChange={event => setEffectiveOn(event.target.value)} />
        <InputField label={sv ? "Underlagsreferens" : "Evidence reference"} required value={evidenceId} onChange={event => setEvidenceId(event.target.value)} />
        <InputField label={sv ? "Ersätter revisions-ID (valfritt)" : "Superseded revision ID (optional)"} value={supersedes} onChange={event => setSupersedes(event.target.value)} />
        <label>{sv ? "Fakta (JSON)" : "Facts (JSON)"}<textarea required rows={9} value={body} onChange={event => setBody(event.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box" }} /></label>
        <Text>{sv ? "Fyll i fälten utan att anta skattesats eller belopp. Korrigeringar sparar tidigare revision." : "Fill in fields without assuming a tax rate or amount. Corrections keep the earlier revision."}</Text>
        {inputError ? <Text role="alert">{inputError}</Text> : null}
        <Button type="submit" disabled={capture.isPending}>{sv ? "Spara revision" : "Save revision"}</Button>
        <AccountingStatus error={capture.error} pending={capture.isPending} write locale={locale} />
      </Box></form>
      {notice ? <Text role="status">{notice}</Text> : null}
    </Box>
  </RecordSection>;
}

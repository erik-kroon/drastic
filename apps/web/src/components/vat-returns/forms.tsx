import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { vatCopy } from "./copy";

type Common = { book: typeof Accounting.Book.Type; locale: Locale };
function nullable(fields: FormData, name: string) {
  const value = fields.get(name);
  return typeof value === "string" && value !== "" ? value : null;
}
const requiredText = ["sourceLocator", "description", "evidenceId", "reviewEvidenceId", "reviewRationale", "netMinor", "vatMinor", "grossMinor"] as const;
const optionalText = ["currency", "issuedOn", "receivedOn", "suppliedOn", "taxPointOn", "dateBasis", "periodEvidenceId", "registrationEvidenceId", "methodEvidenceId", "treatmentEvidenceId", "deductionEvidenceId", "voucherId"] as const;
const stateFields = ["registration", "method", "treatment", "domesticEligibility", "fullDeduction"] as const;
export function VatFactForm(props: Common & { current?: typeof Vat.VatFact.Type; onSaved: (id: string) => void }) {
  const { book, locale, current } = props;
  const copy = vatCopy(locale);
  const [expenseId, setExpenseId] = useState("");
  const expenses = useQuery({ queryKey: [...bookKey(book), "expense-tax", "inventory"], queryFn: ({ signal }) => readAccounting(`${bookPath(book)}/expense-tax/sources`, Tax.TaxInventory, { signal }), retry: false, enabled: !current });
  const source = expenses.data?.sources.find((row) => row.current.sourceId === expenseId && row.reviewCurrent);
  const review = source?.latestReview;
  const imported: Partial<typeof Vat.VatFactInput.Type> | undefined = source && review ? {
    sourceKey: `expense_${source.current.sourceId}`, recordClass: source.current.facts.recordClass,
    evidenceId: source.current.facts.evidenceId, sourceLocator: source.current.facts.sourceLocator,
    description: source.current.facts.description, reviewEvidenceId: review.facts.evidenceId, reviewRationale: review.facts.rationale,
    treatment: "domestic_purchase", netMinor: source.current.facts.amounts.netMinor ?? undefined,
    vatMinor: source.current.facts.amounts.vatMinor ?? undefined, grossMinor: source.current.facts.amounts.grossMinor ?? undefined,
    currency: source.current.facts.currency, issuedOn: source.current.facts.issuedOn, receivedOn: source.current.facts.receivedOn,
    suppliedOn: review.facts.suppliedOn, taxPointOn: review.facts.taxPointOn, dateBasis: review.facts.dateBasis,
    registration: review.facts.registration, registrationEvidenceId: review.facts.registrationEvidenceId,
    method: review.facts.method, methodEvidenceId: review.facts.methodEvidenceId, voucherId: source.current.facts.voucherId,
    deductionEvidenceId: review.facts.deductionEvidenceId,
    expenseLink: { sourceId: source.current.sourceId, sourceDigest: source.current.digest, reviewDigest: review.digest },
  } : undefined;
  return <Box display="grid" gap="lg" minWidth="zero">
    {!current ? <>
      <SelectField label={copy.importExpense} value={expenseId} onValueChange={(value) => setExpenseId(value ?? "")} options={[{ value: "", label: copy.noImport }, ...(expenses.data?.sources.filter((row) => row.reviewCurrent && row.latestReview?.facts.treatment === "domestic_purchase").map((row) => ({ value: row.current.sourceId, label: row.current.facts.description })) ?? [])]} />
      <AccountingStatus locale={locale} pending={expenses.isPending} error={expenses.error} />
    </> : null}
    <VatFactEditor key={current?.digest ?? expenseId} {...props} initial={current?.input ?? imported} />
  </Box>;
}
function VatFactEditor({ book, locale, current, initial, onSaved }: Common & { current?: typeof Vat.VatFact.Type; initial?: Partial<typeof Vat.VatFactInput.Type>; onSaved: (id: string) => void }) {
  const copy = vatCopy(locale);
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());
  const save = useMutation({ mutationFn: (input: typeof Vat.VatFactInput.Type) => {
    const path = `${bookPath(book)}/vat-returns/facts`;
    return readAccounting(path, Vat.VatFact, mutationOptions(path, JSON.stringify(input), keys.current));
  }, onSuccess: (fact) => onSaved(fact.factId) });
  const options = {
    registration: [{ value: "registered", label: copy.registered }, { value: "not_registered", label: copy.notRegistered }],
    method: [{ value: "accrual", label: copy.accrual }, { value: "cash", label: copy.cash }],
    treatment: [{ value: "domestic_sale", label: copy.sale }, { value: "domestic_purchase", label: copy.purchase }, { value: "unsupported", label: copy.unsupported }],
    domesticEligibility: [{ value: "confirmed", label: copy.confirmed }, { value: "unsupported", label: copy.unsupported }],
    fullDeduction: [{ value: "confirmed", label: copy.confirmed }, { value: "unsupported", label: copy.unsupported }],
  };
  return <Box as="form" display="grid" gap="lg" minWidth="zero" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const linked = nullable(fields, "expenseSourceId");
    const decoded = Schema.decodeUnknownOption(Vat.VatFactInput)({
      sourceKey: current?.input.sourceKey ?? fields.get("sourceKey"), expectedDigest: current?.digest ?? null,
      recordClass: current?.input.recordClass ?? fields.get("recordClass"),
      ...Object.fromEntries(requiredText.map((name) => [name, fields.get(name)])),
      ...Object.fromEntries(optionalText.map((name) => [name, nullable(fields, name)])),
      ...Object.fromEntries(stateFields.map((name) => [name, fields.get(name)])),
      taxLineIds: (nullable(fields, "taxLineIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean),
      expenseLink: linked ? { sourceId: linked, sourceDigest: fields.get("expenseSourceDigest"), reviewDigest: fields.get("expenseReviewDigest") } : null,
    });
    setInvalid(decoded._tag === "None");
    if (decoded._tag === "Some") save.mutate(decoded.value);
  }}>
    <Text>{copy.amountHelp}</Text><Text>{copy.optional}</Text>
    <Box as="fieldset" disabled={save.isPending || save.isSuccess} borderWidth="none" padding="none" margin="none" display="grid" gap="md" minWidth="zero">
      <InputField label={copy.sourceKey} name="sourceKey" required pattern="[a-zA-Z0-9_\-]{1,128}" readOnly={Boolean(current)} defaultValue={initial?.sourceKey} />
      {current ? <Text>{current.input.recordClass === "synthetic" ? copy.synthetic : copy.actual}</Text> : <SelectField label={copy.recordClass} name="recordClass" required defaultValue={initial?.recordClass ?? ""} options={[{ value: "", label: "—" }, { value: "actual_company", label: copy.actual }, { value: "synthetic", label: copy.synthetic }]} />}
      {requiredText.map((name) => <InputField key={name} label={copy[name]} name={name} required maxLength={name.endsWith("Minor") ? 38 : 2000} pattern={name.endsWith("Minor") ? "(0|[1-9][0-9]{0,37})" : undefined} inputMode={name.endsWith("Minor") ? "numeric" : undefined} defaultValue={initial?.[name]} />)}
      {stateFields.map((name) => <SelectField key={name} label={copy[name]} name={name} defaultValue={initial?.[name] ?? "unknown"} options={[{ value: "unknown", label: copy.unknown }, ...options[name]]} />)}
      {optionalText.map((name) => <InputField key={name} label={copy[name]} name={name} type={name.endsWith("On") ? "date" : "text"} maxLength={2000} defaultValue={initial?.[name] ?? ""} />)}
      <Text>{copy.linksHelp}</Text>
      <InputField label={copy.taxLineIds} name="taxLineIds" defaultValue={initial?.taxLineIds?.join(", ") ?? ""} />
      <InputField label={copy.expenseSourceId} name="expenseSourceId" defaultValue={initial?.expenseLink?.sourceId ?? ""} />
      <InputField label={copy.expenseSourceDigest} name="expenseSourceDigest" defaultValue={initial?.expenseLink?.sourceDigest ?? ""} />
      <InputField label={copy.expenseReviewDigest} name="expenseReviewDigest" defaultValue={initial?.expenseLink?.reviewDigest ?? ""} />
      <Box><Button size="xl" type="submit">{copy.save}</Button></Box>
    </Box>
    <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.saved : ""}</Text>
    <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
  </Box>;
}
export function VatDraftForm({ book, locale, onSaved }: Common & { onSaved: (id: string) => void }) {
  const copy = vatCopy(locale);
  const [mode, setMode] = useState<(typeof Vat.PrepareVatDraft.Type)["mode"]>("actual_review");
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());
  const prepare = useMutation({ mutationFn: (input: typeof Vat.PrepareVatDraft.Type) => {
    const path = `${bookPath(book)}/vat-returns/drafts`;
    return readAccounting(path, Vat.VatDraft, mutationOptions(path, JSON.stringify(input), keys.current));
  }, onSuccess: (draft, input) => {
    keys.current.delete(`${bookPath(book)}/vat-returns/drafts:${JSON.stringify(input)}`);
    onSaved(draft.id);
  } });
  return <Box as="form" display="grid" gap="lg" minWidth="zero" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const decoded = Schema.decodeUnknownOption(Vat.PrepareVatDraft)({ mode, startsOn: fields.get("startsOn"), endsOn: fields.get("endsOn"), periodEvidenceId: nullable(fields, "periodEvidenceId"), otherBoxes: mode === "actual_review" ? "unknown" : fields.get("otherBoxes") });
    setInvalid(decoded._tag === "None");
    if (decoded._tag === "Some") prepare.mutate(decoded.value);
  }}>
    <Box as="fieldset" disabled={prepare.isPending} borderWidth="none" padding="none" margin="none" display="grid" gap="md" minWidth="zero">
      <SelectField label={copy.mode} value={mode} onValueChange={(value) => setMode(value === "synthetic_demonstration" ? "synthetic_demonstration" : "actual_review")} options={[{ value: "actual_review", label: copy.actual }, { value: "synthetic_demonstration", label: copy.synthetic }]} />
      <InputField label={copy.startsOn} name="startsOn" type="date" required />
      <InputField label={copy.endsOn} name="endsOn" type="date" required />
      <InputField label={copy.periodEvidenceId} name="periodEvidenceId" />
      {mode === "synthetic_demonstration" ? <SelectField label={copy.otherBoxes} name="otherBoxes" defaultValue="unknown" options={[{ value: "unknown", label: copy.unknown }, { value: "absent_in_synthetic_example", label: copy.absence }]} /> : <Text>{copy.actualBlocked}</Text>}
      <Box><Button size="xl" type="submit">{copy.prepare}</Button></Box>
    </Box>
    <Text role="status">{invalid ? copy.invalid : prepare.isSuccess ? copy.saved : ""}</Text>
    <AccountingStatus locale={locale} write pending={prepare.isPending} error={prepare.error} />
  </Box>;
}

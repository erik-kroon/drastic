import { useState } from "react";
import * as Closing from "@open-erp/contracts/closing";
import { Check, Circle } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import { PageCaption, RegisterSearch } from "@open-erp/ui/components/accounting-page";
import { RecordSection, RecordSplit } from "@open-erp/ui/components/record-layout";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { useBookWorkspace } from "@/lib/book-context";
import { bookPath } from "@/lib/accounting-api";
import { closingCopy } from "./copy";

type Decision = {
  family: (typeof Closing.ClosingFamily.literals)[number];
  status: (typeof Closing.ClosingFamilyStatus.literals)[number] | null;
  reviewedOn: string;
  rationale: string;
};

export function PeriodInventoryEditor({
  basis,
  onSaved,
}: {
  basis: typeof Closing.ClosingReadiness.Type;
  onSaved: () => void;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const copy = closingCopy(locale);
  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());

  const [decisions, setDecisions] = useState<Decision[]>(() =>
    Closing.ClosingFamily.literals.map((family) => {
      const saved = basis.inventory?.families?.find((item) => item.family === family);

      return {
        family,
        status: saved?.status ?? null,
        reviewedOn: today,
        rationale: saved?.rationale ?? "",
      };
    }),
  );

  const [selected, setSelected] = useState(0);

  const [accounts, setAccounts] = useState<readonly string[]>(
    basis.inventory?.bankAccountIds ?? [],
  );

  const [accountSearch, setAccountSearch] = useState("");
  const current = decisions[selected];

  const complete = (item: Decision) =>
    !!item.status && !!item.rationale.trim() && !!item.reviewedOn;

  const completed = decisions.filter(complete).length;

  const update = (change: Partial<Decision>) =>
    setDecisions((items) =>
      items.map((item, index) => (index === selected ? { ...item, ...change } : item)),
    );

  if (!current) return null;

  return (
    <EvidenceCommandForm
      book={book}
      locale={locale}
      path={`${bookPath(book)}/periods/${encodeURIComponent(basis.periodId)}/closing-source-inventories`}
      schema={Closing.DeclareClosingInventory}
      output={Closing.ClosingInventory}
      label={sv ? "Spara periodgranskning" : "Save period review"}
      stickyFooter
      canSubmit={completed === decisions.length}
      footerSummary={
        <PageCaption>
          {completed} / {decisions.length} {sv ? "områden granskade" : "areas reviewed"}
        </PageCaption>
      }
      source={() => ({
        title: `${sv ? "Periodgranskning" : "Period review"} · ${basis.startsOn} – ${basis.endsOn}`,
        origin: "Period scope entered in OpenERP",
        mediaType: "application/json",
        content: JSON.stringify({ periodId: basis.periodId, bankAccountIds: accounts, decisions }),
      })}
      input={(_, evidence) => ({
        evidenceId: evidence.id,
        bankAccountIds: accounts,
        families: decisions.map((item) => ({ ...item, evidenceId: evidence.id })),
      })}
      onSuccess={onSaved}
    >
      <PageCaption>
        {sv
          ? "Gå igenom vad som gäller för perioden. Besluten, datumen och dina motiveringar sparas som granskningsunderlag. De bekräftar inte att alla originalunderlag är kompletta."
          : "Review what applies to this period. Your decisions, dates and reasons are retained as review evidence. They do not establish that all original documents are complete."}
      </PageCaption>
      <RecordSplit
        aside={
          <RecordSection title={sv ? "Områden att granska" : "Review areas"} sticky>
            <Box display="grid" gap="sm">
              {decisions.map((item, index) => (
                <Button
                  key={item.family}
                  static
                  variant={index === selected ? "secondary" : "ghost"}
                  aria-pressed={index === selected}
                  onClick={() => setSelected(index)}
                >
                  {complete(item) ? <Check size={14} /> : <Circle size={14} />}
                  {copy.familyLabels[item.family]}
                </Button>
              ))}
            </Box>
          </RecordSection>
        }
      >
        <RecordSection title={copy.familyLabels[current.family]}>
          <ChoiceField
            label={sv ? "Vad gäller för perioden?" : "What applies to this period?"}
            value={current.status ?? ""}
            onValueChange={(value) => {
              if (
                value === "required" ||
                value === "not_applicable" ||
                value === "unsupported" ||
                value === "unknown"
              )
                update({ status: value });
            }}
            options={[
              { value: "required", label: sv ? "Behöver granskas" : "Review required" },
              { value: "not_applicable", label: sv ? "Gäller inte" : "Not applicable" },
              {
                value: "unsupported",
                label: sv ? "Kontroll saknas i tjänsten" : "Control not supported",
              },
              { value: "unknown", label: sv ? "Ännu inte bedömt" : "Not yet assessed" },
            ]}
          />
          <InputField
            label={copy.familyDate}
            type="date"
            value={current.reviewedOn}
            required
            onChange={(event) => update({ reviewedOn: event.target.value })}
          />
          <TextareaField
            label={sv ? "Bedömning och underlag" : "Assessment and supporting records"}
            value={current.rationale}
            required
            maxLength={2000}
            rows={5}
            onChange={(event) => update({ rationale: event.target.value })}
          />
          <PageCaption>
            {sv
              ? "Beskriv varför, och ange vilka underlag du har granskat. Saknas information, välj Ännu inte bedömt."
              : "Explain why and name the records you reviewed. If information is missing, choose Not yet assessed."}
          </PageCaption>
          {current.family === "bank_sources" ? (
            <RecordSection title={sv ? "Bankkonton som ingår" : "Expected bank accounts"}>
              <PageCaption>
                {sv
                  ? "Markera alla konton som ska stämmas av. Lämna tomt bara om inga bankkonton ingår."
                  : "Select every account to reconcile. Leave empty only if no bank accounts apply."}
              </PageCaption>
              <RegisterSearch
                aria-label={sv ? "Sök bankkonto" : "Find bank account"}
                placeholder={sv ? "Sök kontonummer eller namn…" : "Search number or name…"}
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
              />
              {setup.accounts
                .filter(
                  (account) =>
                    (account.active || accounts.includes(account.id)) &&
                    `${account.code} ${account.name}`
                      .toLocaleLowerCase(locale)
                      .includes(accountSearch.toLocaleLowerCase(locale)),
                )
                .slice(0, 20)
                .map((account) => (
                  <Box
                    as="label"
                    key={account.id}
                    display="flex"
                    gap="md"
                    alignItems="center"
                    paddingBlock="sm"
                  >
                    <input
                      type="checkbox"
                      checked={accounts.includes(account.id)}
                      onChange={(event) =>
                        setAccounts(
                          event.target.checked
                            ? [...accounts, account.id]
                            : accounts.filter((id) => id !== account.id),
                        )
                      }
                    />
                    {account.code} · {account.name}
                  </Box>
                ))}
              <PageCaption>
                {sv ? "Valda konton" : "Selected accounts"}:{" "}
                {setup.accounts
                  .filter((account) => accounts.includes(account.id))
                  .map((account) => `${account.code} · ${account.name}`)
                  .join(", ") || (sv ? "Inga" : "None")}
              </PageCaption>
            </RecordSection>
          ) : null}
          <Box display="flex" justifyContent="between" gap="md">
            <Button
              static
              variant="ghost"
              disabled={selected === 0}
              onClick={() => setSelected(selected - 1)}
            >
              {sv ? "Föregående område" : "Previous area"}
            </Button>
            <Button
              static
              variant="outline"
              disabled={selected === decisions.length - 1}
              onClick={() => setSelected(selected + 1)}
            >
              {sv ? "Nästa område" : "Next area"}
            </Button>
          </Box>
        </RecordSection>
      </RecordSplit>
      <Box as="label" display="flex" gap="md" alignItems="start">
        <input type="checkbox" required />
        {copy.confirmInventory}
      </Box>
    </EvidenceCommandForm>
  );
}

import * as Predicate from "effect/Predicate";
import { SetupBlock, SetupText, setupLayoutStyles } from "@open-erp/ui/components/setup-parts";
import { useRef, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import {
  SetupActions,
  SetupButton,
  SetupCaption,
  SetupContent,
  SetupPageContent,
  SetupTitle,
} from "@open-erp/ui/components/setup-workspace";
import { SetupTable } from "@open-erp/ui/components/setup-table";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";
import { formatDate, formatMoment, useOnboardingCommand, useOnboardingFacts } from "./data";
import { personName } from "./lifecycle";
import { PendingRead, SetupLink, type OpenOnboardingView } from "./shared";

type Fact = (typeof Profiles.CompanyFactPage.Type.items)[number];

const labels = {
  legal_form: "Företagsform",
  fiscal_year: "Räkenskapsår",
  accounting_method: "Redovisningsmetod",
  vat_period: "Momsperiod",
  base_currency: "Valuta",
  reporting_framework: "Regelverk",
} satisfies Partial<Record<typeof Profiles.FactKind.Type, string>>;

type VisibleFact = keyof typeof labels;

const kinds: VisibleFact[] = [
  "legal_form",
  "fiscal_year",
  "accounting_method",
  "vat_period",
  "base_currency",
  "reporting_framework",
];

const values = {
  aktiebolag: "Aktiebolag",
  enskild_firma: "Enskild firma",
  accrual: "Fakturametoden",
  cash: "Kontantmetoden",
  quarterly: "Kvartal",
  monthly: "Månad",
  yearly: "År",
};

function factText(fact: Fact | undefined) {
  if (!fact || fact.revision.value.state === "unknown") return "Ej angivet";

  if (fact.revision.value.state === "not_applicable") return "Inte tillämpligt";
  const value = fact.revision.value.value;

  if (typeof value === "object")
    return `${formatDate(value.startsOn, false)} till ${formatDate(value.endsOn, false)}`;

  if (typeof value === "string" && value in values)
    return values[
      Schema.decodeUnknownSync(
        Schema.Literals([
          "aktiebolag",
          "enskild_firma",
          "accrual",
          "cash",
          "quarterly",
          "monthly",
          "yearly",
        ]),
      )(value)
    ];

  return String(value);
}

export function OnboardingProfile({
  workspace,
  lifecycle,
  open,
}: {
  workspace: typeof Onboarding.OnboardingWorkspace.Type;
  lifecycle: typeof Onboarding.OnboardingLifecycle.Type;
  open: OpenOnboardingView;
}) {
  const { book, setup } = useBookWorkspace();

  const facts = useOnboardingFacts(
    workspace.case.configuration.dates.candidateLiveOn ?? setup.today,
  );

  const [editing, setEditing] = useState<VisibleFact | null>(null);

  const evidenceIds = [
    ...new Set(
      facts.data?.flatMap((fact) => fact.revision.evidence.map((item) => item.evidenceId)) ?? [],
    ),
  ];

  const evidence = useQueries({
    queries: evidenceIds.map((id) => ({
      queryKey: [...bookKey(book), "evidence", id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readAccounting(
          `${bookPath(book)}/evidence/${encodeURIComponent(id)}`,
          Accounting.EvidenceContent,
          { signal },
        ),
      retry: false,
    })),
  });

  const [confirming, setConfirming] = useState<Fact | null>(null);
  const [decision, setDecision] = useState<Fact | null>(null);

  const confirm = useOnboardingCommand(
    `${bookPath(book)}/company-facts/${encodeURIComponent(confirming?.revision.id ?? "unselected")}/reviews`,
    Profiles.ReviewFactRevision,
    Profiles.FactReview,
    () => setConfirming(null),
  );

  const missing = kinds.filter((kind) => {
    const fact = facts.data?.find((item) => item.revision.factKind === kind);

    return !fact || fact.revision.value.state === "unknown" || fact.review?.result !== "confirmed";
  });

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page"])}>
      <SetupTitle>Företagsprofil</SetupTitle>
      <SetupText as="p" layout={["subtitle"]}>
        Fakta, källor och giltighet för företaget.
      </SetupText>
      <PendingRead
        pending={facts.isPending}
        error={facts.error}
        retry={() => {
          void facts.refetch();
        }}
      />
      {facts.data ? (
        <SetupBlock layout={["section"]}>
          <SetupTable
            title="Företagsprofil"
            width={tokens.setupWorkspaceWidth}
            columns={[
              { id: "fact", label: "Fakta", width: tokens.setupColumn150 },
              { id: "value", label: "Värde", width: tokens.setupColumn230 },
              { id: "date", label: "Gäller från", width: tokens.setupColumn100 },
              { id: "source", label: "Källa", width: tokens.setupColumn120 },
              { id: "status", label: "Status", width: tokens.setupColumn200 },
              { id: "actions", label: "", width: tokens.setupColumn184 },
            ]}
            rows={kinds.map((kind) => {
              const fact = facts.data.find((item) => item.revision.factKind === kind);
              const known = fact?.revision.value.state === "known";
              const confirmed = known && fact.review?.result === "confirmed";

              const namedReview =
                confirmed && (kind === "accounting_method" || kind === "reporting_framework");

              const source = evidence.find((item) =>
                fact?.revision.evidence.some((ref) => ref.evidenceId === item.data?.id),
              )?.data;

              return {
                id: kind,
                tone: !known ? "warning" : undefined,
                cells: [
                  <SetupText key="label" layout={["secondary"]}>
                    {labels[kind]}
                  </SetupText>,
                  factText(fact),
                  fact ? formatDate(fact.revision.effectiveFrom) : "Ej angivet",
                  source?.title ?? "Ej angiven",
                  <SetupText
                    key="status"
                    layout={[confirmed ? "success" : known ? "secondary" : "warning"]}
                  >
                    {confirmed
                      ? namedReview && fact.review
                        ? `✓ Bekräftad av ${personName(lifecycle, fact.review.reviewer)}`
                        : "✓ Bekräftad"
                      : known
                        ? "○ Läst, behöver bekräftas"
                        : "! Behöver uppgift"}
                  </SetupText>,
                  <SetupBlock key="actions" layout={["actions"]}>
                    {namedReview ? (
                      <SetupButton
                        variant="ghost"
                        styleX={setupLayoutStyles(["plainAction"])}
                        onClick={() => setDecision(fact)}
                      >
                        Visa beslut
                      </SetupButton>
                    ) : null}
                    {known && !confirmed ? (
                      <SetupButton
                        variant="ghost"
                        styleX={setupLayoutStyles(["plainAction"])}
                        disabled={confirm.disabled}
                        onClick={() => setConfirming(fact)}
                      >
                        Bekräfta
                      </SetupButton>
                    ) : null}
                    <SetupButton
                      variant="ghost"
                      styleX={setupLayoutStyles(["plainAction"])}
                      disabled={book.role !== "operator"}
                      onClick={() => setEditing(kind)}
                    >
                      Ändra
                    </SetupButton>
                  </SetupBlock>,
                ],
              };
            })}
          />
        </SetupBlock>
      ) : null}
      <SetupBlock layout={["section20", "actions"]}>
        <SetupButton onClick={() => open("compatibility")}>
          Gå vidare till kompatibilitet
        </SetupButton>
        {missing.length ? (
          <SetupText layout={["warning"]}>
            {missing.length} {missing.length === 1 ? "uppgift saknas" : "uppgifter saknas"}:{" "}
            {missing.map((kind) => labels[kind].toLowerCase()).join(", ")}
          </SetupText>
        ) : null}
      </SetupBlock>
      <SetupBlock layout={["note"]}>
        <SetupCaption>
          Vi bekräftar inte något åt dig. Osäkra uppgifter stannar som osäkra.
        </SetupCaption>
      </SetupBlock>
      {confirming ? (
        <FormDialog
          size="compact"
          title={`Bekräfta ${labels[Schema.decodeUnknownSync(Schema.Literals(kinds))(confirming.revision.factKind)].toLowerCase()}`}
          closeLabel="Avbryt"
          onClose={() => setConfirming(null)}
          onEscape={() => {
            if (!confirm.isPending && !confirm.uncertain) setConfirming(null);
          }}
        >
          <SetupContent
            focused
            onSubmit={(event) => {
              event.preventDefault();
              confirm.mutate(
                confirm.uncertain && confirm.variables
                  ? confirm.variables
                  : {
                      factRevisionId: confirming.revision.id,
                      expectedDigest: confirming.revision.digest,
                      result: "confirmed",
                      rationale: "Bekräftat i företagsprofilen",
                    },
              );
            }}
            styleX={setupLayoutStyles(["focused"])}
          >
            <SetupText as="p">{factText(confirming)}</SetupText>
            <SetupButton type="submit" disabled={confirm.isPending}>
              Bekräfta
            </SetupButton>
            <AccountingStatus locale="sv" pending={confirm.isPending} error={confirm.error} write />
          </SetupContent>
        </FormDialog>
      ) : null}
      {decision?.review ? (
        <FormDialog
          size="compact"
          title="Visa beslut"
          closeLabel="Stäng"
          onClose={() => setDecision(null)}
          onEscape={() => setDecision(null)}
        >
          <SetupBlock layout={["stack12"]}>
            <SetupText>{factText(decision)}</SetupText>
            <SetupText>Bekräftad av {personName(lifecycle, decision.review.reviewer)}</SetupText>
            <SetupCaption>{formatMoment(decision.review.reviewedAt)}</SetupCaption>
            <SetupText>{decision.review.rationale}</SetupText>
          </SetupBlock>
        </FormDialog>
      ) : null}
      {editing ? (
        <FactEditor
          key={`${editing}-${facts.data?.find((item) => item.revision.factKind === editing)?.revision.id ?? "new"}`}
          kind={editing}
          saved={facts.data?.find((item) => item.revision.factKind === editing)}
          close={() => setEditing(null)}
        />
      ) : null}
    </SetupPageContent>
  );
}

function FactEditor({
  kind,
  saved,
  close,
}: {
  kind: VisibleFact;
  saved?: Fact;
  close: () => void;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const known = saved?.revision.value.state === "known" ? saved.revision.value.value : "";
  const [value, setValue] = useState(typeof known === "string" ? known : "");
  const [from, setFrom] = useState(saved?.revision.effectiveFrom ?? "");

  const [startsOn, setStartsOn] = useState(
    Predicate.hasProperty(known, "startsOn") ? known.startsOn : "",
  );

  const [endsOn, setEndsOn] = useState(Predicate.hasProperty(known, "endsOn") ? known.endsOn : "");
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());

  const save = useMutation({
    mutationFn: async (input: {
      factKind: VisibleFact;
      value: { state: "known"; value: string | { startsOn: string; endsOn: string } };
      effectiveFrom: string;
      effectiveTo: string | null;
      supersedesId: string | null;
      note: string;
    }) => {
      const path = `${bookPath(book)}/evidence`;

      const evidence = await readAccounting(
        path,
        Accounting.Evidence,
        mutationOptions(
          path,
          JSON.stringify({
            title: "Du angav",
            content: JSON.stringify(input),
            mediaType: "application/json",
            origin: "company-profile",
          }),
          keys.current,
        ),
      );

      const command = Schema.decodeUnknownSync(Profiles.RecordFactRevision)({
        ...input,
        evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
      });

      const factPath = `${bookPath(book)}/company-facts`;

      return readAccounting(
        factPath,
        Profiles.FactRevision,
        mutationOptions(factPath, JSON.stringify(command), keys.current),
      );
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: bookKey(book) });
      close();
    },
  });

  const uncertain = isUncertainWriteError(save.error);

  const options = {
    legal_form: [
      { value: "aktiebolag", label: "Aktiebolag" },
      { value: "enskild_firma", label: "Enskild firma" },
    ],
    accounting_method: [
      { value: "accrual", label: "Fakturametoden" },
      { value: "cash", label: "Kontantmetoden" },
    ],
    vat_period: [
      { value: "quarterly", label: "Kvartal" },
      { value: "monthly", label: "Månad" },
      { value: "yearly", label: "År" },
    ],
    reporting_framework: [
      { value: "K2", label: "K2" },
      { value: "K3", label: "K3" },
    ],
    fiscal_year: null,
    base_currency: null,
  }[kind];

  return (
    <FormDialog
      size="compact"
      title={`Ändra ${labels[kind].toLowerCase()}`}
      closeLabel="Avbryt"
      onClose={close}
      onEscape={() => {
        if (!save.isPending && !uncertain) close();
      }}
    >
      <SetupBlock
        as="form"
        onSubmit={(event) => {
          event.preventDefault();

          if (save.isPending || book.role !== "operator") return;

          if (uncertain && save.variables) {
            save.mutate(save.variables);

            return;
          }

          save.mutate({
            factKind: kind,
            value: { state: "known", value: kind === "fiscal_year" ? { startsOn, endsOn } : value },
            effectiveFrom: from,
            effectiveTo: saved?.revision.effectiveTo ?? null,
            supersedesId: saved?.revision.id ?? null,
            note: "Angivet i företagsprofilen",
          });
        }}
        layout={["stack12"]}
      >
        {kind === "fiscal_year" ? (
          <>
            <InputField
              compact
              label="Första dag"
              type="date"
              required
              value={startsOn}
              disabled={save.isPending || uncertain}
              onChange={(event) => setStartsOn(event.currentTarget.value)}
            />
            <InputField
              compact
              label="Sista dag"
              type="date"
              required
              value={endsOn}
              min={startsOn}
              disabled={save.isPending || uncertain}
              onChange={(event) => setEndsOn(event.currentTarget.value)}
            />
          </>
        ) : options ? (
          <SelectField
            compact
            label={labels[kind]}
            value={value}
            options={options}
            placeholder="Välj"
            disabled={save.isPending || uncertain}
            onValueChange={(next) => setValue(next ?? "")}
          />
        ) : (
          <InputField
            compact
            label={labels[kind]}
            required
            value={value}
            disabled={save.isPending || uncertain}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        )}
        <InputField
          compact
          label="Gäller från"
          type="date"
          required
          value={from}
          max={setup.today}
          disabled={save.isPending || uncertain}
          onChange={(event) => setFrom(event.currentTarget.value)}
        />
        <SetupActions>
          <SetupButton
            type="submit"
            disabled={
              save.isPending ||
              book.role !== "operator" ||
              (!uncertain && (!from || (kind === "fiscal_year" ? !startsOn || !endsOn : !value)))
            }
          >
            Spara
          </SetupButton>
          <SetupButton
            type="button"
            variant="outline"
            disabled={save.isPending || uncertain}
            onClick={close}
          >
            Avbryt
          </SetupButton>
        </SetupActions>
        <AccountingStatus locale={locale} pending={save.isPending} error={save.error} write />
      </SetupBlock>
    </FormDialog>
  );
}

export function OnboardingCompatibility({
  workspace,
  open,
}: {
  workspace: typeof Onboarding.OnboardingWorkspace.Type;
  open: OpenOnboardingView;
}) {
  const { book } = useBookWorkspace();

  const familyLabels = {
    posting_eligibility: "Bokföring",
    vat: "Moms",
    payroll: "Löner",
    statements: "Årsredovisning",
    corporate_tax: "Inkomstdeklaration",
  };

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page"])}>
      <SetupTitle>Vad OpenERP stöder för {book.name}</SetupTitle>
      <SetupBlock layout={["section"]}>
        <SetupTable
          title="Kompatibilitet"
          width={tokens.setupWorkspaceWidth}
          columns={[
            { id: "family", label: "Del", width: tokens.setupColumn260 },
            { id: "state", label: "Status", width: tokens.setupColumn210 },
            { id: "detail", label: "Det här gäller", width: tokens.setupColumn514 },
          ]}
          rows={workspace.qualification.map((item) => ({
            id: item.family,
            tone: (
              {
                needs_information: "warning",
                not_supported: "blocked",
                supported: undefined,
                supported_with_handoff: undefined,
              } as const
            )[item.state],
            cells: [
              familyLabels[item.family],
              <SetupText
                key="status"
                layout={[
                  (
                    {
                      supported: "success",
                      supported_with_handoff: "primary",
                      not_supported: "blocked",
                      needs_information: "warning",
                    } as const
                  )[item.state],
                  "medium",
                ]}
              >
                {
                  {
                    supported: "✓ Stöds",
                    supported_with_handoff: "→ Stöds med överlämning",
                    not_supported: "× Stöds inte",
                    needs_information: "! Behöver uppgift",
                  }[item.state]
                }
              </SetupText>,
              <SetupText key="detail" layout={["secondary"]}>
                {item.reason}
              </SetupText>,
            ],
          }))}
        />
      </SetupBlock>
      <SetupBlock layout={["section20"]}>
        <SetupButton onClick={() => open("workspace")}>Öppna Setup</SetupButton>
      </SetupBlock>
      <SetupLink onClick={() => open("profile")}>Företagsprofil</SetupLink>
    </SetupPageContent>
  );
}

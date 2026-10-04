import { SelectControl } from "@open-erp/ui/components/select";
import {
  SetupBlock,
  SetupRadio,
  SetupText,
  setupLayoutStyles,
} from "@open-erp/ui/components/setup-parts";
import { useState } from "react";
import * as Onboarding from "@open-erp/contracts/onboarding";
import {
  SetupButton,
  SetupCaption,
  SetupContent,
  SetupTitle,
} from "@open-erp/ui/components/setup-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookPath } from "@/lib/accounting-api";
import { useOnboardingCommand } from "./data";
import { personName, type Lifecycle } from "./lifecycle";
import { Breadcrumb, type OpenOnboardingView } from "./shared";

const roles = [
  { key: "preparerId", label: "Vem förbereder bokföringsförslag?", effect: "förbereder bokföring" },
  {
    key: "bookkeepingApproverId",
    label: "Vem godkänner bokföringsförslag?",
    effect: "granskar och godkänner bokföring",
  },
  {
    key: "paymentApproverId",
    label: "Vem godkänner utgående betalningar?",
    effect: "godkänner utgående betalningar",
  },
  {
    key: "vatResponsibleId",
    label: "Vem hanterar momsdeklarationen?",
    effect: "hanterar momsdeklarationen",
  },
] as const;

type Category = "self" | "company" | "bureau";

function responsibilityCategory(
  people: Lifecycle["people"],
  personId: string,
  viewerId: string | null,
): Category {
  if (personId && personId === viewerId) return "self";

  return people.find((person) => person.id === personId)?.affiliation ?? "company";
}

function RoleAssignment(props: {
  role: (typeof roles)[number];
  people: Lifecycle["people"];
  personId: string;
  viewerId: string | null;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [category, setCategory] = useState<Category>(
    responsibilityCategory(props.people, props.personId, props.viewerId),
  );

  const choices = props.people.filter((person) =>
    category === "self"
      ? person.id === props.viewerId
      : person.affiliation === category && (category === "bureau" || person.id !== props.viewerId),
  );

  const selected = choices.some((person) => person.id === props.personId) ? props.personId : "";

  return (
    <SetupBlock as="fieldset" disabled={props.disabled} layout={["stack8"]}>
      <SetupText as="legend" layout={["semibold"]}>
        {props.role.label}
      </SetupText>
      <SetupBlock layout={["radioOptions"]}>
        {(
          [
            { value: "self", label: "Jag" },
            { value: "company", label: "Någon på företaget" },
            { value: "bureau", label: "Min redovisningsbyrå" },
          ] as const
        ).map((choice) => (
          <SetupBlock as="label" key={choice.value} layout={["radioOption"]}>
            <SetupRadio
              type="radio"
              name={`${props.role.key}-category`}
              value={choice.value}
              checked={category === choice.value}
              onChange={() => {
                setCategory(choice.value);
                props.onChange(choice.value === "self" ? (props.viewerId ?? "") : "");
              }}
            />
            {choice.label}
          </SetupBlock>
        ))}
      </SetupBlock>
      <SelectControl
        aria-label={`Person som ${props.role.effect}`}
        value={selected}
        options={choices.map((person) => ({
          value: person.id,
          label: `${category === "bureau" ? "Person på byrån" : "Person på företaget"}: ${person.name}`,
        }))}
        onValueChange={(value) => props.onChange(value ?? "")}
        disabled={props.disabled || category === "self"}
        placeholder="Välj person"
        styleX={setupLayoutStyles(["personSelect"])}
      />
    </SetupBlock>
  );
}

export function OnboardingResponsibilities({
  lifecycle,
  open,
  viewerId,
}: {
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
  viewerId: string | null;
}) {
  const { book, locale } = useBookWorkspace();

  const [assignments, setAssignments] = useState<typeof Onboarding.ResponsibilityAssignments.Type>(
    lifecycle.responsibilities?.assignments ?? {
      preparerId: "",
      bookkeepingApproverId: "",
      paymentApproverId: "",
      vatResponsibleId: "",
      activationConfirmerIds: [],
    },
  );

  const save = useOnboardingCommand(
    `${bookPath(book)}/onboarding/responsibilities`,
    Onboarding.SaveOnboardingResponsibilities,
    Onboarding.OnboardingResponsibilities,
  );

  const enabledPeople = lifecycle.people.filter(
    (person) => person.enabled && person.role === "operator",
  );

  const ready = roles.every((role) =>
    enabledPeople.some((person) => person.id === assignments[role.key]),
  );

  const effects = new Map<string, string[]>();

  for (const role of roles) {
    const id = assignments[role.key];

    if (!id) continue;
    effects.set(id, [...(effects.get(id) ?? []), role.effect]);
  }

  return (
    <SetupContent
      styleX={setupLayoutStyles(["page", "focused", "focusedEarly"])}
      onSubmit={(event) => {
        event.preventDefault();

        if (save.disabled || !ready) return;
        save.mutate(
          save.uncertain && save.variables
            ? save.variables
            : {
                expectedRevision: lifecycle.responsibilities?.revision ?? 0,
                assignments: {
                  ...assignments,
                  activationConfirmerIds: lifecycle.responsibilities?.assignments
                    .activationConfirmerIds ?? [
                    ...new Set([assignments.bookkeepingApproverId, assignments.paymentApproverId]),
                  ],
                },
              },
        );
      }}
    >
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Ansvar" }]}
        open={open}
      />
      <SetupBlock layout={["earlyTitle"]}>
        <SetupTitle>Vem gör vad?</SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["subtitle"]}>
        Välj ansvarskategori och namnge personen som utför uppgiften.
      </SetupText>
      <SetupBlock layout={["responsibilityGroups"]}>
        {roles.map((role) => (
          <RoleAssignment
            key={role.key}
            role={role}
            people={enabledPeople}
            viewerId={viewerId}
            personId={assignments[role.key]}
            disabled={save.disabled || save.uncertain}
            onChange={(id) => setAssignments((previous) => ({ ...previous, [role.key]: id }))}
          />
        ))}
      </SetupBlock>
      <SetupBlock as="section" layout={["rule", "section24"]}>
        <SetupText as="h2" layout={["semibold", "note"]}>
          Så blir det
        </SetupText>
        {[...effects].map(([id, effect]) => (
          <SetupBlock key={id} layout={["row"]}>
            <SetupText layout={["name"]}>{personName(lifecycle, id)}</SetupText>
            <SetupText layout={["secondary"]}>{effect.join(", ")}</SetupText>
          </SetupBlock>
        ))}
        <SetupBlock layout={["row"]}>
          <SetupText layout={["name"]}>OpenERP</SetupText>
          <SetupText layout={["secondary"]}>läser underlag och förbereder förslag</SetupText>
        </SetupBlock>
      </SetupBlock>
      <SetupBlock layout={["section20"]}>
        <SetupButton type="submit" disabled={save.disabled || !ready}>
          Spara ansvar
        </SetupButton>
      </SetupBlock>
      <SetupBlock layout={["note"]}>
        <SetupCaption>
          Inget bokförs eller skickas utan rätt godkännande. Detaljerade behörigheter sätts i
          inställningarna.
        </SetupCaption>
      </SetupBlock>
      <AccountingStatus locale={locale} pending={save.isPending} error={save.error} write />
      {!enabledPeople.length ? (
        <SetupText as="p" role="status">
          Det saknas personer som kan ta ansvar.
        </SetupText>
      ) : null}
    </SetupContent>
  );
}

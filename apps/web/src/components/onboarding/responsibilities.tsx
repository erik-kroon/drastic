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
  { key: "preparerId", label: "Vem bokför?", effect: "förbereder bokföring" },
  {
    key: "bookkeepingApproverId",
    label: "Vem godkänner bokföringsförslag?",
    effect: "granskar bokföring",
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
                    ...new Set([assignments.preparerId, assignments.paymentApproverId]),
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
        Förifyllt från det du angett. Ändra det som inte stämmer.
      </SetupText>
      <SetupBlock layout={["responsibilityGroups"]}>
        {roles.map((role) => (
          <SetupBlock
            as="fieldset"
            key={role.key}
            disabled={save.disabled || save.uncertain}
            layout={["stack8"]}
          >
            <legend>{role.label}</legend>
            <SetupBlock layout={["radioOptions"]}>
              {enabledPeople.map((person) => (
                <SetupBlock as="label" key={person.id} layout={["radioOption"]}>
                  <SetupRadio
                    type="radio"
                    name={role.key}
                    value={person.id}
                    checked={assignments[role.key] === person.id}
                    onChange={() =>
                      setAssignments((previous) => ({ ...previous, [role.key]: person.id }))
                    }
                    layout={["radio"]}
                  />
                  {person.id === viewerId ? "Jag" : person.name}
                </SetupBlock>
              ))}
            </SetupBlock>
          </SetupBlock>
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

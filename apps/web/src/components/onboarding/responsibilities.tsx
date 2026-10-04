import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
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
import { styles } from "./styles";

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
      styleX={[styles.page, styles.focused, styles.focusedEarly]}
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
      <div {...stylex.props(styles.earlyTitle)}>
        <SetupTitle>Vem gör vad?</SetupTitle>
      </div>
      <p {...stylex.props(styles.subtitle)}>
        Förifyllt från det du angett. Ändra det som inte stämmer.
      </p>
      <div {...stylex.props(styles.responsibilityGroups)}>
        {roles.map((role) => (
          <fieldset
            key={role.key}
            disabled={save.disabled || save.uncertain}
            {...stylex.props(styles.stack8)}
          >
            <legend>{role.label}</legend>
            <div {...stylex.props(styles.radioOptions)}>
              {enabledPeople.map((person) => (
                <label key={person.id} {...stylex.props(styles.radioOption)}>
                  <input
                    type="radio"
                    name={role.key}
                    value={person.id}
                    checked={assignments[role.key] === person.id}
                    onChange={() =>
                      setAssignments((previous) => ({ ...previous, [role.key]: person.id }))
                    }
                    {...stylex.props(styles.radio)}
                  />
                  {person.id === viewerId ? "Jag" : person.name}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <section {...stylex.props(styles.rule, styles.section24)}>
        <h2 {...stylex.props(styles.semibold, styles.note)}>Så blir det</h2>
        {[...effects].map(([id, effect]) => (
          <div key={id} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.name)}>{personName(lifecycle, id)}</span>
            <span {...stylex.props(styles.secondary)}>{effect.join(", ")}</span>
          </div>
        ))}
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.name)}>OpenERP</span>
          <span {...stylex.props(styles.secondary)}>läser underlag och förbereder förslag</span>
        </div>
      </section>
      <div {...stylex.props(styles.section20)}>
        <SetupButton type="submit" disabled={save.disabled || !ready}>
          Spara ansvar
        </SetupButton>
      </div>
      <div {...stylex.props(styles.note)}>
        <SetupCaption>
          Inget bokförs eller skickas utan rätt godkännande. Detaljerade behörigheter sätts i
          inställningarna.
        </SetupCaption>
      </div>
      <AccountingStatus locale={locale} pending={save.isPending} error={save.error} write />
      {!enabledPeople.length ? <p role="status">Det saknas personer som kan ta ansvar.</p> : null}
    </SetupContent>
  );
}

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { AccountingError } from "@open-erp/contracts/accounting";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import {
  SetupActions,
  SetupButton,
  SetupCaption,
  SetupContent,
  SetupTitle,
} from "@open-erp/ui/components/setup-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";

type OnboardingCase = typeof Onboarding.OnboardingCase.Type;

export function OnboardingStart({
  saved,
  onContinue,
  onCancel,
  onReload,
}: {
  saved: OnboardingCase | null;
  onContinue: () => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const title = sv ? "Hur vill du börja?" : "How would you like to start?";

  const [selected, setSelected] = useState<typeof Onboarding.OnboardingPath.Type>(
    saved?.path ?? "existing_company",
  );

  const keys = useRef(new Map<string, string>());
  const cache = useQueryClient();
  const path = `${bookPath(book)}/onboarding`;

  const mutation = useMutation({
    mutationFn: (input: typeof Onboarding.StartOnboarding.Type) =>
      readAccounting(
        path,
        Onboarding.OnboardingCase,
        mutationOptions(path, JSON.stringify(input), keys.current),
      ),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: [...bookKey(book), "onboarding"] });
      onContinue();
    },
  });

  const uncertain = isUncertainWriteError(mutation.error);
  const disabled = book.role !== "operator" || mutation.isPending;

  return (
    <SetupContent
      focused
      onSubmit={(event) => {
        event.preventDefault();

        if (disabled) return;

        if (saved) {
          onContinue();

          return;
        }

        mutation.mutate(uncertain && mutation.variables ? mutation.variables : { path: selected });
      }}
    >
      <SetupTitle>{title}</SetupTitle>
      <ChoiceField
        label={title}
        hideLabel
        presentation="decision-cards"
        name="onboarding-path"
        value={saved?.path ?? selected}
        disabled={disabled || uncertain || saved !== null}
        onValueChange={(value) =>
          setSelected(Schema.decodeUnknownSync(Onboarding.OnboardingPath)(value))
        }
        options={[
          {
            value: "new_company",
            label: sv
              ? "Nytt företag, ingen tidigare bokföring"
              : "New company, no previous bookkeeping",
            description: sv ? "Du börjar med noll saldon." : "You start with zero balances.",
          },
          {
            value: "existing_company",
            label: sv ? "Flytta från ett annat system" : "Move from another system",
            description: sv
              ? "Importerar historik och bevisar siffrorna innan du går live."
              : "Import history and verify the figures before going live.",
          },
          {
            value: "bureau_managed",
            label: sv ? "Byrå sätter upp åt klient" : "An accounting firm sets up for a client",
            description: sv
              ? "Byrån startar, ägaren bjuds in för det som kräver hen."
              : "The firm starts and invites the owner for decisions that need them.",
          },
          {
            value: "demo",
            label: sv ? "Utforska med exempeldata" : "Explore with example data",
            description: sv ? "Inget riktigt, inget skickas." : "No real records, nothing is sent.",
          },
        ]}
      />
      <SetupActions>
        <SetupButton type="submit" disabled={disabled}>
          {uncertain ? (sv ? "Försök igen" : "Try again") : sv ? "Fortsätt" : "Continue"}
        </SetupButton>
        <SetupButton
          type="button"
          variant="outline"
          disabled={mutation.isPending || uncertain}
          onClick={onCancel}
        >
          {sv ? "Avbryt" : "Cancel"}
        </SetupButton>
      </SetupActions>
      <SetupCaption>
        {sv
          ? "Du kan lämna och komma tillbaka. Inget blir bindande förrän du går live."
          : "You can leave and return. Nothing becomes binding until you go live."}
      </SetupCaption>
      <AccountingStatus locale={locale} pending={mutation.isPending} error={mutation.error} write />
      {mutation.error instanceof AccountingError && mutation.error.code === "StaleDependency" ? (
        <SetupButton type="button" variant="outline" onClick={onReload}>
          {sv ? "Läs in sparade uppgifter" : "Reload saved details"}
        </SetupButton>
      ) : null}
    </SetupContent>
  );
}

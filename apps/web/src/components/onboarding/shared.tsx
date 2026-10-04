import {
  SetupBlock,
  SetupInlineAction,
  SetupText,
  setupLayoutStyles,
} from "@open-erp/ui/components/setup-parts";
import type { ReactNode } from "react";
import { SetupButton } from "@open-erp/ui/components/setup-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import type { OnboardingView } from "./views";

export type OpenOnboardingView = (view: OnboardingView) => void;

export function Breadcrumb({
  items,
  open,
}: {
  items: readonly { label: string; view?: OnboardingView }[];
  open: OpenOnboardingView;
}) {
  return (
    <SetupBlock as="nav" aria-label="Sökväg" layout={["crumb"]}>
      {items.map((item, index) => (
        <SetupText key={`${index}-${item.label}`} layout={["actions"]}>
          {index > 0 ? <SetupText aria-hidden="true">/</SetupText> : null}
          {item.view ? (
            <SetupInlineAction
              type="button"
              onClick={() => {
                if (item.view) open(item.view);
              }}
              layout={["crumbButton"]}
            >
              {item.label}
            </SetupInlineAction>
          ) : (
            <SetupText aria-current="page">{item.label}</SetupText>
          )}
        </SetupText>
      ))}
    </SetupBlock>
  );
}

export function CommandStatus({
  command,
}: {
  command: {
    isPending: boolean;
    error: Error | null;
    uncertain: boolean;
    variables?: unknown;
    reset: () => void;
    mutate: (input: never) => void;
  };
}) {
  const { locale } = useBookWorkspace();

  return (
    <AccountingStatus locale={locale} pending={command.isPending} error={command.error} write />
  );
}

export function PendingRead({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => void;
}) {
  const { locale } = useBookWorkspace();

  return (
    <>
      <AccountingStatus locale={locale} pending={pending} error={error} />
      {error ? (
        <SetupButton variant="outline" onClick={retry}>
          Försök igen
        </SetupButton>
      ) : null}
    </>
  );
}

export function SetupLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <SetupButton
      type="button"
      variant="ghost"
      styleX={setupLayoutStyles(["plainAction"])}
      onClick={onClick}
    >
      {children}
    </SetupButton>
  );
}

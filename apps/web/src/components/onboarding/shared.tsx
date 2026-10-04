import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { SetupButton } from "@open-erp/ui/components/setup-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { styles } from "./styles";
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
    <nav aria-label="Sökväg" {...stylex.props(styles.crumb)}>
      {items.map((item, index) => (
        <span key={`${index}-${item.label}`} {...stylex.props(styles.actions)}>
          {index > 0 ? <span aria-hidden="true">/</span> : null}
          {item.view ? (
            <button
              type="button"
              onClick={() => open(item.view)}
              {...stylex.props(styles.crumbButton)}
            >
              {item.label}
            </button>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
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
    <SetupButton type="button" variant="ghost" styleX={styles.plainAction} onClick={onClick}>
      {children}
    </SetupButton>
  );
}

import { createContext, use, type ReactNode } from "react";

/** The few fixed words the Kanon components render themselves. Everything else comes from props. */
export type KanonCopy = {
  account: string;
  debit: string;
  credit: string;
  total: string;
  missing: string;
  matches: string;
  differs: string;
  close: string;
  open: string;
};

export const kanonCopy = {
  sv: {
    account: "Konto",
    debit: "Debet",
    credit: "Kredit",
    total: "Summa",
    missing: "Saknas",
    matches: "Stämmer",
    differs: "Stämmer inte",
    close: "Stäng",
    open: "Öppna",
  },
  en: {
    account: "Account",
    debit: "Debit",
    credit: "Credit",
    total: "Total",
    missing: "Missing",
    matches: "Matches",
    differs: "Differs",
    close: "Close",
    open: "Open",
  },
} as const satisfies Record<"sv" | "en", KanonCopy>;

const CopyContext = createContext<KanonCopy>(kanonCopy.sv);

export function KanonCopyProvider({
  locale,
  children,
}: {
  locale: "sv" | "en";
  children: ReactNode;
}) {
  return <CopyContext value={kanonCopy[locale]}>{children}</CopyContext>;
}

export function useKanonCopy(): KanonCopy {
  return use(CopyContext);
}

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
  showTable: string;
  showChart: string;
  thousands: string;
  previousYear: string;
  month: string;
  date: string;
  step: string;
  amount: string;
  through: string;
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
    showTable: "Visa som tabell",
    showChart: "Visa som diagram",
    thousands: "tkr",
    previousYear: "Föregående år",
    month: "Månad",
    date: "Datum",
    step: "Post",
    amount: "Belopp",
    through: "till",
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
    showTable: "Show as table",
    showChart: "Show as chart",
    thousands: "k",
    previousYear: "Previous year",
    month: "Month",
    date: "Date",
    step: "Item",
    amount: "Amount",
    through: "to",
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

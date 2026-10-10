import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  icon: { flexShrink: 0, display: "inline-block", color: tokens.captionForeground },
});

// Paths are the 16 px sidebar icons from the Paper component board, 1.4 stroke.
const paths = {
  todo: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="M5 8l2 2 4-4" />
    </>
  ),
  overview: <path d="M3 13V8M8 13V3M13 13V6" />,
  bank: <path d="M2 6l6-3 6 3M3 7v5M6.5 7v5M9.5 7v5M13 7v5M2 13h12" />,
  sales: <path d="M4 2h6l3 3v9H4zM10 2v3h3" />,
  purchases: <path d="M3 5h10l-1 9H4zM6 5a2 2 0 014 0" />,
  documents: <path d="M2 4h4l1.5 1.5H14V13H2z" />,
  bookkeeping: <path d="M3 3h8a2 2 0 012 2v8H5a2 2 0 01-2-2zM3 11a2 2 0 012-2h8" />,
  tax: (
    <>
      <path d="M4 12L12 4" />
      <circle cx="5" cy="5" r="1.5" />
      <circle cx="11" cy="11" r="1.5" />
    </>
  ),
  payroll: (
    <>
      <circle cx="8" cy="4" r="2.5" />
      <path d="M3 14v-3a5 5 0 0110 0v3" />
    </>
  ),
  reports: <path d="M4 2h8v12H4zM6 6h4M6 9h4" />,
  closing: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5 2v2M11 2v2" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" />
    </>
  ),
};

export type NavIconName = keyof typeof paths;

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(styles.icon)}
    >
      {paths[name]}
    </svg>
  );
}

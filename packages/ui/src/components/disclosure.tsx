import { useState, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Plus, Minus } from "lucide-react";

const styles = stylex.create({
  root: {
    minWidth: 0,
    borderTopColor: tokens.border,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    paddingTop: tokens.space1,
  },
  inline: { borderTopWidth: 0, paddingTop: 0 },
  toolbar: { borderTopWidth: 0, paddingTop: 0, maxWidth: "100%" },
  toolbarExpanded: { flexBasis: "100%" },
  card: {
    backgroundColor: tokens.card,
    borderRadius: tokens.radiusSurface,
    boxShadow: tokens.shadowRaised,
    borderTopWidth: 0,
    padding: tokens.space4,
  },
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
    minHeight: 40,
    listStyle: "none",
    cursor: "pointer",
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    paddingBlock: tokens.space2,
    borderRadius: tokens.radiusMd,
    ":hover": { color: tokens.mutedForeground },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  icon: { flexShrink: 0, color: tokens.mutedForeground },
});

export function Disclosure({
  label,
  open,
  variant = "section",
  children,
  onOpenChange,
}: {
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "section" | "inline" | "card" | "toolbar";
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(open ?? false);

  return (
    <details
      {...stylex.props(
        styles.root,
        variant === "inline" && styles.inline,
        variant === "card" && styles.card,
        variant === "toolbar" && styles.toolbar,
        variant === "toolbar" && (onOpenChange ? open : expanded) && styles.toolbarExpanded,
      )}
      open={onOpenChange ? open : expanded}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary {...stylex.props(styles.trigger)}>
        {label}
        {(onOpenChange ? open : expanded) ? (
          <Minus size={14} strokeWidth={1.5} aria-hidden="true" {...stylex.props(styles.icon)} />
        ) : (
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" {...stylex.props(styles.icon)} />
        )}
      </summary>
      {children}
    </details>
  );
}

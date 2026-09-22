import { useState, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
const styles = stylex.create({
  root: {
    minWidth: 0,
    borderTopColor: tokens.border,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    paddingTop: tokens.space4,
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
    cursor: "pointer",
    fontWeight: tokens.fontWeightMedium,
    paddingBlock: tokens.space3,
    borderRadius: tokens.radiusMd,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
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
      <summary {...stylex.props(styles.trigger)}>{label}</summary>
      {children}
    </details>
  );
}

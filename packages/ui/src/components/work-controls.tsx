import type { ComponentProps, ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { Button } from "@open-erp/ui/components/button";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  filter: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.space1,
    minHeight: tokens.controlHeightXs,
    paddingInline: tokens.space2,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.input,
    borderRadius: tokens.radiusOverlay,
    backgroundColor: tokens.card,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  positioner: { zIndex: 50 },
  popup: {
    display: "grid",
    gap: tokens.space3,
    backgroundColor: tokens.card,
    color: tokens.foreground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSurface,
    padding: tokens.space4,
    boxShadow: tokens.shadowFloating,
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space1,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  sort: {
    appearance: "none",
    borderWidth: 0,
    backgroundColor: tokens.transparent,
    color: "inherit",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  headerAction: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: tokens.controlHeightSm,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    textDecoration: "none",
    borderRadius: tokens.radiusControl,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  reviewAction: {
    width: "100%",
    height: tokens.controlHeight,
    ":disabled": { backgroundColor: tokens.border, color: tokens.captionForeground, opacity: 1 },
  },
  source: { marginBlockStart: tokens.space3_5 },
  reviewFooter: { marginBlockStart: "auto", paddingBlockStart: tokens.space4 },
  focusedFooter: { fontSize: tokens.fontSizeControl, lineHeight: tokens.lineHeight18Px },
  previewActions: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space2_5,
    marginBlockStart: "auto",
    paddingBlockStart: tokens.space4,
  },
  previewPrimary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: tokens.controlHeight,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    borderRadius: tokens.radiusControl,
    fontSize: tokens.fontSizeControl,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeight16Px,
    textDecoration: "none",
    ":hover": { backgroundColor: tokens.primaryHoverBackground },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  previewSecondaryText: { minHeight: tokens.lineHeight16Px },
  previewSecondary: {
    alignSelf: "flex-end",
    display: "flex",
    alignItems: "center",
    minHeight: tokens.controlHeightSm,
    color: tokens.primary,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    textDecoration: "none",
    ":hover": { textDecoration: "underline" },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
});

export function WorkFilter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger {...stylex.props(styles.filter)}>{label}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={8} {...stylex.props(styles.positioner)}>
          <Popover.Popup {...stylex.props(styles.popup)}>{children}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function WorkSort({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label {...stylex.props(styles.label)}>
      {label}
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...stylex.props(styles.sort)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function WorkHeaderAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} {...stylex.props(styles.headerAction)}>
      {children}
    </Link>
  );
}

export function WorkReviewAction(props: Omit<ComponentProps<typeof Button>, "styleX" | "size">) {
  return <Button {...props} styleX={styles.reviewAction} />;
}

export function WorkSource({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.source)}>{children}</div>;
}

export function WorkReviewFooter({
  children,
  presentation,
}: {
  children: ReactNode;
  presentation?: "focused";
}) {
  return (
    <div {...stylex.props(styles.reviewFooter, presentation === "focused" && styles.focusedFooter)}>
      {children}
    </div>
  );
}

export function WorkPreviewActions({
  href,
  label,
  secondaryHref,
  secondaryLabel,
  secondarySize = "control",
}: {
  href: string;
  label: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  secondarySize?: "control" | "text";
}) {
  return (
    <div {...stylex.props(styles.previewActions)}>
      <Link href={href} {...stylex.props(styles.previewPrimary)}>
        {label}
      </Link>
      {secondaryHref && secondaryLabel ? (
        <Link
          href={secondaryHref}
          {...stylex.props(
            styles.previewSecondary,
            secondarySize === "text" && styles.previewSecondaryText,
          )}
        >
          {secondaryLabel}
        </Link>
      ) : null}
    </div>
  );
}

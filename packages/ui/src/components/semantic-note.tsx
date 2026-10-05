import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  note: {
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: tokens.radiusControl,
    paddingBlock: tokens.space2,
    paddingInline: tokens.space3,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  info: {
    backgroundColor: tokens.registerSelected,
    borderColor: tokens.informationBorder,
    color: tokens.primary,
  },
  warning: {
    backgroundColor: tokens.warning,
    borderColor: tokens.warningBorder,
    color: tokens.warningForeground,
  },
  error: {
    backgroundColor: tokens.destructiveBackground,
    borderColor: tokens.errorBorder,
    color: tokens.destructive,
  },
  success: {
    backgroundColor: tokens.success,
    borderColor: tokens.successBorder,
    color: tokens.successForeground,
  },
  status: { fontSize: tokens.fontSizeControl, lineHeight: tokens.lineHeight16Px },
  neutral: { color: tokens.mutedForeground },
  infoText: { color: tokens.primary },
  warningText: { color: tokens.warningForeground },
  errorText: { color: tokens.destructive },
  successText: { color: tokens.successForeground },
});

type NoteTone = "info" | "warning" | "error" | "success";

const tones = {
  info: styles.info,
  warning: styles.warning,
  error: styles.error,
  success: styles.success,
};

export function SemanticNote({
  tone,
  children,
  ...props
}: Omit<ComponentProps<"div">, "className" | "style"> & { tone: NoteTone; children: ReactNode }) {
  return (
    <div {...props} {...stylex.props(styles.note, tones[tone])}>
      {children}
    </div>
  );
}

type WorkflowStatus = "draft" | "review" | "action" | "blocked" | "completed" | "unknown";

const statuses = {
  draft: { symbol: "○", style: styles.neutral },
  review: { symbol: "◐", style: styles.infoText },
  action: { symbol: "!", style: styles.warningText },
  blocked: { symbol: "✕", style: styles.errorText },
  completed: { symbol: "✓", style: styles.successText },
  unknown: { symbol: "?", style: styles.warningText },
};

export function WorkflowStatusLabel({
  status,
  children,
}: {
  status: WorkflowStatus;
  children: ReactNode;
}) {
  const presentation = statuses[status];

  return (
    <span {...stylex.props(styles.status, presentation.style)}>
      <span aria-hidden="true">{presentation.symbol} </span>
      {children}
    </span>
  );
}

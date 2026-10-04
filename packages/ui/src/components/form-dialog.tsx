// Accounted NewJournalEntryDialog layout, adapted to the owned Base UI primitives.
// Copyright (C) 2025-2026 Jakob Wennberg. See licenses/accounted-LICENSE.
import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  backdrop: { position: "fixed", inset: 0, backgroundColor: tokens.menuBackdrop, zIndex: 40 },
  popup: {
    position: "fixed",
    insetBlockStart: "50%",
    insetInlineStart: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: tokens.card,
    color: tokens.foreground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusOverlay,
    boxShadow: tokens.shadowOverlay,
    width: "min(1152px, calc(100vw - 48px))",
    maxHeight: "92dvh",
    overflowY: "auto",
    zIndex: 45,
    containerType: "inline-size",
    padding: 24,
    "@media (max-width: 767px)": { width: "calc(100vw - 20px)", maxHeight: "95dvh", padding: 16 },
  },
  compact: { width: "min(560px, calc(100vw - 48px))" },
  setup: {
    width: tokens.setupDialogWidth,
    insetBlockStart: tokens.setupDialogTop,
    transform: "translateX(-50%)",
    borderColor: tokens.input,
    borderRadius: tokens.radiusSurface,
    boxShadow: tokens.shadowNone,
  },
  setupHeader: { marginBlockEnd: 0 },
  register: {
    width: "min(520px, calc(100vw - 48px))",
    insetBlockStart: 90,
    insetInlineStart: "calc(50% + 112px)",
    transform: "translateX(-50%)",
    borderRadius: tokens.radiusSurface,
    maxHeight: "calc(100dvh - 114px)",
    "@media (max-width: 767px)": {
      width: "calc(100vw - 20px)",
      insetInlineStart: "50%",
      insetBlockStart: 16,
      maxHeight: "calc(100dvh - 32px)",
    },
  },
  registerHeader: { marginBlockEnd: tokens.space4 },
  registerTitle: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
  },
  fullscreen: {
    insetBlockStart: 0,
    insetInlineStart: 0,
    transform: "none",
    width: "100vw",
    height: "100dvh",
    maxHeight: "100dvh",
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    boxShadow: "none",
    "@media (max-width: 767px)": { width: "100vw", maxHeight: "100dvh", padding: 0 },
  },
  fullscreenHeader: {
    minHeight: 48,
    paddingInline: tokens.space4,
    marginBlockEnd: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    position: "sticky",
    insetBlockStart: 0,
    backgroundColor: tokens.card,
    zIndex: 1,
  },
  fullscreenTitle: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight18Px,
  },
  invoice: {
    width: "min(42rem, calc(100vw - 48px))",
    "@media (max-width: 767px)": { width: "calc(100vw - 20px)" },
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBlockEnd: 24,
  },
  title: { fontSize: tokens.fontSizeLg, fontWeight: tokens.fontWeightMedium },
  close: {
    display: "grid",
    placeItems: "center",
    minWidth: 40,
    minHeight: 40,
    borderRadius: tokens.radiusMd,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.muted },
    color: tokens.foreground,
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
    "@media (pointer: coarse)": { minWidth: 44, minHeight: 44 },
  },
});

export function FormDialog({
  title,
  closeLabel,
  onClose,
  onEscape,
  finalFocus,
  children,
  size = "wide",
}: {
  size?: "compact" | "register" | "invoice" | "wide" | "fullscreen" | "setup";
  title: string;
  closeLabel: string;
  onClose: () => void;
  onEscape?: () => void;
  finalFocus?: Dialog.Popup.Props["finalFocus"];
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open
      disablePointerDismissal
      onOpenChange={(open, event) => {
        if (event.reason === "escape-key") {
          event.cancel();
          onEscape?.();

          return;
        }

        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup
          finalFocus={finalFocus}
          {...stylex.props(
            styles.popup,
            size === "compact" && styles.compact,
            size === "setup" && styles.setup,
            size === "register" && styles.register,
            size === "invoice" && styles.invoice,
            size === "fullscreen" && styles.fullscreen,
          )}
        >
          <div
            {...stylex.props(
              styles.header,
              size === "fullscreen" && styles.fullscreenHeader,
              size === "register" && styles.registerHeader,
              size === "setup" && styles.setupHeader,
            )}
          >
            <Dialog.Title
              {...stylex.props(
                styles.title,
                size === "fullscreen" && styles.fullscreenTitle,
                size === "register" && styles.registerTitle,
                size === "setup" && styles.registerTitle,
              )}
            >
              {title}
            </Dialog.Title>
            {size !== "setup" ? (
              <Dialog.Close aria-label={closeLabel} {...stylex.props(styles.close)}>
                <X size={18} aria-hidden="true" />
              </Dialog.Close>
            ) : null}
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

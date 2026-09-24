import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  backdrop: { position: "fixed", inset: 0, backgroundColor: tokens.menuBackdrop, zIndex: 30 },
  sheet: {
    position: "fixed",
    insetBlock: 12,
    insetInlineEnd: 12,
    zIndex: 35,
    width: "min(960px, calc(100vw - 48px))",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.card,
    color: tokens.foreground,
    borderRadius: tokens.radiusOverlay,
    boxShadow: tokens.shadowOverlay,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    overflow: "hidden",
    containerType: "inline-size",
  },
  invoiceSheet: {
    width: "min(36rem, calc(100vw - 1.5rem))",
    insetBlock: 0,
    insetInlineEnd: 0,
    borderRadius: 0,
    "--card": "oklch(from var(--background) l 0 h)",
    "--invoice-paper": "color-mix(in srgb, var(--card), var(--foreground) 4%)",
    "--muted": "color-mix(in srgb, var(--card), var(--foreground) 10%)",
    "--secondary": "color-mix(in srgb, var(--card), var(--foreground) 10%)",
    "--border": "color-mix(in srgb, var(--foreground) 12%, transparent)",
    "--primary": "var(--foreground)",
    "--primary-foreground": "var(--background)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingInline: 28,
    paddingBlock: 14,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  title: { fontSize: tokens.fontSizeSm, fontWeight: tokens.fontWeightMedium },
  close: {
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    borderWidth: 0,
    cursor: "pointer",
    color: tokens.mutedForeground,
    backgroundColor: { default: "transparent", ":hover": tokens.muted },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
    "@media (pointer: coarse)": { width: 44, height: 44 },
  },
  content: { padding: 28, overflowY: "auto", minHeight: 0, flex: "1" },
  invoiceContent: { padding: 20, "@container (max-width: 28rem)": { padding: 16 } },
});

/** Read-only record inspection keeps the parent register mounted with its query and position. */
export function RecordSheet({
  title,
  closeLabel,
  onClose,
  children,
  dismissible = true,
  invoice = false,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
  invoice?: boolean;
}) {
  return (
    <Dialog.Root
      open
      disablePointerDismissal={!dismissible}
      onOpenChange={(open, event) => {
        if (!dismissible && event.reason === "escape-key") {
          event.cancel();
          return;
        }
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.sheet, invoice && styles.invoiceSheet)}>
          <div {...stylex.props(styles.header)}>
            <Dialog.Title {...stylex.props(styles.title)}>{title}</Dialog.Title>
            <Dialog.Close aria-label={closeLabel} {...stylex.props(styles.close)}>
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div {...stylex.props(styles.content, invoice && styles.invoiceContent)}>{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    borderWidth: 0,
    cursor: "pointer",
    color: tokens.mutedForeground,
    backgroundColor: { default: "transparent", ":hover": tokens.muted },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  content: { padding: 28, overflowY: "auto", minHeight: 0, flex: "1" },
});

/** Read-only record inspection keeps the parent register mounted with its query and position. */
export function RecordSheet({
  title,
  closeLabel,
  onClose,
  children,
  dismissible = true,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
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
        <Dialog.Popup {...stylex.props(styles.sheet)}>
          <div {...stylex.props(styles.header)}>
            <Dialog.Title {...stylex.props(styles.title)}>{title}</Dialog.Title>
            <Dialog.Close aria-label={closeLabel} {...stylex.props(styles.close)}>
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div {...stylex.props(styles.content)}>{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Toast } from "@base-ui/react/toast";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { Action } from "@open-erp/ui/kanon/action";
import { FactCard, type Fact } from "@open-erp/ui/kanon/cards";
import { useKanonCopy } from "@open-erp/ui/kanon/copy";
import { StatusIcon } from "@open-erp/ui/kanon/status";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  backdrop: {
    backgroundColor: kanon.colorText,
    inset: 0,
    opacity: 0.22,
    position: "fixed",
    zIndex: 40,
  },
  dialog: {
    backgroundColor: kanon.colorSurface,
    borderRadius: kanon.radiusOverlay,
    boxShadow: kanon.shadowOverlay,
    display: "flex",
    flexDirection: "column",
    fontFamily: kanon.fontUi,
    insetInlineStart: "50%",
    maxWidth: "calc(100vw - 2rem)",
    position: "fixed",
    top: "20vh",
    transform: "translateX(-50%)",
    width: kanon.sizeDialog,
    zIndex: 50,
  },
  dialogBody: {
    display: "flex",
    flexDirection: "column",
    gap: kanon.space5,
    padding: kanon.space6,
  },
  dialogText: { display: "flex", flexDirection: "column", gap: kanon.space2 },
  title: {
    color: kanon.colorText,
    fontSize: kanon.textPage,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingPage,
    margin: 0,
  },
  description: {
    color: kanon.colorSecondary,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingReading,
    margin: 0,
  },
  footer: {
    backgroundColor: kanon.colorSideSurface,
    borderBottomLeftRadius: kanon.radiusOverlay,
    borderBottomRightRadius: kanon.radiusOverlay,
    borderTopColor: kanon.colorRule,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    display: "flex",
    gap: kanon.space2,
    justifyContent: "flex-end",
    paddingBlock: kanon.space4,
    paddingInline: kanon.space6,
  },
  drawer: {
    backgroundColor: kanon.colorSurface,
    boxShadow: kanon.shadowDrawer,
    display: "flex",
    flexDirection: "column",
    fontFamily: kanon.fontUi,
    height: "100dvh",
    insetInlineEnd: 0,
    maxWidth: "100vw",
    position: "fixed",
    top: 0,
    width: kanon.sizeDrawer,
    zIndex: 50,
  },
  drawerHead: {
    alignItems: "center",
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    height: kanon.sizeRowTall,
    justifyContent: "space-between",
    paddingInline: kanon.space6,
  },
  drawerBody: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: kanon.space4,
    overflowY: "auto",
    padding: kanon.space6,
  },
  close: {
    backgroundColor: "transparent",
    borderWidth: 0,
    color: kanon.colorSecondary,
    cursor: "pointer",
    fontSize: kanon.textPage,
    lineHeight: kanon.leadingPage,
  },
  viewport: {
    bottom: kanon.space6,
    display: "flex",
    flexDirection: "column",
    gap: kanon.space2,
    insetInlineStart: kanon.space6,
    position: "fixed",
    width: kanon.sizeToast,
    zIndex: 60,
  },
  toast: {
    alignItems: "center",
    backgroundColor: kanon.colorToast,
    borderRadius: kanon.radiusCard,
    boxShadow: kanon.shadowToast,
    color: kanon.colorOnAction,
    display: "flex",
    fontFamily: kanon.fontUi,
    gap: kanon.space3,
    paddingBlock: kanon.space3,
    paddingInline: kanon.space4,
  },
  toastText: { flexGrow: 1, fontSize: kanon.textBody, lineHeight: kanon.leadingBody, margin: 0 },
  toastAction: {
    backgroundColor: "transparent",
    borderWidth: 0,
    color: kanon.colorToastLink,
    cursor: "pointer",
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    fontWeight: kanon.weightMedium,
  },
});

/**
 * For what cannot be undone or leaves the system: issue, send, cancel.
 * `facts` repeats exactly what will happen; `confirmLabel` names the effect and amount.
 */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  facts?: ReadonlyArray<Fact>;
  confirmLabel: string;
  cancelLabel: string;
  risky?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop {...stylex.props(styles.backdrop)} />
        <AlertDialog.Popup {...stylex.props(styles.dialog)}>
          <div {...stylex.props(styles.dialogBody)}>
            <div {...stylex.props(styles.dialogText)}>
              <AlertDialog.Title {...stylex.props(styles.title)}>{props.title}</AlertDialog.Title>
              <AlertDialog.Description {...stylex.props(styles.description)}>
                {props.description}
              </AlertDialog.Description>
            </div>
            {props.facts !== undefined && <FactCard facts={props.facts} />}
          </div>
          <div {...stylex.props(styles.footer)}>
            <AlertDialog.Close
              render={
                <Action kind="secondary" besidePrimary>
                  {props.cancelLabel}
                </Action>
              }
            />
            <Action
              kind={props.risky === true ? "confirmRisky" : "primary"}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </Action>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * Settings that belong to what is on screen. 400 px from the right; the footer stays put.
 * `footer` holds a secondary with `besidePrimary`, then the primary.
 */
export function Drawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const copy = useKanonCopy();

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.drawer)}>
          <div {...stylex.props(styles.drawerHead)}>
            <Dialog.Title {...stylex.props(styles.title)}>{props.title}</Dialog.Title>
            <Dialog.Close aria-label={copy.close} {...stylex.props(styles.close)}>
              ×
            </Dialog.Close>
          </div>
          <div {...stylex.props(styles.drawerBody)}>{props.children}</div>
          <div {...stylex.props(styles.footer)}>{props.footer}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type ToastStatus = "done" | "replied" | "needsYou";

/** Mount once near the root. Toasts confirm; the panel explains. */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={6000}>
      {children}
      <Toast.Portal>
        <ToastList />
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const manager = Toast.useToastManager<{ status: ToastStatus }>();

  return (
    <Toast.Viewport {...stylex.props(styles.viewport)}>
      {manager.toasts.map((toast) => (
        <Toast.Root key={toast.id} toast={toast} {...stylex.props(styles.toast)}>
          <StatusIcon status={toast.data?.status ?? "done"} />
          <Toast.Title {...stylex.props(styles.toastText)} />
          {toast.actionProps !== undefined && (
            <Toast.Action {...stylex.props(styles.toastAction)} />
          )}
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}

/** At most one action per toast, such as "Ångra" or "Öppna". */
export function useNotify() {
  const manager = Toast.useToastManager<{ status: ToastStatus }>();

  return (status: ToastStatus, text: string, action?: { label: string; onClick: () => void }) => {
    manager.add({
      title: text,
      data: { status },
      actionProps:
        action === undefined ? undefined : { children: action.label, onClick: action.onClick },
    });
  };
}

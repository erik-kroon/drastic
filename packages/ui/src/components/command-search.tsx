import { useEffect, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 28,
    width: "100%",
    marginBlockEnd: tokens.space2,
    backgroundColor: tokens.card,
    color: tokens.mutedForeground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusControl,
    paddingInline: tokens.space2,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  shortcut: { fontSize: tokens.fontSizeCompact },
  backdrop: { position: "fixed", inset: 0, backgroundColor: tokens.menuBackdrop, zIndex: 40 },
  popup: {
    position: "fixed",
    insetBlockStart: 110,
    insetInlineStart: "50%",
    transform: "translateX(-50%)",
    width: 560,
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "calc(100dvh - 142px)",
    overflowY: "auto",
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusOverlay,
    boxShadow: tokens.shadowFloating,
    zIndex: 45,
  },
  input: {
    width: "100%",
    height: 44,
    paddingInline: tokens.space4,
    borderWidth: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    backgroundColor: tokens.card,
    color: tokens.foreground,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
  results: { padding: tokens.space1_5 },
  group: {
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
    paddingBlock: tokens.space1_5,
    paddingInline: tokens.space2_5,
    textTransform: "uppercase",
  },
  result: {
    minHeight: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
    paddingInline: tokens.space2_5,
    paddingBlock: tokens.space1_5,
    borderRadius: tokens.radiusControl,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.foreground,
    textDecoration: "none",
    ":hover": { backgroundColor: tokens.registerSelected },
    ":focus-visible": {
      outline: "none",
      backgroundColor: tokens.registerSelected,
      boxShadow: tokens.focusRingInset,
    },
  },
  detail: { color: tokens.mutedForeground, flexShrink: 0, fontSize: tokens.fontSizeXs },
  hidden: { position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" },
});

export function CommandSearch(props: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  groups: readonly {
    title: string;
    items: readonly { title: string; detail?: string; href: string }[];
  }[];
  status?: ReactNode;
}) {
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        props.onOpenChange(!props.open);
      }
    };

    document.addEventListener("keydown", shortcut);

    return () => document.removeEventListener("keydown", shortcut);
  }, [props.open, props.onOpenChange]);

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Trigger {...stylex.props(styles.trigger)}>
        {props.label}
        <span {...stylex.props(styles.shortcut)}>Ctrl K</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.popup)}>
          <Dialog.Title {...stylex.props(styles.hidden)}>{props.label}</Dialog.Title>
          <input
            type="search"
            aria-label={props.label}
            placeholder={props.label}
            value={props.query}
            maxLength={200}
            onChange={(event) => props.onQueryChange(event.target.value)}
            {...stylex.props(styles.input)}
          />
          <div {...stylex.props(styles.results)}>
            {props.groups.map((group) =>
              group.items.length ? (
                <section key={group.title}>
                  <h2 {...stylex.props(styles.group)}>{group.title}</h2>
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => props.onOpenChange(false)}
                      {...stylex.props(styles.result)}
                    >
                      <span>{item.title}</span>
                      {item.detail ? (
                        <span {...stylex.props(styles.detail)}>{item.detail}</span>
                      ) : null}
                    </Link>
                  ))}
                </section>
              ) : null,
            )}
            {props.status}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

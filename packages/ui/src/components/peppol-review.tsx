import { Fragment } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Button } from "@open-erp/ui/components/button";

const styles = stylex.create({
  checks: { margin: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":first-child": {
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  state: { margin: 0, flexShrink: 0, marginInlineStart: 12 },
  failed: { color: tokens.historicalRefusalForeground, fontWeight: tokens.fontWeightSemibold },
  passed: { color: tokens.registerSuccess, fontWeight: tokens.fontWeightSemibold },
  diagnostic: {
    backgroundColor: tokens.retainedRefusalBackground,
    color: tokens.historicalRefusalForeground,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.historicalRefusalBorder,
    paddingBlock: 8,
    paddingInline: 12,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  recovery: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 52,
    paddingBlock: 8,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    ":first-child": {
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  recoveryText: { display: "flex", flexDirection: "column", flexGrow: 1, gap: 2 },
  title: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightMedium,
  },
  note: {
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
  },
});

export function PeppolChecks({
  rows,
}: {
  rows: readonly {
    label: string;
    state: string;
    passed: boolean;
    diagnostics?: readonly string[];
  }[];
}) {
  return (
    <dl {...stylex.props(styles.checks)}>
      {rows.map((row) => (
        <Fragment key={row.label}>
          <div {...stylex.props(styles.row)}>
            <dt>{row.label}</dt>
            <dd {...stylex.props(styles.state, row.passed ? styles.passed : styles.failed)}>
              {row.state}
            </dd>
          </div>
          {row.diagnostics?.map((diagnostic) => (
            <div role="alert" key={diagnostic} {...stylex.props(styles.diagnostic)}>
              {diagnostic}
            </div>
          ))}
        </Fragment>
      ))}
    </dl>
  );
}

export function PeppolRecoveries(props: {
  email: () => void;
  credit: () => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div {...stylex.props(styles.recovery)}>
        <div {...stylex.props(styles.recoveryText)}>
          <span {...stylex.props(styles.title)}>Skicka samma faktura som PDF i e-post</span>
          <span {...stylex.props(styles.note)}>
            Fakturan ändras inte. Kunden får den inte som e-faktura, och e-postutskicket godkänns
            för sig.
          </span>
        </div>
        <Button variant="outline" onClick={props.email} disabled={props.disabled}>
          Förbered e-post
        </Button>
      </div>
      <div {...stylex.props(styles.recovery)}>
        <div {...stylex.props(styles.recoveryText)}>
          <span {...stylex.props(styles.title)}>
            Kreditera fakturan och utfärda en ny med kundens referens
          </span>
          <span {...stylex.props(styles.note)}>
            En utfärdad faktura går inte att ändra. Krediteringen granskas som egen handling innan
            en ny faktura kan utfärdas.
          </span>
        </div>
        <Button variant="outline" onClick={props.credit} disabled={props.disabled}>
          Förbered kredit
        </Button>
      </div>
    </div>
  );
}

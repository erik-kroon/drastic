import * as stylex from "@stylexjs/stylex";
import { createElement, type ComponentPropsWithRef } from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  page: { gap: tokens.space1 },
  mappingPage: { gap: 0 },
  openingPage: { gap: 0 },
  verificationPage: { gap: 0 },
  deltaPage: { gap: 0 },
  deltaPrimary: { paddingInline: tokens.space3 },
  deltaSummary: {
    marginBlockStart: tokens.space6,
    fontSize: tokens.fontSizeXl,
    lineHeight: tokens.lineHeight24Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  deltaChoice: {
    height: tokens.controlHeightXs,
    paddingInline: tokens.space2_5,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightNormal,
  },
  deltaChosen: {
    backgroundColor: tokens.registerSelected,
    color: tokens.primary,
    borderColor: tokens.primary,
    fontWeight: tokens.fontWeightMedium,
  },
  deltaExample: {
    width: tokens.setupFocusedWidth,
    marginBlockStart: tokens.space6,
    paddingBlock: tokens.space3,
    paddingInline: tokens.space4,
    backgroundColor: tokens.sidebar,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusControl,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space1,
  },
  verificationSummary: {
    marginBlockStart: tokens.space5,
    paddingBlockEnd: tokens.space4,
    fontSize: tokens.fontSizeXl,
    lineHeight: tokens.lineHeight24Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  verificationRow: { gap: tokens.space4, height: tokens.setupSourceRowHeight },
  verificationTall: { height: tokens.setupVerificationTallHeight },
  verificationLabel: {
    width: tokens.setupVerificationLabelWidth,
    flexShrink: 0,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeCompact,
    lineHeight: tokens.lineHeight14Px,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingGroup,
  },
  verificationDetail: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexBasis: 0,
    gap: tokens.space0_5,
  },
  verificationHeading: {
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  verificationCaption: {
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  verificationAction: {
    paddingInline: 0,
    color: tokens.primary,
    justifyContent: "end",
    whiteSpace: "nowrap",
    width: tokens.setupColumn100,
    flexShrink: 0,
    textAlign: "end",
  },
  verificationTax: {
    height: tokens.setupVerificationTaxHeight,
    backgroundColor: tokens.warning,
    gap: 0,
    borderInlineStartWidth: 3,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.warningForeground,
    borderBlockEndColor: tokens.warningBorder,
  },
  verificationTaxLabel: {
    width: tokens.setupControlLabelWidth,
    paddingInlineStart: tokens.setupVerificationTaxInset,
    color: tokens.warningForeground,
  },
  openingSubtitle: { marginBlockStart: tokens.space1, color: tokens.mutedForeground },
  openingDetailTitle: { fontSize: tokens.fontSizeSm, lineHeight: tokens.lineHeight18Px },
  openingDetail: { width: tokens.setupDetailWidth, display: "flex", flexDirection: "column" },
  openingInvoice: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBlock: tokens.space2_5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  openingInvoiceText: { display: "flex", flexDirection: "column", gap: tokens.space0_5 },
  openingInvoiceSum: {
    display: "flex",
    justifyContent: "space-between",
    paddingBlock: tokens.space2_5,
    fontWeight: tokens.fontWeightSemibold,
  },
  openingNote: {
    marginBlockStart: tokens.space4,
    width: tokens.setupOpeningNoteWidth,
    color: tokens.mutedForeground,
    lineHeight: tokens.lineHeight20Px,
  },
  mappingSubtitle: { marginBlockStart: tokens.space1, color: tokens.mutedForeground },
  mappingField: { marginBlockStart: tokens.space1_5 },
  mappingHint: { marginBlockStart: tokens.space1_5 },
  mappingHeading: {
    marginBlockStart: tokens.space7,
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  inset: { paddingInlineEnd: tokens.space8 },
  workspace: { width: tokens.setupWorkspaceWithGutter, paddingBlockStart: tokens.space8 },
  focused: {
    width: tokens.setupFocusedWidth,
    paddingInlineStart: 0,
    marginInlineStart: tokens.space8,
  },
  focusedEarly: { paddingBlockStart: tokens.space8 },
  crumb: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space1_5,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
  },
  crumbButton: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: "inherit",
    textAlign: "start",
    cursor: "pointer",
    ":focus-visible": { outline: tokens.setupControlFocus, outlineOffset: 2 },
  },
  title: { marginBlockStart: tokens.space4 },
  earlyTitle: { marginBlockStart: tokens.space3 },
  subtitle: { color: tokens.mutedForeground },
  secondary: { color: tokens.mutedForeground },
  caption: { color: tokens.captionForeground, fontSize: tokens.fontSizeXs },
  success: { color: tokens.successForeground },
  warning: { color: tokens.warningForeground },
  blocked: { color: tokens.destructive },
  primary: { color: tokens.primary },
  medium: { fontWeight: tokens.fontWeightMedium },
  semibold: { fontWeight: tokens.fontWeightSemibold },
  section: { marginBlockStart: tokens.space4 },
  section20: { marginBlockStart: tokens.space5 },
  section24: { marginBlockStart: tokens.space6 },
  section28: { marginBlockStart: tokens.space7 },
  note: { marginBlockStart: tokens.space3 },
  tableSpace: { marginBlockStart: tokens.space2 },
  stack: { display: "flex", flexDirection: "column" },
  stack4: { display: "flex", flexDirection: "column", gap: tokens.space1 },
  stack8: { display: "flex", flexDirection: "column", gap: tokens.space2 },
  stack12: { display: "flex", flexDirection: "column", gap: tokens.space3 },
  columns: { display: "flex", alignItems: "start", gap: tokens.space10 },
  openingColumns: {
    display: "flex",
    alignItems: "start",
    gap: tokens.space12,
    width: tokens.setupWorkspaceWidth,
  },
  checklist: {
    width: tokens.setupFocusedWidth,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space4,
  },
  checklistHeading: {
    paddingBlockEnd: tokens.space1_5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  checklistRow: {
    display: "flex",
    alignItems: "center",
    height: tokens.setupChecklistRowHeight,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.borderAlpha50,
  },
  checklistLabel: { width: tokens.setupColumn150, flexShrink: 0, color: tokens.primary },
  checklistDetail: {
    width: tokens.setupChecklistDetailWidth,
    color: tokens.mutedForeground,
    flexShrink: 0,
  },
  checklistStatus: { width: tokens.setupColumn160, flexShrink: 0 },
  workspaceBlockerHeading: {
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  workspaceContinue: { marginBlockStart: tokens.space1_5 },
  workspaceStatus: { fontWeight: tokens.fontWeightMedium },
  blockers: {
    width: tokens.setupDetailWidth,
    padding: tokens.space4,
    backgroundColor: tokens.sidebar,
    borderRadius: tokens.radiusSurface,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space2_5,
  },
  sourceDetail: {
    width: tokens.setupSourceDetailWidth,
    padding: tokens.space4,
    backgroundColor: tokens.sidebar,
    borderRadius: tokens.radiusSurface,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space3,
  },
  sourceDetailHeading: {
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  detail: {
    width: tokens.setupSourceDetailWidth,
    padding: tokens.space4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusSurface,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space3,
  },
  plainAction: {
    paddingInline: tokens.space2,
    backgroundColor: "transparent",
    color: tokens.foreground,
    borderWidth: 0,
  },
  actions: { display: "flex", alignItems: "center", gap: tokens.space1_5 },
  actions8: { display: "flex", alignItems: "center", gap: tokens.space2 },
  actions12: { display: "flex", alignItems: "center", gap: tokens.space3 },
  importPage: { gap: 0 },
  importStatistic: { paddingBlock: tokens.space5 },
  importStatisticNumber: {
    fontSize: tokens.fontSizeDisplaySmall,
    lineHeight: tokens.lineHeight36Px,
  },
  importRow: { paddingBlock: tokens.space3_5, minHeight: 0 },
  importLabel: { width: tokens.setupColumn300, flexShrink: 0, gap: tokens.space0_5 },
  importDetail: { width: tokens.setupColumn400, flexShrink: 0, color: tokens.mutedForeground },
  importRowAction: { marginInlineStart: "auto" },
  summary: {
    display: "flex",
    width: tokens.setupInnerWidth,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: tokens.border,
  },
  statistic: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space1,
    paddingBlock: tokens.space4,
    width: tokens.setupStatisticWidth,
  },
  statisticNumber: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight24Px,
  },
  rule: {
    width: "100%",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  row: {
    display: "flex",
    alignItems: "center",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    paddingBlock: tokens.space1_75,
  },
  name: { width: tokens.setupColumn140, flexShrink: 0 },
  factLabel: { width: tokens.setupColumn200, flexShrink: 0, color: tokens.mutedForeground },
  facts: {
    display: "flex",
    flexDirection: "column",
    width: tokens.setupInnerWidth,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  receiptPage: { gap: 0 },
  receiptDetail: { lineHeight: tokens.lineHeight20Px },
  receiptRow: { paddingBlock: tokens.space2_5 },
  factRow: {
    display: "flex",
    paddingBlock: tokens.space3,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  headingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: tokens.setupInnerWidth,
  },
  controls: {
    width: tokens.setupInnerWidth,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space4,
    minHeight: tokens.setupSourceRowHeight,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  controlTitle: {
    width: tokens.setupControlLabelWidth,
    flexShrink: 0,
    fontWeight: tokens.fontWeightMedium,
  },
  amberRow: { backgroundColor: tokens.warning, paddingInline: tokens.space3 },
  gate: {
    display: "flex",
    alignItems: "center",
    height: tokens.controlHeightLg,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  gateTitle: { width: tokens.setupFocusedWidth, flexShrink: 0 },
  cutoverPage: { gap: 0 },
  cutoverActions: { alignItems: "start" },
  authorityTitle: {
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  authorityIncumbent: { backgroundColor: tokens.setupIncumbentBackground },
  authorityCandidate: { backgroundColor: tokens.registerSelected },
  authority: { display: "flex", gap: tokens.space4, width: tokens.setupInnerWidth },
  authorityCard: {
    width: tokens.setupAuthorityWidth,
    padding: tokens.space4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.setupAuthorityBorder,
    borderRadius: tokens.radiusControl,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space1_5,
  },
  banner: {
    width: tokens.setupInnerWidth,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space1,
    padding: tokens.space4,
    backgroundColor: tokens.registerSelected,
    borderRadius: tokens.radiusSurface,
  },
  firstPeriodPage: { gap: 0 },
  firstPeriodBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space2,
    paddingBlock: tokens.space2,
    paddingInline: tokens.space3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.setupAuthorityBorder,
    borderRadius: tokens.radiusControl,
  },
  firstPeriodTitle: { color: tokens.primary, fontWeight: tokens.fontWeightSemibold },
  firstPeriodWarning: { backgroundColor: tokens.warning },
  firstPeriodWarningLabel: {
    paddingInlineStart: tokens.space2,
    fontWeight: tokens.fontWeightMedium,
  },
  periodRow: {
    display: "flex",
    alignItems: "center",
    height: tokens.controlHeightIconLg,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  periodLabel: { width: tokens.setupColumn240, flexShrink: 0 },
  responsibilityPage: { gap: 0 },
  responsibilitySubtitle: { marginBlockStart: tokens.space1 },
  responsibilityHeading: {
    paddingBlockStart: tokens.space3,
    paddingBlockEnd: tokens.space1_5,
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
  },
  responsibilityRow: {
    display: "flex",
    paddingBlock: tokens.space1_75,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  responsibilityLastRow: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  responsibilityButton: { width: tokens.setupResponsibilityButtonWidth },
  responsibilityCaption: { lineHeight: tokens.lineHeight18Px },
  personSelect: {
    width: tokens.setupFocusedWidth,
    height: tokens.controlHeightSm,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightNormal,
    borderColor: tokens.border,
  },
  personSelf: {
    display: "flex",
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusControl,
    paddingInline: tokens.space2_5,
    height: tokens.controlHeightSm,
  },
  select: {
    width: tokens.setupMappingWidth,
    fontSize: tokens.fontSizeControl,
    fontWeight: tokens.fontWeightNormal,
  },
  radio: {
    appearance: "none",
    width: tokens.setupDecisionRadioSize,
    height: tokens.setupDecisionRadioSize,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusFull,
    margin: 0,
    backgroundColor: tokens.workspaceSurface,
    ":focus-visible": { outline: tokens.setupControlFocus, outlineOffset: 2 },
  },
  responsibilityRadio: {
    width: tokens.setupResponsibilityRadioSize,
    height: tokens.setupResponsibilityRadioSize,
  },
  radioSelected: { borderWidth: 4, borderColor: tokens.primary },
  radioOptions: { display: "flex", gap: tokens.space5 },
  radioOption: { display: "flex", alignItems: "center", gap: tokens.space1_5 },
  responsibilityGroups: {
    marginBlockStart: tokens.space5,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space4_5,
  },
  dialogHeading: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight18Px,
  },
  dialogCopy: { display: "flex", flexDirection: "column", gap: tokens.space1_5 },
});

export type SetupVariant = keyof typeof styles;

export type SetupLayout = readonly (SetupVariant | false | null | undefined)[];

export function setupLayoutStyles(layout: SetupLayout = []) {
  return layout.map((variant) => (variant ? styles[variant] : null));
}

type BlockElement =
  | "div"
  | "section"
  | "aside"
  | "nav"
  | "form"
  | "fieldset"
  | "label"
  | "ul"
  | "li";

export function SetupBlock<T extends BlockElement = "div">({
  as,
  layout,
  ...props
}: Omit<ComponentPropsWithRef<T>, "className" | "style"> & { as?: T; layout?: SetupLayout }) {
  return createElement(as ?? "div", { ...props, ...stylex.props(setupLayoutStyles(layout)) });
}

export function SetupText<T extends "span" | "p" | "h2" | "legend" = "span">({
  as,
  layout,
  ...props
}: Omit<ComponentPropsWithRef<T>, "className" | "style"> & { as?: T; layout?: SetupLayout }) {
  return createElement(as ?? "span", { ...props, ...stylex.props(setupLayoutStyles(layout)) });
}

export function SetupInlineAction({
  layout,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "className" | "style"> & { layout?: SetupLayout }) {
  return (
    <button
      type="button"
      {...props}
      {...stylex.props(styles.crumbButton, setupLayoutStyles(layout))}
    />
  );
}

export function SetupRadio({
  layout,
  checked,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "className" | "style"> & { layout?: SetupLayout }) {
  return (
    <input
      {...props}
      checked={checked}
      {...stylex.props(styles.radio, checked && styles.radioSelected, setupLayoutStyles(layout))}
    />
  );
}

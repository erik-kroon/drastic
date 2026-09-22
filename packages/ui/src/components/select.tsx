"use client";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import {
  stateStylexProps,
  stylexProps,
  type StyleXStyles,
  type WithStyleX,
} from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type * as React from "react";

const Select = SelectPrimitive.Root;
const styles = stylex.create({
  control: { width: "100%" },
  comfortable: {
    minHeight: tokens.space10,
    height: "auto",
    fontSize: tokens.fontSizeSm,
    paddingBlock: tokens.space2,
  },
  value: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  placeholder: { color: tokens.mutedForeground },
  trigger: {
    alignItems: "center",
    backgroundColor: { default: tokens.background, ":hover": tokens.muted },
    borderColor: {
      default: tokens.input,
      ":focus-visible": tokens.ring,
      "[aria-invalid='true']": tokens.controlInvalidBorder,
    },
    borderRadius: tokens.radiusControl,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: {
      default: tokens.shadowXs,
      ":focus-visible": tokens.controlFocusShadow,
      "[aria-invalid='true']": tokens.controlInvalidShadow,
    },
    display: "flex",
    fontSize: { default: tokens.fontSizeBase, "@media (min-width: 768px)": tokens.fontSizeXs },
    fontWeight: tokens.fontWeightMedium,
    gap: tokens.space2,
    height: tokens.controlHeight,
    justifyContent: "space-between",
    minWidth: 0,
    outline: "none",
    paddingInline: tokens.space2_5,
    position: "relative",
    transitionDuration: tokens.durationControl,
    transitionProperty: "color, background-color, border-color, box-shadow",
    userSelect: "none",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    "::after": {
      content: "''",
      inset: 0,
      position: "absolute",
      "@media (pointer: coarse)": { minHeight: "2.75rem" },
    },
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  open: { backgroundColor: tokens.muted },
  disabled: { opacity: 0.5 },
  iconWrap: { color: tokens.mutedForeground, flexShrink: 0 },
  icon: { height: "0.875rem", width: "0.875rem" },
  positioner: { isolation: "isolate", outline: "none", zIndex: 50 },
  popup: {
    backgroundColor: tokens.popover,
    borderColor: tokens.border,
    borderRadius: tokens.radiusOverlay,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: tokens.shadowFloating,
    color: tokens.popoverForeground,
    width: "max-content",
    minWidth: "var(--anchor-width)",
    maxWidth: "var(--available-width)",
    opacity: 1,
    outline: "none",
    overflow: "hidden",
    scale: 1,
    transformOrigin: "var(--transform-origin)",
    transitionDuration: tokens.durationFast,
    transitionProperty: "scale, opacity",
    transitionTimingFunction: tokens.easeSmoothOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  popupStarting: { opacity: 0, scale: tokens.scaleMedium },
  popupEnding: {
    opacity: 0,
    scale: tokens.scaleTiny,
    transitionDuration: tokens.durationQuick,
  },
  scrollArrow: {
    alignItems: "center",
    backgroundColor: tokens.popover,
    color: tokens.mutedForeground,
    display: "flex",
    height: tokens.controlHeightXs,
    justifyContent: "center",
  },
  list: {
    maxHeight: "var(--available-height)",
    overflowY: "auto",
    padding: tokens.space1,
    scrollPaddingBlockStart: tokens.space7,
    scrollPaddingBlockEnd: tokens.space7,
  },
  item: {
    alignItems: "center",
    borderRadius: tokens.radiusControl,
    cursor: "default",
    display: "grid",
    fontSize: { default: tokens.fontSizeBase, "@media (min-width: 768px)": tokens.fontSizeXs },
    gap: tokens.space2,
    gridTemplateColumns: "1rem minmax(0, 1fr)",
    outline: "none",
    minHeight: tokens.space10,
    "@media (pointer: coarse)": { minHeight: tokens.space11 },
    paddingBlock: tokens.space2,
    paddingInline: tokens.space2,
    userSelect: "none",
  },
  highlighted: {
    backgroundColor: tokens.accent,
    color: tokens.accentForeground,
  },
  indicator: { gridColumnStart: "1" },
  itemText: {
    gridColumnStart: "2",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  label: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightMedium,
    paddingBlock: tokens.space1_5,
    paddingInline: tokens.space2,
  },
  separator: {
    backgroundColor: tokens.border,
    height: 1,
    marginBlock: tokens.space1,
  },
});

type SelectOption = {
  disabled?: boolean;
  label: React.ReactNode;
  value: string;
};

type SelectControlProps = {
  size?: "default" | "comfortable";
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  defaultValue?: string | null;
  disabled?: boolean;
  form?: string;
  id?: string;
  name?: string;
  onValueChange?: (value: string | null) => void;
  options: readonly SelectOption[];
  placeholder?: React.ReactNode;
  required?: boolean;
  styleX?: StyleXStyles;
  value?: string | null;
};

function SelectValue({ className, styleX, ...props }: WithStyleX<SelectPrimitive.Value.Props>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      {...stateStylexProps(
        (state) => [styles.value, state.placeholder && styles.placeholder, styleX],
        className,
      )}
      {...props}
    />
  );
}
function SelectTrigger({
  className,
  children,
  styleX,
  ...props
}: WithStyleX<SelectPrimitive.Trigger.Props>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      {...stateStylexProps(
        (state) => [
          styles.trigger,
          state.open && styles.open,
          state.disabled && styles.disabled,
          styleX,
        ],
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon {...stylex.props(styles.iconWrap)}>
        <ChevronDownIcon aria-hidden="true" strokeWidth={1.75} {...stylex.props(styles.icon)} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
  children,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  styleX,
  ...props
}: WithStyleX<SelectPrimitive.Popup.Props> &
  Pick<SelectPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        alignItemWithTrigger={false}
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        {...stylex.props(styles.positioner)}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          {...stateStylexProps(
            (state) => [
              styles.popup,
              state.transitionStatus === "starting" && styles.popupStarting,
              state.transitionStatus === "ending" && styles.popupEnding,
              styleX,
            ],
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow {...stylex.props(styles.scrollArrow)}>
            <ChevronUpIcon aria-hidden="true" strokeWidth={1.75} {...stylex.props(styles.icon)} />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            {...stylex.props(styles.list)}
          >
            {children}
          </SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow {...stylex.props(styles.scrollArrow)}>
            <ChevronDownIcon aria-hidden="true" strokeWidth={1.75} {...stylex.props(styles.icon)} />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  styleX,
  ...props
}: WithStyleX<SelectPrimitive.Item.Props>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      {...stateStylexProps(
        (state) => [
          styles.item,
          state.highlighted && styles.highlighted,
          state.disabled && styles.disabled,
          styleX,
        ],
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator {...stylex.props(styles.indicator)}>
        <CheckIcon aria-hidden="true" strokeWidth={1.75} {...stylex.props(styles.icon)} />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText {...stylex.props(styles.itemText)}>
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}
function SelectLabel({
  className,
  styleX,
  ...props
}: WithStyleX<SelectPrimitive.GroupLabel.Props>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      {...stylexProps([styles.label, styleX], className)}
      {...props}
    />
  );
}
function SelectSeparator({
  className,
  styleX,
  ...props
}: WithStyleX<SelectPrimitive.Separator.Props>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      {...stylexProps([styles.separator, styleX], className)}
      {...props}
    />
  );
}

function SelectControl({
  size = "default",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
  defaultValue,
  disabled,
  form,
  id,
  name,
  onValueChange,
  options,
  placeholder,
  required,
  styleX,
  value,
}: SelectControlProps) {
  return (
    <Select
      defaultValue={defaultValue}
      disabled={disabled}
      form={form}
      items={options}
      name={name}
      onValueChange={onValueChange}
      required={required}
      value={value}
    >
      <SelectTrigger
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={className}
        id={id}
        styleX={[styles.control, size === "comfortable" && styles.comfortable, styleX]}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent aria-label={ariaLabel} aria-labelledby={ariaLabelledBy ?? id}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem disabled={option.disabled} key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export {
  Select,
  SelectContent,
  SelectControl,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
export type { SelectControlProps, SelectOption };

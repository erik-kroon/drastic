"use client";

import { Button } from "@open-erp/ui/components/button";
import { getPaginationItems, type PaginationItem } from "@open-erp/ui/lib/pagination-items";
import { stylexProps, type StyleXStyles } from "@open-erp/ui/lib/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

const styles = stylex.create({
  nav: { display: "flex", justifyContent: "center", width: "100%" },
  list: {
    alignItems: "center",
    display: "flex",
    gap: tokens.space1,
    flexWrap: "wrap",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  current: { backgroundColor: tokens.accent, borderColor: tokens.border },
  ellipsis: {
    alignItems: "center",
    color: tokens.mutedForeground,
    display: "flex",
    height: "2rem",
    justifyContent: "center",
    width: "2rem",
  },
  icon: { height: "0.875rem", width: "0.875rem" },
});

type PaginationProps = {
  ariaLabel?: string;
  className?: string;
  nextLabel?: string;
  onPageChange: (page: number) => void;
  page: number;
  pageCount: number;
  pageLabel?: (page: number) => string;
  previousLabel?: string;
  siblings?: number;
  styleX?: StyleXStyles;
};

type CursorPaginationProps = {
  disabled?: boolean;
  ariaLabel?: string;
  canNext: boolean;
  canPrevious: boolean;
  className?: string;
  nextLabel?: string;
  onNext: () => void;
  onPrevious: () => void;
  previousLabel?: string;
  styleX?: StyleXStyles;
};

function CursorPagination({
  disabled = false,
  ariaLabel = "Pagination",
  canNext,
  canPrevious,
  className,
  nextLabel = "Next page",
  onNext,
  onPrevious,
  previousLabel = "Previous page",
  styleX,
}: CursorPaginationProps) {
  if (!canPrevious && !canNext) return null;
  return (
    <nav aria-label={ariaLabel} {...stylexProps([styles.nav, styleX], className)}>
      <div {...stylex.props(styles.list)}>
        <Button
          disabled={disabled || !canPrevious}
          onClick={onPrevious}
          size="xl"
          type="button"
          variant="outline"
        >
          <ChevronLeftIcon aria-hidden="true" {...stylex.props(styles.icon)} />
          {previousLabel}
        </Button>
        <Button
          disabled={disabled || !canNext}
          onClick={onNext}
          size="xl"
          type="button"
          variant="outline"
        >
          {nextLabel}
          <ChevronRightIcon aria-hidden="true" {...stylex.props(styles.icon)} />
        </Button>
      </div>
    </nav>
  );
}

function Pagination({
  ariaLabel = "Pagination",
  className,
  nextLabel = "Next page",
  onPageChange,
  page,
  pageCount,
  pageLabel = (item) => `Page ${item}`,
  previousLabel = "Previous page",
  siblings = 1,
  styleX,
}: PaginationProps) {
  const current = Math.min(Math.max(1, page), Math.max(1, pageCount));
  return (
    <nav aria-label={ariaLabel} {...stylexProps([styles.nav, styleX], className)}>
      <ol {...stylex.props(styles.list)}>
        <li>
          <Button
            aria-label={previousLabel}
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
            size="icon"
            type="button"
            variant="outline"
          >
            <ChevronLeftIcon aria-hidden="true" {...stylex.props(styles.icon)} />
          </Button>
        </li>
        {getPaginationItems(current, pageCount, siblings).map((item) =>
          item !== "ellipsis-start" && item !== "ellipsis-end" ? (
            <li key={item}>
              <Button
                aria-current={item === current ? "page" : undefined}
                aria-label={pageLabel(item)}
                onClick={() => onPageChange(item)}
                size="icon"
                styleX={item === current ? styles.current : undefined}
                type="button"
                variant="outline"
              >
                {item}
              </Button>
            </li>
          ) : (
            <li aria-hidden="true" key={item}>
              <span {...stylex.props(styles.ellipsis)}>
                <MoreHorizontalIcon {...stylex.props(styles.icon)} />
              </span>
            </li>
          ),
        )}
        <li>
          <Button
            aria-label={nextLabel}
            disabled={current >= pageCount}
            onClick={() => onPageChange(current + 1)}
            size="icon"
            type="button"
            variant="outline"
          >
            <ChevronRightIcon aria-hidden="true" {...stylex.props(styles.icon)} />
          </Button>
        </li>
      </ol>
    </nav>
  );
}

export { CursorPagination, Pagination, getPaginationItems };
export type { CursorPaginationProps, PaginationItem, PaginationProps };

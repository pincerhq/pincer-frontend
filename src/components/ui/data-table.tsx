/**
 * DataTable (T-FE0.5): sortable columns, an optional filter bar slot, a
 * sticky header, and a card layout under `md` so lists stay usable at 390 px
 * (Block I rule 4). Server state stays outside — the table sorts what it is
 * given, and says nothing about what the server has not sent.
 *
 * Column `sort` is a comparator over rows; the header button announces the
 * current direction via `aria-sort`. Every string the table itself renders
 * (empty state, sort labels) is passed in by the caller so it stays in the
 * caller's namespace and locale.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  sort?: (a: Row, b: Row) => number;
  /** Alignment for numbers. */
  align?: "left" | "right";
  className?: string;
  /** Hide the column in the mobile card layout. */
  hideOnMobile?: boolean;
  /** Use as the card title on mobile. */
  primary?: boolean;
}

export interface DataTableLabels {
  empty: string;
  sortBy: (column: string) => string;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  rowKey: (row: Row) => string;
  labels: DataTableLabels;
  filterBar?: ReactNode;
  onRowClick?: (row: Row) => void;
  isRowActive?: (row: Row) => boolean;
  defaultSort?: { key: string; direction: "asc" | "desc" };
  className?: string;
  /** Rendered instead of the empty label (e.g. an <EmptyState/>). */
  emptyState?: ReactNode;
}

type Direction = "asc" | "desc";

// Technical tokens, not copy — kept out of JSX so the i18n lint sees them as data.
const ARIA_SORT: Record<Direction, "ascending" | "descending"> = { asc: "ascending", desc: "descending" };
const ariaSortFor = (d: Direction | null): "ascending" | "descending" | "none" => (d ? ARIA_SORT[d] : "none");
const BUTTON_TAG = "button" as const;
const DIV_TAG = "div" as const;

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  labels,
  filterBar,
  onRowClick,
  isRowActive,
  defaultSort,
  className,
  emptyState,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ key: string; direction: Direction } | null>(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const copy = [...rows].sort(col.sort);
    return sort.direction === "asc" ? copy : copy.reverse();
  }, [rows, columns, sort]);

  const toggle = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const clickable = Boolean(onRowClick);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {filterBar && <div className="mb-3 flex flex-wrap items-center gap-2">{filterBar}</div>}

      {sorted.length === 0 ? (
        emptyState ?? <p className="py-8 text-center text-sm text-[var(--text-3)]">{labels.empty}</p>
      ) : (
        <>
          {/* Desktop: table with sticky header */}
          <div className="hidden min-h-0 overflow-auto rounded-[14px] border border-[var(--line)] md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--paper)]">
                <tr className="border-b border-[var(--line)]">
                  {columns.map((col) => {
                    const active = sort?.key === col.key;
                    const ariaSort = ariaSortFor(active ? sort!.direction : null);
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={col.sort ? ariaSort : undefined}
                        className={cn(
                          "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]",
                          col.align === "right" && "text-right",
                          col.className,
                        )}
                      >
                        {col.sort ? (
                          <button
                            type="button"
                            onClick={() => toggle(col.key)}
                            aria-label={labels.sortBy(typeof col.header === "string" ? col.header : col.key)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                              col.align === "right" && "flex-row-reverse",
                            )}
                          >
                            <span>{col.header}</span>
                            {active ? (
                              sort!.direction === "asc" ? (
                                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3 w-3" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          col.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const active = isRowActive?.(row) ?? false;
                  return (
                    <tr
                      key={rowKey(row)}
                      onClick={clickable ? () => onRowClick!(row) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onRowClick!(row);
                              }
                            }
                          : undefined
                      }
                      tabIndex={clickable ? 0 : undefined}
                      aria-selected={clickable ? active : undefined}
                      className={cn(
                        "border-b border-[var(--line-soft)] last:border-b-0",
                        clickable && "cursor-pointer hover:bg-[rgba(20,22,26,0.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]",
                        active && "bg-[rgba(20,22,26,0.05)]",
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn("px-3 py-2 align-middle", col.align === "right" && "text-right tabular-nums", col.className)}
                        >
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: one card per row */}
          <ul className="space-y-2 md:hidden">
            {sorted.map((row) => {
              const active = isRowActive?.(row) ?? false;
              const Tag = clickable ? BUTTON_TAG : DIV_TAG;
              return (
                <li key={rowKey(row)}>
                  <Tag
                    type={clickable ? "button" : undefined}
                    onClick={clickable ? () => onRowClick!(row) : undefined}
                    aria-pressed={clickable ? active : undefined}
                    className={cn(
                      "block w-full rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-3 text-left",
                      clickable && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                      active && "border-[var(--brand-200)] bg-[var(--brand-100)]/40",
                    )}
                  >
                    <div className="text-sm font-semibold text-[var(--ink)]">{primary.cell(row)}</div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      {columns
                        .filter((c) => c !== primary && !c.hideOnMobile)
                        .map((col) => (
                          <div key={col.key} className="min-w-0">
                            <dt className="truncate text-[var(--text-3)]">{col.header}</dt>
                            <dd className="truncate text-[var(--text-1)]">{col.cell(row)}</dd>
                          </div>
                        ))}
                    </dl>
                  </Tag>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

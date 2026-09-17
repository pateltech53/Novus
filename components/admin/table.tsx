import type { ReactNode } from "react";

/** Shared ledger treatment for operator data. A real table on wide screens;
 * labelled records on phones. The data and action DOM exist only once, so a
 * hidden desktop copy can never receive a grant intended for another record. */
export function AdminTable({
  label,
  columns,
  children,
  compact = false,
  numericColumns = [],
}: {
  label: string;
  columns: string[];
  children: ReactNode;
  compact?: boolean;
  numericColumns?: string[];
}) {
  return (
    <div
      className={`admin-table-wrap${compact ? " admin-table-compact" : ""}`}
      tabIndex={0}
      role="region"
      aria-label={`${label} table`}
    >
      <table className="admin-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={
                  numericColumns.includes(column)
                    ? "admin-cell-number"
                    : undefined
                }
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function AdminCell({
  label,
  children,
  primary = false,
  numeric = false,
}: {
  label: string;
  children: ReactNode;
  primary?: boolean;
  numeric?: boolean;
}) {
  return (
    <td
      className={`${primary ? "admin-cell-primary" : ""} ${numeric ? "admin-cell-number tnum" : ""}`}
    >
      <span className="admin-cell-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </td>
  );
}

import type { TableColumn, TableConfiguration } from "@/types/dashboard";
import type { Message } from "@/types/message";
import { formatToDisplay } from "@/utils/timestamp";

interface ChatInlineTableProps {
  artifact: NonNullable<Message["visualArtifacts"]>[number];
  variant?: "inline" | "modal";
}

type ColumnLike = TableColumn | string;

const isNumericType = (type?: string) =>
  type === "number" || type === "currency" || type === "percentage";

const normalizeColumns = (
  columns: TableConfiguration["columns"],
  firstRow: Record<string, unknown> = {},
): TableColumn[] => {
  if (!Array.isArray(columns)) return [];

  const rowKeys = new Set(Object.keys(firstRow));

  return (columns as ColumnLike[]).map((column) => {
    if (typeof column === "string") {
      return {
        key: column,
        label: column,
        type: "string",
      };
    }

    const rawType = String(column.type || "string").toLowerCase();
    const normalizedType = (
      rawType === "numeric" ? "number" :
      rawType === "text" ? "string" :
      rawType === "temporal" ? "date" :
      rawType === "percent" ? "percentage" :
      rawType
    ) as TableColumn["type"];

    let key = column.key;
    if (!key && "id" in column && rowKeys.has(String(column.id))) {
      key = String(column.id);
    }
    if (!key && rowKeys.has(column.label)) {
      key = column.label;
    }

    return {
      ...column,
      key: key || column.label,
      type: normalizedType,
      align: column.align || (isNumericType(normalizedType) ? "right" : "left"),
    };
  });
};

const formatCellValue = (value: unknown, type: TableColumn["type"]) => {
  if (value === null || value === undefined) return "";

  switch (type) {
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? num.toLocaleString() : String(value);
    }
    case "currency": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return String(value);
      return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    case "percentage": {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? `${num.toFixed(2)}%` : String(value);
    }
    case "date": {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime())
        ? String(value)
        : formatToDisplay(date.toISOString(), { format: "date" });
    }
    case "string":
    default:
      return String(value);
  }
};

export function ChatInlineTable({ artifact, variant = "inline" }: ChatInlineTableProps) {
  const config = artifact.component.component_config as TableConfiguration;
  const rows = Array.isArray(config.data) ? config.data : [];
  const firstRow = rows[0] as Record<string, unknown> | undefined;
  const columns = normalizeColumns(config.columns, firstRow || {});
  const visibleRowCount = Math.min(rows.length, variant === "modal" ? 18 : 8);
  const tableHeight = variant === "modal" ? "h-full" : "h-[326px]";

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-background/60 text-sm text-muted-foreground dark:border-white/10 dark:bg-black/20">
        No table data available
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background/70 dark:border-white/10 dark:bg-black/20 ${tableHeight}`}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10 bg-muted/95 text-muted-foreground backdrop-blur dark:bg-[#202124]/95 dark:text-white/70">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="h-9 whitespace-nowrap border-b border-border px-3 text-left text-xs font-semibold dark:border-white/10"
                  style={{ textAlign: column.align || (isNumericType(column.type) ? "right" : "left") }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="odd:bg-transparent even:bg-muted/25 hover:bg-muted/45 dark:even:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="h-9 max-w-[220px] whitespace-nowrap border-b border-border/70 px-3 text-foreground dark:border-white/10 dark:text-white/85"
                    style={{ textAlign: column.align || (isNumericType(column.type) ? "right" : "left") }}
                    title={formatCellValue(row[column.key], column.type)}
                  >
                    <span className="block truncate">
                      {formatCellValue(row[column.key], column.type)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border px-3 text-xs text-muted-foreground dark:border-white/10">
        <span>
          Showing {visibleRowCount} of {rows.length} rows
        </span>
        {rows.length > visibleRowCount && <span>Scroll for more</span>}
      </div>
    </div>
  );
}

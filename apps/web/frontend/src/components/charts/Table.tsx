import { TableColumn } from "@/types/dashboard";
import { useState, useMemo } from "react";
import { getStyleVariantProps, type ChartStyleVariant } from "@/utils/chartStyling";
import EditableText from "@/components/charts/edit/EditableText";
import { useEditContext } from "@/components/charts/edit/EditContext";
import { formatToDisplay } from "@/utils/timestamp";

interface TopProductsTableProps {
  title: string;
  description?: string;
  columns: TableColumn[];
  data: Record<string, any>[];
  pagination?: Record<string, any>;
  metadata?: Record<string, any>;
  styling?: {
    tile?: { borderColor?: string; borderWidth?: number; borderRadius?: number; background?: string };
    headerBg?: string;
    headerText?: string;
    rowBg?: string;
    rowAltBg?: string;
    borderColor?: string;
    chartStyle?: ChartStyleVariant;
  };
  className?: string;
  style?: React.CSSProperties;
}

const formatCellValue = (value: any, type: TableColumn["type"]) => {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? num.toLocaleString() : String(value);
    }
    case "currency": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return String(value);
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(num);
      } catch (_e) {
        return `$${num.toLocaleString()}`;
      }
    }
    case "percentage": {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? `${num.toFixed(2)}%` : String(value);
    }
    case "date": {
      const d = value instanceof Date ? value : new Date(value);
      return isNaN(d.getTime()) ? String(value) : formatToDisplay(d.toISOString(), { format: "date" });
    }
    case "string":
    default:
      return String(value);
  }
};

/**
 * Parse a raw user-typed string for a numeric-typed column. Strips currency
 * markers and grouping separators; falls back to the raw string if not a
 * finite number.
 */
const parseCellInput = (raw: string, type: TableColumn["type"]) => {
  if (type === "number" || type === "currency" || type === "percentage") {
    const cleaned = raw.replace(/[,\s$€£¥%]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
};

const Table = ({
  title,
  description,
  columns,
  data,
  pagination,
  metadata,
  styling,
  className = "",
  style = {}
}: TopProductsTableProps) => {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 10;

  const hasStructure = Array.isArray(columns) && columns.length > 0;
  const hasData = Array.isArray(data) && data.length > 0;
  const tile = styling?.tile || {};
  const variantProps = getStyleVariantProps(styling?.chartStyle || 'rounded');
  const titleColor = 'var(--title-color)';
  const descriptionColor = 'var(--description-color)';
  const tileStyle = {
    color: titleColor
  } as React.CSSProperties;

  // Sort data
  const sortedData = useMemo(() => {
    if (!hasData) return Array.isArray(data) ? data : [];
    if (!sortConfig) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [data, sortConfig, hasData]);

  // Paginate data
  const paginatedData = useMemo(() => {
    const startIndex = currentPage * pageSize;
    if (!Array.isArray(sortedData)) return [];
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return prev.direction === 'asc'
          ? { key, direction: 'desc' }
          : null;
      }
      return { key, direction: 'asc' };
    });
  };

  const getSortIcon = (key: string) => {
    if (!sortConfig || !key || sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  return (
    <div className={`animate-fade-in h-full ${className}`} style={{ ...tileStyle, ...style, display: 'flex', flexDirection: 'column' }}>
      <div className="mb-4">
        <EditableText as="h3" value={title} path="title" className="text-lg font-semibold mb-1" style={{ color: titleColor }} placeholder="Table title" />
        <EditableText as="p" value={description} path="description" className="text-sm" style={{ color: descriptionColor }} placeholder="Add description" />
      </div>

      {!hasStructure || !hasData ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {!hasStructure ? "No columns provided" : "No data available"}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto">
            <div className="rounded-md border w-max min-w-full" style={{ borderColor: styling?.borderColor || 'var(--element-color)' }}>
              <table className="w-full">
                <thead
                  className="sticky top-0 z-10"
                  style={{
                    backgroundColor: styling?.headerBg || 'var(--table-header-bg, var(--highlight-color))',
                    color: styling?.headerText || 'var(--table-header-text, var(--bg-card-color))'
                  }}
                >
                  <tr>
                    {columns.map((column, colIdx) => (
                      <th
                        key={column.key}
                        className="h-12 px-4 text-left align-middle font-medium cursor-pointer hover:bg-opacity-80 transition-colors first:rounded-tl-md last:rounded-tr-md"
                        style={{ textAlign: column.align || 'left' }}
                        onClick={() => handleSort(column.key)}
                      >
                        <div className="flex items-center gap-2">
                          <EditableTableHeaderLabel
                            value={column.label}
                            colIdx={colIdx}
                            columns={columns}
                          />
                          <span className="text-xs opacity-60">{getSortIcon(column.key)}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.map((row, index) => {
                    const originalIdx = data.indexOf(row);
                    return (
                    <tr
                      key={index}
                      className="animate-slide-up border-b transition-colors hover:bg-opacity-50"
                      style={{
                        animationDelay: `${index * 100}ms`,
                        backgroundColor: index % 2 === 1 ? styling?.rowAltBg : styling?.rowBg || 'transparent',
                        borderBottomColor: 'var(--element-color)',
                        color: descriptionColor
                      }}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className="p-4 align-middle"
                          style={{ textAlign: column.align || 'left' }}
                        >
                          <div className={`${column.key === 'name' ? 'font-medium truncate' : ''}`}>
                            {originalIdx >= 0 ? (
                              <EditableTableCell
                                value={row[column.key]}
                                column={column}
                                rowIdx={originalIdx}
                                data={data}
                              />
                            ) : (
                              formatCellValue(row[column.key], column.type)
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4 mt-auto border-t relative z-10" style={{ borderColor: 'var(--element-color, transparent)' }}>
              <div className="text-muted-foreground flex-1 text-sm">
                Showing {currentPage * pageSize + 1} to{" "}
                {Math.min((currentPage + 1) * pageSize, sortedData.length)} of {sortedData.length} entries
              </div>
              <div className="space-x-2">
                <button
                  type="button"
                  className="px-3 py-1 text-sm border rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  style={{ borderColor: styling?.borderColor || 'var(--element-color)' }}
                  onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                  disabled={currentPage === 0}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="px-3 py-1 text-sm border rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  style={{ borderColor: styling?.borderColor || 'var(--element-color)' }}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                  disabled={currentPage >= totalPages - 1}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * EditableTableCell — emits a FULL-array patch on commit (`{ data: newArray }`)
 * instead of a nested-path patch (`data.X.colKey`). This is required because
 * `deepMerge` replaces arrays wholesale; a sparse-key patch like
 * `{ data: { '2': {...} } }` would type-flip the array into an object and
 * cause the table to render "No data available".
 */
interface EditableTableCellProps {
  value: unknown;
  column: TableColumn;
  rowIdx: number;
  data: Record<string, unknown>[];
}
const EditableTableCell: React.FC<EditableTableCellProps> = ({ value, column, rowIdx, data }) => {
  const ctx = useEditContext();
  // Coerce to the narrow display-value union EditableText accepts.
  const displayValue: string | number | null | undefined =
    value === null || value === undefined
      ? value
      : typeof value === 'number' || typeof value === 'string'
        ? value
        : String(value);
  return (
    <EditableText
      value={displayValue}
      // Path is unused once `onCommit` is supplied, but EditableText's
      // contract still requires it. Keep it informative for debugging.
      path={`data.${rowIdx}.${column.key}`}
      format={(v) => formatCellValue(v, column.type)}
      parse={(raw) => parseCellInput(raw, column.type)}
      onCommit={(parsed) => {
        if (!ctx) return;
        const nextData = data.map((row, i) =>
          i === rowIdx ? { ...row, [column.key]: parsed } : row,
        );
        ctx.applyEdit({ data: nextData });
      }}
    />
  );
};

/**
 * EditableTableHeaderLabel — same full-array contract for column header
 * rename. Patches the entire `columns` array to keep deltas immune to
 * deepMerge's array-replacement rule.
 */
interface EditableTableHeaderLabelProps {
  value: string;
  colIdx: number;
  columns: TableColumn[];
}
const EditableTableHeaderLabel: React.FC<EditableTableHeaderLabelProps> = ({ value, colIdx, columns }) => {
  const ctx = useEditContext();
  return (
    <EditableText
      as="span"
      value={value}
      path={`columns.${colIdx}.label`}
      placeholder="Column"
      onCommit={(parsed) => {
        if (!ctx) return;
        const nextColumns = columns.map((c, i) =>
          i === colIdx ? { ...c, label: String(parsed ?? '') } : c,
        );
        ctx.applyEdit({ columns: nextColumns });
      }}
    />
  );
};

export default Table;



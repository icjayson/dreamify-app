import { TableColumn } from "@/types/dashboard";
import { useState, useMemo } from "react";

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
      return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
    }
    case "string":
    default:
      return String(value);
  }
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
  const titleColor = 'var(--title-color)';
  const descriptionColor = 'var(--description-color)';
  const tileStyle = {
    borderRadius: tile.borderRadius ?? 12,
    backgroundColor: 'var(--bg-card-color)',
    color: titleColor
  } as React.CSSProperties;

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig || !hasData) return data;
    
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
    <div className={`rounded-md animate-fade-in h-full ${className}`} style={{ ...tileStyle, ...style, display: 'flex', flexDirection: 'column' }}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-1" style={{ color: titleColor }}>{title}</h3>
        {description && (
          <p className="text-sm" style={{ color: descriptionColor }}>{description}</p>
        )}
      </div>

      {!hasStructure || !hasData ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {!hasStructure ? "No columns provided" : "No data available"}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="rounded-md border" style={{ borderColor: styling?.borderColor || 'var(--element-color)' }}>
            <table className="w-full">
              <thead 
                className="sticky top-0 z-10"
                style={{ 
                  backgroundColor: styling?.headerBg || 'var(--highlight-color)',
                  color: styling?.headerText || 'var(--bg-card-color)'
                }}
              >
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className="h-12 px-4 text-left align-middle font-medium cursor-pointer hover:bg-opacity-80 transition-colors first:rounded-tl-md last:rounded-tr-md"
                      style={{ textAlign: column.align || 'left' }}
                      onClick={() => handleSort(column.key)}
                    >
                      <div className="flex items-center gap-2">
                        <span>{column.label}</span>
                        <span className="text-xs opacity-60">{getSortIcon(column.key)}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((row, index) => (
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
                          {formatCellValue(row[column.key], column.type)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4">
              <div className="text-muted-foreground flex-1 text-sm">
                Showing {currentPage * pageSize + 1} to{" "}
                {Math.min((currentPage + 1) * pageSize, sortedData.length)} of {sortedData.length} entries
              </div>
              <div className="space-x-2">
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                  disabled={currentPage === 0}
                >
                  Previous
                </button>
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                  disabled={currentPage >= totalPages - 1}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Table;



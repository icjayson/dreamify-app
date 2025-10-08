import { TableColumn } from "@/types/dashboard";

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
  const hasStructure = Array.isArray(columns) && columns.length > 0;
  const hasData = Array.isArray(data) && data.length > 0;
  const tile = styling?.tile || {};
  const textColor = styling?.headerText || 'hsl(220 9% 14%)';
  const tileStyle = {
    borderRadius: tile.borderRadius ?? 12,
    backgroundColor: tile.background || 'hsl(0 0% 100%)',
    color: textColor
  } as React.CSSProperties;

  return (
    <div className={`rounded-md animate-fade-in h-full ${className}`} style={{ ...tileStyle, ...style, display: 'flex', flexDirection: 'column' }}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {!hasStructure || !hasData ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {!hasStructure ? "No columns provided" : "No data available"}
        </div>
      ) : (
        <div className="space-y-3" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div className={`grid gap-2 text-xs font-medium pb-2`} 
               style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
            {columns.map((column) => (
              <span key={column.key} style={{ textAlign: column.align || 'left', color: styling?.headerText || textColor, background: styling?.headerBg }}>
                {column.label}
              </span>
            ))}
          </div>

          {data.map((row, index) => (
            <div 
              key={index} 
              className={`grid gap-2 text-sm py-2 rounded transition-colors animate-slide-up`}
              style={{ 
                gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
                animationDelay: `${index * 100}ms`,
                background: index % 2 === 1 ? styling?.rowAltBg : styling?.rowBg
              }}
            >
              {columns.map((column) => (
                <span 
                  key={column.key} 
                  className={`${column.key === 'name' ? 'font-medium truncate' : ''}`}
                  style={{ textAlign: column.align || 'left', color: 'inherit' }}
                >
                  {formatCellValue(row[column.key], column.type)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Table;



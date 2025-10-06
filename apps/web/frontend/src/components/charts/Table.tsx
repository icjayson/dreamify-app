import { Card } from "@/components/ui/card";
import { TableColumn } from "@/types/dashboard";

interface TopProductsTableProps {
  title: string;
  description?: string;
  columns: TableColumn[];
  data: Record<string, any>[];
  pagination?: Record<string, any>;
  metadata?: Record<string, any>;
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
  className = "",
  style = {}
}: TopProductsTableProps) => {
  const hasStructure = Array.isArray(columns) && columns.length > 0;
  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <Card className={`glass-panel p-6 animate-fade-in ${className}`} style={style}>
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
        <div className="space-y-3">
          <div className={`grid gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border/50`} 
               style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
            {columns.map((column) => (
              <span key={column.key} style={{ textAlign: column.align || 'left' }}>
                {column.label}
              </span>
            ))}
          </div>

          {data.map((row, index) => (
            <div 
              key={index} 
              className={`grid gap-2 text-sm py-2 hover:bg-muted/20 rounded transition-colors animate-slide-up`}
              style={{ 
                gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
                animationDelay: `${index * 100}ms` 
              }}
            >
              {columns.map((column) => (
                <span 
                  key={column.key} 
                  className={`${column.key === 'name' ? 'font-medium truncate' : 'text-muted-foreground'}`}
                  style={{ textAlign: column.align || 'left' }}
                >
                  {formatCellValue(row[column.key], column.type)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default Table;



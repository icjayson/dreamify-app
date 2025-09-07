import { Card } from "@/components/ui/card";

interface TopProductsTableProps {
  title?: string;
  description?: string;
  columns?: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'currency' | 'percentage' | 'date';
    width?: string;
    align?: 'left' | 'center' | 'right';
  }>;
  data?: Record<string, any>[];
  pagination?: Record<string, any>;
  metadata?: Record<string, any>;
  className?: string;
  style?: React.CSSProperties;
}

const TopProductsTable = ({ 
  title = "Top Selling Products",
  description,
  columns = [
    { key: "name", label: "Name", type: "string" as const },
    { key: "price", label: "Price", type: "currency" as const },
    { key: "quantity", label: "Quantity", type: "number" as const },
    { key: "amount", label: "Amount", type: "currency" as const }
  ],
  data = [
    { name: "ASOS Ridley High Waist", price: "$79.49", quantity: 82, amount: "$6,518.18" },
    { name: "Marco Lightweight Shirt", price: "$128.50", quantity: 37, amount: "$4,754.50" },
    { name: "Half Sleeve Shirt", price: "$39.99", quantity: 64, amount: "$2,559.36" },
    { name: "Lightweight Jacket", price: "$20.00", quantity: 184, amount: "$3,680.00" }
  ],
  pagination,
  metadata,
  className = "",
  style = {}
}: TopProductsTableProps) => {
  const products = data;

  return (
    <Card className={`glass-panel p-6 animate-fade-in ${className}`} style={style}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="space-y-3">
        <div className={`grid gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border/50`} 
             style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {columns.map((column) => (
            <span key={column.key} style={{ textAlign: column.align || 'left' }}>
              {column.label}
            </span>
          ))}
        </div>

        {products.map((product, index) => (
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
                {product[column.key]}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
};

export default TopProductsTable;
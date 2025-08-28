import { Card } from "@/components/ui/card";

const TopProductsTable = () => {
  const products = [
    { name: "ASOS Ridley High Waist", price: "$79.49", quantity: 82, amount: "$6,518.18" },
    { name: "Marco Lightweight Shirt", price: "$128.50", quantity: 37, amount: "$4,754.50" },
    { name: "Half Sleeve Shirt", price: "$39.99", quantity: 64, amount: "$2,559.36" },
    { name: "Lightweight Jacket", price: "$20.00", quantity: 184, amount: "$3,680.00" }
  ];

  return (
    <Card className="glass-panel p-6 animate-fade-in">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Top Selling Products</h3>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border/50">
          <span>Name</span>
          <span>Price</span>
          <span>Quantity</span>
          <span>Amount</span>
        </div>

        {products.map((product, index) => (
          <div 
            key={index} 
            className="grid grid-cols-4 gap-2 text-sm py-2 hover:bg-muted/20 rounded transition-colors animate-slide-up"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <span className="font-medium truncate">{product.name}</span>
            <span className="text-muted-foreground">{product.price}</span>
            <span className="text-muted-foreground">{product.quantity}</span>
            <span className="font-medium">{product.amount}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default TopProductsTable;
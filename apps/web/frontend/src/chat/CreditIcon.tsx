import React from "react";
import { Sparkles, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreditIconProps extends LucideProps {
  glow?: boolean;
}

const CreditIcon: React.FC<CreditIconProps> = ({ className, glow = true, ...props }) => {
  return (
    <Sparkles
      className={cn(
        "text-primary shrink-0", 
        glow && "drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]",
        className
      )}
      {...props}
    />
  );
};

export default CreditIcon;

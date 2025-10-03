import React from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

interface DashboardLoadingProps {
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  description?: string;
  durationSec?: number;
}

export default function DashboardLoading({ className = "", style = {} as React.CSSProperties, title = "Changing Theme", description = "Please wait while we update your dashboard...", durationSec = 10 }: DashboardLoadingProps) {
  return (
    <div className={`flex items-center justify-center h-full ${className}`} style={style}>
      <motion.div 
        className="flex flex-col items-center gap-4 p-8 bg-background rounded-lg border border-border shadow-sm"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Loader2 className="h-8 w-8 text-primary" />
        </motion.div>
        
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        
        <motion.div 
          className="w-48 h-1 bg-muted rounded-full overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: durationSec, ease: "linear" }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}
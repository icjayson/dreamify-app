import React from "react";
import { motion } from "framer-motion";
import { Database, Github, Globe, MessageCircle } from "lucide-react";
import { DreamifyMascot } from "@/components/ui/dreamify-mascot";

interface DashboardLoadingProps {
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  description?: string;
  durationSec?: number;
}

const FEATURES = [
  { text: "Connect data sources", icon: Database, faded: true },
  { text: "AI analyzes your data", icon: MessageCircle, faded: false },
  { text: "Generate beautiful dashboards", icon: Globe, faded: false },
  { text: "Deploy instantly", icon: Github, faded: false },
];

export default function DashboardLoading({ className = "", style = {} as React.CSSProperties, title = "Preparing dashboard", description = "Please wait while we update your dashboard...", durationSec = 10 }: DashboardLoadingProps) {
  const [currentFeature, setCurrentFeature] = React.useState(FEATURES[0]);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      const randomIndex = Math.floor(Math.random() * FEATURES.length);
      setCurrentFeature(FEATURES[randomIndex]);
    }, 1500);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className={`flex items-center justify-center h-full ${className}`} style={style}>
      <motion.div
        className="flex flex-col items-center gap-4 p-8 shadow-sm w-80"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative flex items-center justify-center w-24 h-24"
        >
          {/* Spinning ring */}
          <div className="absolute w-24 h-24 rounded-full border-2 border-white/10 border-t-primary animate-spin motion-reduce:animate-none" />
          <DreamifyMascot size="loading" />
        </motion.div>

        {/* Title (no animation) */}
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {/* Random feature display */}
        {/* <div className="w-full mt-2">
           <motion.div
             key={currentFeature.text}
             initial={{ opacity: 0, y: 8 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.3 }}
             className="flex items-center justify-center gap-3 px-3 py-2 w-full text-center"
           >
             <currentFeature.icon className="w-4 h-4 text-primary flex-shrink-0" />
             <span className="text-sm text-foreground truncate">{currentFeature.text}</span>
           </motion.div>
         </div> */}
      </motion.div>
    </div>
  );
}

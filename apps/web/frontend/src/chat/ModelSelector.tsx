import React from "react";
import { Zap, Sparkles, ChevronDown, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import CreditIcon from "./CreditIcon";

interface ModelSelectorProps {
  selectedModel: 'pro' | 'fast';
  onSelect: (model: 'pro' | 'fast') => void;
  creditsRemaining: number;
  isOpen: boolean;
  onToggle: () => void;
  anchor: 'left' | 'right';
  placement?: 'top' | 'bottom';
  variant?: 'classic' | 'compact';
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onSelect,
  creditsRemaining,
  isOpen,
  onToggle,
  anchor = 'right',
  placement = 'bottom',
  variant = 'classic'
}) => {
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`flex items-center gap-2 transition-all duration-300 group h-[34px] ${variant === 'compact'
          ? `px-2.5 py-1.5 rounded-md border text-sm ${isOpen || selectedModel === 'pro'
            ? 'border-primary/60 bg-white/10 text-white'
            : 'border-white/30 text-gray-400 hover:text-white hover:bg-white/5'
          }`
          : `px-3 py-1.5 text-sm button-outline ${selectedModel === 'pro'
            ? 'border-primary/60 bg-primary/20 text-primary-glow shadow-[inset_0_0_12px_rgba(255,255,255,0.1),inset_0_0_20px_hsl(var(--primary)/0.3)]'
            : 'hover:border-primary/60 hover:bg-white/5 text-white/90'
          }`
          } ${isOpen && variant === 'classic' ? 'ring-2 ring-primary/20 border-primary/40' : ''}`}
        title="Select intelligence model"
      >
        <div className="relative flex items-center justify-center">
          {selectedModel === 'fast' ? (
            <Zap className={`w-4 h-4 ${variant === 'compact' && selectedModel === 'fast' && !isOpen ? 'text-gray-400 group-hover:text-white' : ''}`} />
          ) : (
            <Sparkles className="w-4 h-4 text-white animate-pulse-glow" />
          )}
          {selectedModel === 'pro' && (
            <motion.div
              layoutId="pro-glow"
              className="absolute inset-0 bg-primary/30 blur-md rounded-full -z-10"
            />
          )}
        </div>
        <span className="font-medium">{selectedModel === 'fast' ? 'Fast' : 'Pro'}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: placement === 'bottom' ? 10 : -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: placement === 'bottom' ? 5 : -5, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className={`absolute ${placement === 'bottom' ? 'top-full mt-3' : 'bottom-full mb-3'
              } w-64 bg-[#121214]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-20 overflow-hidden ${anchor === 'right' ? 'right-0' : 'left-0'
              }`}
          >
            <div className="p-2 space-y-1">
              <button
                onClick={() => { onSelect('fast'); }}
                className={`w-full p-2 text-left rounded-xl transition-all duration-200 group flex items-start gap-3 ${selectedModel === 'fast' ? 'bg-white/10 ring-1 ring-white/10 shadow-[inset_-2px_-2px_8px_rgba(255,255,255,0.05)]' : 'hover:bg-white/5 opacity-60 hover:opacity-100'}`}
              >
                <div className={`p-2 rounded-lg ${selectedModel === 'fast' ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/40 group-hover:text-white/60'}`}>
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">Fast Mode</span>
                    <div className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/5 text-white/60">
                      <span>5</span>
                      <Sparkles className="w-2.5 h-2.5" />
                    </div>
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">Optimized for speed & daily tasks</p>
                </div>
                {selectedModel === 'fast' && (
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-1" />
                )}
              </button>

              <button
                onClick={() => { onSelect('pro'); }}
                className={`w-full p-2 text-left rounded-xl transition-all duration-200 group flex items-start gap-3 ${selectedModel === 'pro' ? 'bg-primary/20 ring-1 ring-primary/30 shadow-[inset_-2px_-2px_8px_hsl(var(--primary)/0.15)]' : 'hover:bg-white/5 opacity-60 hover:opacity-100'}`}
              >
                <div className={`p-2 rounded-lg ${selectedModel === 'pro' ? 'bg-primary/30 text-primary-glow' : 'bg-white/5 text-white/40 group-hover:text-white/60'}`}>
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">Pro Mode</span>
                    <div className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/20 text-primary-glow">
                      <span>10</span>
                      <Sparkles className="w-2.5 h-2.5" />
                    </div>
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">Deep reasoning & complex tasks</p>
                </div>
                {selectedModel === 'pro' && (
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-1" />
                )}
              </button>
            </div>

            <div className="mt-2 border-t border-white/5 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CreditIcon className="w-3.5 h-3.5" glow={false} />
                  <span className="text-xs text-white/60">Credit Balance</span>
                </div>
                <span className="text-xs font-bold text-white">{creditsRemaining} <span className="text-white/30 font-normal">/ 100</span></span>
              </div>
              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(creditsRemaining / 100) * 100}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full rounded-full ${creditsRemaining < 20 ? 'bg-red-500' : 'bg-primary'}`}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ModelSelector;

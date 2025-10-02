import React, { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';

interface RecordingBarSidebarProps {
  isVisible: boolean;
  detectedLanguage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const RecordingBarSidebar: React.FC<RecordingBarSidebarProps> = ({
  isVisible,
  detectedLanguage,
  onCancel,
  onConfirm
}) => {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isVisible) {
      setDuration(0);
      interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isVisible]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isVisible) return null;

  return (
    <div className="w-full mb-3 z-50 flex justify-center">
      <div className="flex items-center justify-between px-3 py-2 w-full max-w-full bg-background/80 backdrop-blur-sm border border-border/30 rounded-lg">
        {/* Compact layout for sidebar */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Duration */}
          <span className="text-xs font-mono text-primary whitespace-nowrap">
            {formatDuration(duration)}
          </span>
          
          {/* Language */}
          {detectedLanguage && (
            <span className="text-xs text-white/70 whitespace-nowrap">
              ({detectedLanguage})
            </span>
          )}
          
          {/* Waveform - simplified for sidebar */}
          <div className="flex items-end gap-0.5 flex-1 justify-center">
            {Array.from({ length: 6 }, (_, i) => (
              <div 
                key={i} 
                className="w-0.5 bg-primary rounded-full"
                style={{ 
                  animationDelay: `${i * 100}ms`,
                  height: `${Math.random() * 8 + 4}px`,
                  animation: 'waveform 1s ease-in-out infinite alternate'
                }}
              />
            ))}
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-2">
          <button 
            onClick={onCancel}
            className="w-6 h-6 rounded-full bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center transition-colors"
            aria-label="Cancel recording"
          >
            <X className="w-3 h-3 text-red-400" />
          </button>
          <button 
            onClick={onConfirm}
            className="w-6 h-6 rounded-full bg-green-500/20 hover:bg-green-500/30 flex items-center justify-center transition-colors"
            aria-label="Confirm recording"
          >
            <Check className="w-3 h-3 text-green-400" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecordingBarSidebar;

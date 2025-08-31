import React, { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';

interface RecordingBarProps {
  isVisible: boolean;
  detectedLanguage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const RecordingBar: React.FC<RecordingBarProps> = ({
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
    <div className="recording-bar-container">
      <div className="recording-bar">
        {/* Dotted line */}
        <div className="recording-dots">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} className="recording-dot" />
          ))}
        </div>
        
        {/* Waveform visualization */}
        <div className="waveform-container">
          {Array.from({ length: 8 }, (_, i) => (
            <div 
              key={i} 
              className="waveform-bar"
              style={{ 
                animationDelay: `${i * 50}ms`,
                height: `${Math.random() * 15 + 5}px`
              }}
            />
          ))}
        </div>
        
        {/* Duration and language info */}
        <div className="recording-info">
          <span className="recording-duration">{formatDuration(duration)}</span>
          {detectedLanguage && (
            <span className="detected-language">({detectedLanguage})</span>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="recording-actions">
          <button 
            onClick={onCancel}
            className="recording-button recording-cancel"
            aria-label="Cancel recording"
          >
            <X className="w-3 h-3" />
          </button>
          <button 
            onClick={onConfirm}
            className="recording-button recording-confirm"
            aria-label="Confirm recording"
          >
            <Check className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecordingBar;
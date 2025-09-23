import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRotatingText } from "@/hooks/useRotatingText";
import { Link as LinkIcon } from "lucide-react";
import { CONNECTORS } from "@/constants/connectors";
import { useChatStore } from "@/stores/useChatStore";

interface BlankStateProps {
  subtexts: string[];
  intervalMs?: number;
  onWatchTutorial?: () => void;
  onUploadData?: () => void;
  onConnectDataSource?: () => void;
  onUseSample?: () => void;
  className?: string;
}

const BlankState: React.FC<BlankStateProps> = ({
  subtexts,
  intervalMs = 3500,
  onWatchTutorial,
  onUploadData,
  onConnectDataSource,
  onUseSample,
  className = "",
}) => {
  const texts = useMemo(() => Array.isArray(subtexts) ? subtexts.filter(Boolean) : [], [subtexts]);
  const { activeIndex, typedText, isTyping, isAnimating, pause, resume } = useRotatingText(texts, intervalMs);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpen]);

  const selectConnector = (name: string) => {
    try {
      useChatStore.getState().setSelectedDataSource(name);
      useChatStore.getState().setDropdownOpen(true);
      const el = document.querySelector('[data-chat-root]');
      if (el && 'scrollIntoView' in el) {
        (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (_e) {}
    setMenuOpen(false);
  };

  return (
    <div className={`h-full flex items-center justify-center ${className}`}>
      <div
        role="region"
        aria-labelledby="blankstate-title"
        className="max-w-lg w-full mx-4 p-6 text-center"
        onMouseEnter={resume}
        onMouseLeave={resume}
        onFocusCapture={resume}
        onBlurCapture={resume}
      >
        <img src="/logo-main.png" alt="Dreamify" className="w-10 h-10 mx-auto mb-3 rounded" />
        <h2 id="blankstate-title" className="text-lg font-semibold mb-2">Get Started with Nyx</h2>

        <div
          aria-live="polite"
          className="min-h-[2rem] mb-3 text-sm text-muted-foreground font-mono"
          onMouseEnter={resume}
          onMouseLeave={resume}
          onFocus={resume}
          onBlur={resume}
        >
          <span className="inline-block">
            {typedText}
            <span className={`ml-0.5 inline-block w-[1ch] ${isTyping ? 'opacity-100' : 'opacity-0'} animate-pulse`}>│</span>
          </span>
        </div>

        <div className="flex items-center justify-center gap-2 mb-3">
          {onUploadData && (
            <button onClick={onUploadData} className="button-gradient h-9 px-4 rounded-md text-sm text-white flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12l7-7 7 7" /><path d="M19 19H5" /></svg>
              Upload CSV
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="button-outline h-9 px-4 rounded-md text-sm border border-border/50 hover:bg-muted/50 transition flex items-center gap-2"
            >
              <LinkIcon className="h-4 w-4" />
              Connect data source
            </button>
            {menuOpen && (
              <div role="menu" className="absolute mt-1 left-0 w-56 bg-background/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg z-20">
                <div className="py-1">
                  {CONNECTORS.map((connector) => (
                    <button
                      role="menuitem"
                      key={connector.name}
                      onClick={() => selectConnector(connector.name)}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-muted/50"
                    >
                      <img src={connector.icon} alt={connector.name} className="w-4 h-4 object-cover" />
                      {connector.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlankState;



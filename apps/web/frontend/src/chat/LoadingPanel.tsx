import React from "react";

type LoadingPanelProps = {
  isActive: boolean;
  stopSignal: boolean;
  mode?: "dashboard" | "text";
};

const ACTIONS: string[] = [
  "Thinking...",
  "Analyzing data...",
  "Processing insights...",
  "Reading CSV...",
  "Detecting patterns...",
  "Calculating metrics...",
  "Designing charts...",
  "Optimizing layout...",
  "Adding animations...",
  "Structuring components...",
  "Applying themes...",
  "Testing responsiveness...",
  "Building dashboard...",
  "Finalizing...",
  "Almost ready...",
];

export default function LoadingPanel({ isActive, stopSignal, mode = "dashboard" }: LoadingPanelProps) {
  // Text-only: render nothing until activated
  const successText = mode === "dashboard" ? "Successfully created dashboard." : "Successfully generated insights.";
  const [lines, setLines] = React.useState<string[]>([]);
  const [idx, setIdx] = React.useState(0);
  const [started, setStarted] = React.useState(false);
  const [stopped, setStopped] = React.useState(false);

  // Start when becoming active the first time
  React.useEffect(() => {
    if (!started && isActive) {
      setStarted(true);
      setStopped(false);
      setLines([]);
      setIdx(0);
    }
  }, [isActive, started]);

  React.useEffect(() => {
    if (!started || stopped) return;
    const interval = setInterval(() => {
      setLines((prev) => {
        const next = [...prev, ACTIONS[idx]];
        return next.slice(-8);
      });
      setIdx((p) => (p + 1) % ACTIONS.length);
    }, 2400);
    return () => clearInterval(interval);
  }, [started, idx, stopped]);

  React.useEffect(() => {
    if (started && !stopped && stopSignal) {
      setStopped(true);
      setLines((prev) => [...prev, successText].slice(-8));
    }
  }, [stopSignal, started, stopped, successText]);

  // Render nothing until started
  if (!started && lines.length === 0) return null;

  // Text-only log, no background or borders
  return (
    <div className="space-y-1 text-white">
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1 && !stopped;
        return (
          <div
            key={`${i}-${line}`}
            className={`text-sm animate-fade-in-300 ${isLast ? "active-breathing text-gradient-sweep caret" : "text-white/90"}`}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}



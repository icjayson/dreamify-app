import { useEffect, useMemo, useRef, useState } from "react";

// intervalMs here is treated as the hold duration after a line finishes typing
export function useRotatingText(subtexts: string[], intervalMs: number = 3500) {
  const safeSubtexts = Array.isArray(subtexts) ? subtexts : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isAnimating, setIsAnimating] = useState(true);
  const intervalRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const [typedText, setTypedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_e) {
      return false;
    }
  }, []);

  const clearExistingInterval = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const clearTypingTimers = () => {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (holdTimeoutRef.current) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    // Reset index if subtexts changed and index is out of bounds
    if (activeIndex >= safeSubtexts.length) {
      setActiveIndex(0);
    }
  }, [safeSubtexts.length]);

  // Typing effect
  useEffect(() => {
    clearExistingInterval();
    clearTypingTimers();

    const current = safeSubtexts[activeIndex] ?? "";

    if (reducedMotion) {
      setTypedText(current);
      setIsTyping(false);
      setIsAnimating(false);
      return;
    }

    if (isPaused) {
      return;
    }

    setTypedText("");
    setIsTyping(true);
    setIsAnimating(true);

    const typingSpeedMs = 40; // per character
    const typeChar = (i: number) => {
      if (i > current.length) {
        setIsTyping(false);
        holdTimeoutRef.current = window.setTimeout(() => {
          setActiveIndex((prev) => (prev + 1) % safeSubtexts.length);
        }, Math.max(500, intervalMs));
        return;
      }
      setTypedText(current.slice(0, i));
      typingTimeoutRef.current = window.setTimeout(() => typeChar(i + 1), typingSpeedMs);
    };

    typeChar(1);

    return () => {
      clearExistingInterval();
      clearTypingTimers();
    };
  }, [activeIndex, reducedMotion, isPaused, safeSubtexts, intervalMs]);

  useEffect(() => {
    return () => {
      clearExistingInterval();
      clearTypingTimers();
    };
  }, []);

  const pause = () => setIsPaused(true);
  const resume = () => setIsPaused(false);

  // Pointer events no longer pause; pause only via hover/focus handlers

  const activeText = safeSubtexts[activeIndex] ?? "";

  return { activeIndex, activeText, typedText, isTyping, isAnimating, pause, resume } as const;
}



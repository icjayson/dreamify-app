import { useState, useEffect } from "react";

export type LayoutStyle = "minimalism" | "aesthetic";

const STORAGE_KEY = "dreamify-layout-style";

// Module-level singleton — survives re-renders, shared across all hook instances
let moduleLayoutStyle: LayoutStyle =
  typeof window !== "undefined"
    ? ((localStorage.getItem(STORAGE_KEY) as LayoutStyle) ?? "minimalism")
    : "minimalism";

const subscribers = new Set<() => void>();

function applyLayoutStyle(next: LayoutStyle) {
  moduleLayoutStyle = next;
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, next);
  }
  subscribers.forEach((fn) => fn());
}

export function useLayoutStyle(): [LayoutStyle, (s: LayoutStyle) => void] {
  const [, rerender] = useState(0);

  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }, []);

  return [moduleLayoutStyle, applyLayoutStyle];
}

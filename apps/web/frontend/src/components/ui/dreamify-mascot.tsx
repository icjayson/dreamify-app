import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type DreamifyMascotSize = "sm" | "md" | "loading";
type DreamifyMascotTone = "default" | "softAzure";

interface DreamifyMascotProps {
  size?: DreamifyMascotSize;
  tone?: DreamifyMascotTone;
  className?: string;
}

const sizeClasses: Record<DreamifyMascotSize, string> = {
  sm: "h-10 w-10 sm:h-11 sm:w-11",
  md: "h-11 w-11 sm:h-12 sm:w-12 md:h-14 md:w-14",
  loading: "h-16 w-16",
};

const toneClasses: Record<DreamifyMascotTone, string> = {
  default: "",
  softAzure: "dreamify-mascot--soft-azure",
};

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updatePreference);
      return () => mediaQuery.removeEventListener("change", updatePreference);
    }

    mediaQuery.addListener(updatePreference);
    return () => mediaQuery.removeListener(updatePreference);
  }, []);

  return prefersReducedMotion;
}

export function DreamifyMascot({
  size = "md",
  tone = "softAzure",
  className,
}: DreamifyMascotProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const sharedClassName = cn(
    "block select-none object-contain",
    sizeClasses[size],
    toneClasses[tone],
    className,
  );

  if (prefersReducedMotion) {
    return (
      <img
        src="/logo-watermark.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className={sharedClassName}
      />
    );
  }

  return (
    <video
      src="/dreamify-mascot-1.webm"
      autoPlay
      loop
      muted
      playsInline
      aria-hidden="true"
      className={sharedClassName}
    />
  );
}

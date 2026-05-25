import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

interface ProductPreviewMediaProps {
  lightSrc: string;
  darkSrc: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  showBackground?: boolean;
}

export default function ProductPreviewMedia({
  lightSrc,
  darkSrc,
  alt,
  className,
  imageClassName,
  showBackground = true,
}: ProductPreviewMediaProps) {
  const { resolvedTheme } = useTheme();
  const src = resolvedTheme === "dark" ? darkSrc : lightSrc;

  return (
    <div
      className={cn(
        "relative flex h-full min-h-[340px] w-full items-center justify-center overflow-hidden border-t border-border/40 p-4 md:min-h-full md:border-l md:border-t-0 md:p-6",
        className
      )}
    >
      {showBackground && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_20%,hsl(var(--primary)/0.18),transparent_55%),radial-gradient(120%_80%_at_20%_85%,hsl(var(--accent)/0.16),transparent_55%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-20 animate-pulse-glow bg-[radial-gradient(50%_50%_at_50%_50%,hsl(var(--primary)/0.12),transparent_70%)]"
          />
        </>
      )}

      <div className="relative w-full animate-scale-in">
        <div className="animate-float">
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-[0_32px_120px_-44px_hsl(var(--primary)/0.55)] ring-1 ring-foreground/5 backdrop-blur-sm">
            <img
              key={src}
              src={src}
              alt={alt}
              loading="eager"
              draggable={false}
              className={cn(
                "block h-auto w-full select-none object-cover animate-fade-in",
                imageClassName
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

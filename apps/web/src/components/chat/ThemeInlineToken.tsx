import { LayoutTemplate, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { CHART_THEME_COLORS, type ChartPresetTheme } from "@/utils/chartStyling";

export interface ThemeInlineTokenTheme {
  id: string;
  title: string;
  description?: string;
  category?: string;
  suggestedTheme?: string;
  analysisFocusId?: string;
  analysisFocusName?: string;
}

interface ThemeInlineTokenProps {
  theme: ThemeInlineTokenTheme;
  onRemove?: () => void;
  className?: string;
  variant?: "message" | "composer";
}

export function ThemeInlineToken({
  theme,
  onRemove,
  className,
  variant = "message",
}: ThemeInlineTokenProps) {
  const themeId = (theme.suggestedTheme || theme.id || "default") as ChartPresetTheme;
  const colors = CHART_THEME_COLORS[themeId] ?? CHART_THEME_COLORS.default;
  const palette = [
    colors["highlight-color"],
    ...(colors["data-colors"] ?? []),
  ].slice(0, 3);
  const label = theme.title || "Selected theme";
  const title = theme.analysisFocusName
    ? `Theme: ${label} · Focus: ${theme.analysisFocusName}`
    : `Theme: ${label}`;

  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-md border border-border/80 bg-muted/70 px-1.5 text-[12px] font-medium leading-none text-foreground align-baseline shadow-sm",
        "dark:border-white/15 dark:bg-white/10 dark:text-white/90",
        variant === "composer" && "bg-background/80 dark:bg-white/[0.08]",
        className,
      )}
      title={title}
      aria-label={title}
    >
      <span
        className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border border-border/70 bg-background/80 dark:border-white/10 dark:bg-black/20"
        aria-hidden="true"
      >
        <LayoutTemplate className="h-3 w-3 text-accent" />
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          variant === "composer" ? "max-w-[9rem] sm:max-w-[12rem]" : "max-w-[8.5rem] sm:max-w-[11rem]",
        )}
      >
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
        {palette.map((color, index) => (
          <span
            key={`${color}-${index}`}
            className="h-1.5 w-1.5 rounded-full ring-1 ring-background/70 dark:ring-black/40"
            style={{ backgroundColor: color }}
          />
        ))}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Remove theme"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

import { AlertCircle, Database, FileText, Sparkles, X } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getCompactDataContextLabel,
  getDataContextLabelWithVersion,
  getDataContextSourceLabel,
  getDataContextTooltip,
  normalizeConnectorSource,
  type DataContextTokenSource,
  type DataContextTokenStatus,
} from "@/utils/dataContextTokens";

interface DataContextInlineTokenProps {
  source: DataContextTokenSource;
  status?: DataContextTokenStatus;
  uploadProgress?: number;
  onRemove?: () => void;
  onOpen?: () => void;
  className?: string;
  variant?: "message" | "composer";
}

export function DataContextInlineToken({
  source,
  status,
  uploadProgress,
  onRemove,
  onOpen,
  className,
  variant = "message",
}: DataContextInlineTokenProps) {
  const connector = normalizeConnectorSource(source.sourceType);
  const resolvedStatus: DataContextTokenStatus = source.schemaOnly
    ? "schemaOnly"
    : status || source.status || "uploaded";
  const isUploading = resolvedStatus === "uploading";
  const isActive = resolvedStatus === "processing" || resolvedStatus === "accepted";
  const isSchemaOnly = resolvedStatus === "schemaOnly";
  const isError = resolvedStatus === "error";
  const progress = Math.max(0, Math.min(100, Math.round(uploadProgress ?? source.uploadProgress ?? 0)));
  const sourceLabel = getDataContextSourceLabel(source);
  const contextLabel = getDataContextLabelWithVersion(source);
  const displayContextLabel = variant === "message"
    ? getCompactDataContextLabel(source)
    : contextLabel;
  const tooltip = getDataContextTooltip(source);
  const canOpen = Boolean(onOpen);

  const token = (
    <span
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "relative inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 overflow-hidden rounded-md border px-1.5 text-[12px] font-medium leading-none align-baseline shadow-sm outline-none",
        "border-border/80 bg-background/80 text-foreground dark:border-white/15 dark:bg-white/[0.08] dark:text-white/90",
        variant === "message" && "bg-muted/70 dark:bg-white/10",
        isUploading && "border-emerald-500/35 bg-emerald-500/10 dark:bg-emerald-500/[0.12]",
        isActive && "border-accent/35 bg-accent/10",
        isSchemaOnly && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        isError && "border-destructive/40 bg-destructive/10 text-destructive",
        canOpen && "cursor-pointer hover:bg-muted dark:hover:bg-white/15",
        className,
      )}
      aria-label={tooltip}
      title={tooltip}
    >
      {isUploading && (
        <span
          className="absolute bottom-0 left-0 h-0.5 bg-emerald-500 transition-all duration-200"
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border border-border/70 bg-background/80 dark:border-white/10 dark:bg-black/20",
          connector?.iconBg,
        )}
        aria-hidden="true"
      >
        {connector?.icon ? (
          <img
            src={connector.icon}
            alt=""
            className={cn("h-3.5 w-3.5 object-contain", connector.name === "TikTok Ads" && "scale-125")}
          />
        ) : source.sourceType === "Multiple" ? (
          <Database className="h-3 w-3 text-emerald-500" />
        ) : isActive ? (
          <Sparkles className="h-3 w-3 animate-pulse text-accent" />
        ) : (
          <FileText className="h-3 w-3 text-muted-foreground dark:text-white/70" />
        )}
      </span>
      <span className="shrink-0 font-semibold">{sourceLabel}</span>
      <span className="shrink-0 text-muted-foreground/35">•</span>
      <span
        className={cn(
          "min-w-0 truncate text-muted-foreground dark:text-white/55",
          variant === "message" ? "max-w-[6.5rem] sm:max-w-[8.5rem]" : "max-w-[9rem] sm:max-w-[13rem]",
        )}
      >
        {displayContextLabel}
      </span>
      {isUploading && (
        <span className="shrink-0 text-[10px] tabular-nums text-emerald-700 dark:text-emerald-300">
          {progress}%
        </span>
      )}
      {isActive && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse" aria-hidden="true" />
      )}
      {isSchemaOnly && <AlertCircle className="h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Remove data source"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{token}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="max-w-[260px] bg-popover text-xs text-popover-foreground border border-border shadow-lg break-words"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

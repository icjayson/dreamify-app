import { useRef, useState } from "react";
import { Download, Maximize2, Table2, BarChart3, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { exportChartAsPng } from "@/utils/exportUtils";
import type { Message } from "@/types/message";
import { ChatInlineTable } from "@/components/chat/ChatInlineTable";
import { ChatInlineChart } from "@/components/chat/ChatInlineChart";

interface ChatVisualArtifactProps {
  artifact: NonNullable<Message["visualArtifacts"]>[number];
  isSidePanelOpen?: boolean;
}

export function ChatVisualArtifact({ artifact, isSidePanelOpen = false }: ChatVisualArtifactProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const Icon = artifact.kind === "table" ? Table2 : BarChart3;
  const isTable = artifact.kind === "table";
  const inlineWidthClass = isSidePanelOpen ? "max-w-full" : "max-w-[720px]";

  const handleExport = async (target: "card" | "modal" = "card") => {
    const element = target === "modal" ? modalRef.current : cardRef.current;
    if (!element) return;

    setIsExporting(true);
    try {
      await exportChartAsPng(element, artifact.title || artifact.kind);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <div
        ref={cardRef}
        className={`group/visual mt-3 w-full ${inlineWidthClass} overflow-hidden rounded-xl border border-border bg-card shadow-sm dark:border-white/10 dark:bg-white/[0.03]`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-300">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground dark:text-white">
                {artifact.title}
              </div>
              <div className="text-xs capitalize text-muted-foreground">
                {artifact.kind}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsOpen(true)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="View larger"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">View larger</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => handleExport("card")}
                  disabled={isExporting}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Download PNG"
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Download PNG</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className={`${isTable ? "h-[350px] p-2" : "h-[292px] p-2"} min-h-0`}>
          {isTable ? (
            <ChatInlineTable artifact={artifact} />
          ) : (
            <ChatInlineChart artifact={artifact} compact={isSidePanelOpen} />
          )}
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[min(96vw,1100px)] border-border bg-background p-0 text-foreground dark:border-white/15 dark:bg-[#18181A] dark:text-white">
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-300">
                <Icon className="h-4 w-4" />
              </div>
              <DialogTitle className="truncate text-base font-semibold">
                {artifact.title}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-1 pr-8">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleExport("modal")}
                disabled={isExporting}
                aria-label="Download PNG"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div ref={modalRef} className="h-[min(72vh,680px)] min-h-[420px] p-4">
            {isTable ? (
              <ChatInlineTable artifact={artifact} variant="modal" />
            ) : (
              <ChatInlineChart artifact={artifact} variant="modal" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

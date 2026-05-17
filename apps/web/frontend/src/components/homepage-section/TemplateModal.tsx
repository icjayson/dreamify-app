import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  ANALYSIS_FOCUSES,
  VISUAL_THEMES,
  createThemeSelection,
  type AnalysisFocusId,
  type ThemeSelection,
} from "@/constants/builtinTemplates";
import TemplateColorPreview from "@/components/templates/TemplateColorPreview";
import type { ChartPresetTheme } from "@/utils/chartStyling";

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onTemplateSelect: (template: ThemeSelection) => void;
  initialSelection?: ThemeSelection | null;
  /** 'toolbar' = pre-run pick from chat input; 'header' = restyle current dashboard */
  source?: "toolbar" | "header";
}

const TemplateModal: React.FC<TemplateModalProps> = ({ open, onClose, onTemplateSelect, initialSelection, source = "toolbar" }) => {
  const isHeader = source === "header";
  const copy = {
    title: isHeader ? "Apply a Theme" : "Choose Theme",
    subtitle: isHeader
      ? "Instantly restyle your current dashboard"
      : "Pick the dashboard look, then optionally guide the analysis",
    btnSelect: isHeader ? "Apply to dashboard" : "Use for next run",
    btnUnselect: isHeader ? "Remove" : "Unselect",
    confirmEmpty: "Pick a theme first",
    confirmActive: (name: string) => isHeader ? `Apply ${name}` : `Use ${name} for Next Run`,
  };

  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const startYRef = useRef<number | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState<ChartPresetTheme | null>(null);
  const [selectedFocusId, setSelectedFocusId] = useState<AnalysisFocusId>("auto");
  const [isDesktop, setIsDesktop] = useState<boolean>(false);

  useEffect(() => {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 640px)") : null;
    const update = () => setIsDesktop(!!mq && mq.matches);
    const legacyMq = mq as (MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    }) | null;
    update();
    if (mq) {
      try {
        mq.addEventListener("change", update);
      } catch {
        legacyMq?.addListener?.(update);
      }
    }
    return () => {
      if (mq) {
        try {
          mq.removeEventListener("change", update);
        } catch {
          legacyMq?.removeListener?.(update);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      setDragY(0);
      setSelectedThemeId(initialSelection?.suggestedTheme ?? initialSelection?.id ?? null);
      setSelectedFocusId((initialSelection?.analysisFocusId as AnalysisFocusId | undefined) ?? "auto");
    } else {
      setDragY(0);
    }
  }, [initialSelection, open]);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || startYRef.current == null) return;
    const delta = e.clientY - startYRef.current;
    setDragY(delta > 0 ? delta : 0);
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragY > 100) onClose();
    setDragY(0);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const handleThemeClick = (themeId: ChartPresetTheme) => {
    setSelectedThemeId((current) => current === themeId ? null : themeId);
  };

  const handleConfirmClick = () => {
    if (!selectedThemeId) return;
    const selection = createThemeSelection(selectedThemeId, isHeader ? null : selectedFocusId);
    if (!selection) return;
    onTemplateSelect(selection);
    onClose();
  };

  const selectedTheme = VISUAL_THEMES.find((theme) => theme.id === selectedThemeId);
  const focusChips = ANALYSIS_FOCUSES;

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const renderFocusChips = () => !isHeader && (
    <div className="border-b border-border px-4 py-3 sm:px-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Analysis Focus</p>
        <p className="text-xs text-muted-foreground">Optional</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {focusChips.map((focus) => {
          const active = selectedFocusId === focus.id;
          return (
            <button
              key={focus.id}
              onClick={() => setSelectedFocusId(focus.id)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
              type="button"
            >
              {active && <Check className="h-3 w-3" />}
              {focus.short_name}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderThemeGrid = (compact = false) => (
    <div className={`grid grid-cols-1 gap-4 ${compact ? "" : "md:grid-cols-2 lg:grid-cols-3"}`}>
      {VISUAL_THEMES.map((theme) => {
        const isSelected = selectedThemeId === theme.id;
        return (
          <div
            key={theme.id}
            onClick={() => handleThemeClick(theme.id)}
            className={`group relative aspect-video cursor-pointer overflow-hidden rounded-xl transition-all duration-300 hover:scale-[1.02] ${
              isSelected ? "ring-2 ring-primary" : ""
            }`}
          >
            <TemplateColorPreview theme={theme.id} className="h-full w-full" />

            {isSelected && (
              <div className="absolute left-4 top-4 z-20 flex items-center gap-1 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-semibold text-foreground shadow-md dark:bg-muted dark:text-white">
                <Check className="h-3 w-3 text-primary" />
                Selected
              </div>
            )}

            <div className="absolute inset-0 flex flex-col justify-between bg-black/60 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <div className="flex justify-end">
                {isSelected ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedThemeId(null);
                    }}
                    className="button-outline rounded-md border-white/40 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
                    type="button"
                  >
                    {copy.btnUnselect}
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleThemeClick(theme.id);
                    }}
                    className="button-gradient rounded-md px-3 py-1.5 text-xs font-medium"
                    type="button"
                  >
                    {copy.btnSelect}
                  </button>
                )}
              </div>

              <div>
                <h3 className="mb-1 text-sm font-semibold text-white">{theme.name}</h3>
                <p className="line-clamp-2 text-xs text-white/70">{theme.description}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return createPortal(
    <>
      {open && !isDesktop && (
        <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
          <SheetContent side="bottom" className="z-[520] h-[80vh] w-full overflow-hidden rounded-t-2xl border-t border-border bg-muted p-0 sm:hidden">
            <div
              className="flex w-full cursor-grab select-none justify-center pb-1 pt-2 active:cursor-grabbing"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
            >
              <div className="h-1.5 w-12 rounded-full bg-white/20" />
            </div>
            <div style={{ transform: `translateY(${dragY}px)`, transition: draggingRef.current ? "none" : "transform 200ms ease" }}>
              <div className="relative z-10 flex h-[calc(80vh-20px)] w-full flex-col overflow-hidden bg-muted">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-xl font-semibold text-foreground dark:text-white">{copy.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground dark:text-white/70">{copy.subtitle}</p>
                </div>
                {renderFocusChips()}

                <div className="relative flex-1" style={{ height: "calc(80vh - 210px)" }}>
                  <div className="absolute inset-0 overflow-y-auto p-4">
                    {renderThemeGrid(true)}
                  </div>
                </div>

                <div className="flex-shrink-0 border-t border-border bg-muted/50 px-4 py-4">
                  <div className="flex justify-end">
                    <button
                      onClick={handleConfirmClick}
                      disabled={!selectedThemeId}
                      className="button-gradient rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                    >
                      {selectedTheme ? copy.confirmActive(selectedTheme.name) : copy.confirmEmpty}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      <div className="fixed inset-0 z-[520] hidden items-center justify-center p-4 sm:flex">
        <div className="fixed inset-0 hidden bg-black/80 sm:block" onClick={onClose} />
        <div className="relative z-10 h-[80vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-muted shadow-xl">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 rounded-md p-2 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:text-white/70 dark:hover:bg-black dark:hover:text-white"
            type="button"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="border-b border-border px-6 py-4">
            <h2 className="text-2xl font-semibold text-foreground dark:text-white">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground dark:text-white/70">{copy.subtitle}</p>
          </div>
          {renderFocusChips()}

          <div className="relative flex-1" style={{ height: isHeader ? "calc(80vh - 160px)" : "calc(80vh - 230px)" }}>
            <div className="absolute inset-0 overflow-y-auto p-6">
              {renderThemeGrid()}
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-border bg-muted/50 px-6 py-4">
            <div className="flex justify-end">
              <button
                onClick={handleConfirmClick}
                disabled={!selectedThemeId}
                className="button-gradient rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
              >
                {selectedTheme ? copy.confirmActive(selectedTheme.name) : copy.confirmEmpty}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default TemplateModal;

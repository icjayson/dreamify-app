import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import ProductPreviewMedia from "@/components/workspace/ProductPreviewMedia";
import {
  FEATURE_ICONS,
  PREVIEW_SOURCES,
  WORKSPACE_NEWS_ITEMS,
} from "@/components/workspace/workspaceNewsContent";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, X } from "lucide-react";

interface OnboardingModalProps {
  open: boolean;
  onDismiss: () => void;
}

export default function OnboardingModal({ open, onDismiss }: OnboardingModalProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeItem = WORKSPACE_NEWS_ITEMS[activeIndex];
  const preview = PREVIEW_SOURCES[activeItem.id];
  const ActiveIcon = FEATURE_ICONS[activeItem.id];
  const isLast = activeIndex === WORKSPACE_NEWS_ITEMS.length - 1;
  const progressPercent = ((activeIndex + 1) / WORKSPACE_NEWS_ITEMS.length) * 100;

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
    }
  }, [open]);

  if (!open) return null;

  const handlePrevious = () => {
    setActiveIndex((prev) => Math.max(prev - 1, 0));
  };

  const handleNext = () => {
    if (isLast) {
      onDismiss();
      return;
    }
    setActiveIndex((prev) => Math.min(prev + 1, WORKSPACE_NEWS_ITEMS.length - 1));
  };

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-3 sm:p-5">
      <div
        className="absolute inset-0 animate-fade-in bg-background/30 backdrop-blur-md dark:bg-black/75"
        onClick={onDismiss}
      />

      <div className="relative z-[241] w-full max-w-[980px] animate-scale-in overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_40px_140px_-48px_hsl(var(--primary)/0.55)] ring-1 ring-foreground/5">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close onboarding"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid max-h-[calc(100vh-32px)] grid-cols-1 overflow-y-auto md:max-h-none md:min-h-[520px] md:grid-cols-[0.94fr_1.06fr] md:overflow-hidden">
          <div className="flex flex-col p-5 pr-12 sm:p-6 sm:pr-14 md:p-7">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                Onboarding
              </div>
              <h3 className="mt-4 text-lg font-semibold leading-tight text-foreground">
                Explore what's new in Dreamify
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Follow each step to see the same feature previews used in the new product modals.
              </p>
            </div>

            <div className="mt-6 space-y-2.5">
              {WORKSPACE_NEWS_ITEMS.map((item, index) => {
                const isActive = index === activeIndex;
                const isComplete = index < activeIndex;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border/60 bg-background/45 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                        isActive
                          ? "border-primary/40 bg-primary text-primary-foreground"
                          : isComplete
                            ? "border-primary/30 bg-primary/15 text-primary"
                            : "border-border bg-background text-muted-foreground"
                      )}
                    >
                      {isComplete ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-primary/80">
                        {item.tag}
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-medium leading-tight">
                        {item.title}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-auto pt-6">
              <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Step {activeIndex + 1} of {WORKSPACE_NEWS_ITEMS.length}</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="mt-5 flex items-center gap-2">
                <Button variant="outline" onClick={onDismiss} className="h-auto rounded-lg py-2.5 text-sm">
                  Skip
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  disabled={activeIndex === 0}
                  className="ml-auto h-auto rounded-lg py-2.5 text-sm"
                >
                  <ChevronLeft className="mr-1.5 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handleNext}
                  className="h-auto rounded-lg py-2.5 text-sm shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5"
                >
                  {isLast ? "Start exploring" : "Next"}
                </Button>
              </div>
            </div>
          </div>

          <div className="relative flex min-h-[420px] flex-col overflow-hidden border-t border-border/40 md:min-h-full md:border-l md:border-t-0">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_20%,hsl(var(--primary)/0.18),transparent_55%),radial-gradient(120%_80%_at_20%_85%,hsl(var(--accent)/0.16),transparent_55%)]"
            />
            <div className="relative z-10 p-5 pb-2 sm:p-6 sm:pb-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <ActiveIcon className="h-4 w-4" />
                {activeItem.tag}
              </div>
              <h3 className="mt-4 max-w-md bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-2xl font-semibold leading-tight text-transparent sm:text-3xl">
                {activeItem.title}
              </h3>
              <div className="mt-3 max-w-md space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                {activeItem.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
            <ProductPreviewMedia
              lightSrc={preview.light}
              darkSrc={preview.dark}
              alt={preview.alt}
              className="min-h-0 flex-1 items-start border-t-0 p-4 pt-2 md:border-l-0 md:p-6 md:pt-3"
              imageClassName="max-h-[300px] object-contain"
              showBackground={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

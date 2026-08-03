import { Button } from "@/components/ui/button";
import ProductPreviewMedia from "@/components/workspace/ProductPreviewMedia";
import { X } from "lucide-react";
import {
  FEATURE_ICONS,
  PREVIEW_SOURCES,
  type WorkspaceNewsItem,
} from "@/components/workspace/workspaceNewsContent";

interface ProductNewsModalProps {
  open: boolean;
  feature: WorkspaceNewsItem | null;
  onClose: () => void;
  onExplore: (feature: WorkspaceNewsItem) => void;
}

function FeatureIcon({ featureId }: { featureId: WorkspaceNewsItem["id"] }) {
  const Icon = FEATURE_ICONS[featureId];
  return <Icon className="h-4 w-4" />;
}

export default function ProductNewsModal({ open, feature, onClose, onExplore }: ProductNewsModalProps) {
  if (!open || !feature) return null;

  const preview = PREVIEW_SOURCES[feature.id];

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-3 sm:p-5">
      <div
        className="absolute inset-0 animate-fade-in bg-background/30 backdrop-blur-md dark:bg-black/75"
        onClick={onClose}
      />

      <div className="relative z-[241] w-full max-w-[920px] animate-scale-in overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_40px_140px_-48px_hsl(var(--primary)/0.55)] ring-1 ring-foreground/5">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid max-h-[calc(100vh-32px)] grid-cols-1 overflow-y-auto md:max-h-none md:min-h-[468px] md:grid-cols-[0.88fr_1.12fr] md:overflow-hidden">
          <div className="flex flex-col justify-between p-5 pr-12 sm:p-6 sm:pr-14 md:p-7">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <FeatureIcon featureId={feature.id} />
                {feature.tag}
              </div>
              <h3 className="mt-5 max-w-sm bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-2xl font-semibold leading-tight text-transparent sm:text-3xl">
                {feature.title}
              </h3>
              <div className="mt-4 max-w-sm space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                {feature.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <Button
                onClick={() => onExplore(feature)}
                className="h-auto w-full rounded-lg py-2.5 text-sm shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5"
              >
                {feature.ctaLabel}
              </Button>
              <button
                onClick={onClose}
                className="w-full rounded-lg py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Maybe later
              </button>
            </div>
          </div>

          <ProductPreviewMedia
            lightSrc={preview.light}
            darkSrc={preview.dark}
            alt={preview.alt}
          />
        </div>
      </div>
    </div>
  );
}

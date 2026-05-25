import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ProductNewsModal from "@/components/workspace/ProductNewsModal";
import {
  WORKSPACE_NEWS_ITEMS,
  type WorkspaceNewsItem,
} from "@/components/workspace/workspaceNewsContent";
import OnboardingModal from "@/components/workspace/OnboardingModal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shuffle } from "lucide-react";

export default function WorkspaceNewsPreviewPage() {
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState<WorkspaceNewsItem | null>(WORKSPACE_NEWS_ITEMS[0]);

  const featureCount = useMemo(() => WORKSPACE_NEWS_ITEMS.length, []);

  const openFeature = (feature: WorkspaceNewsItem) => {
    setActiveFeature(feature);
    setModalOpen(true);
  };

  const openRandomFeature = () => {
    const randomItem = WORKSPACE_NEWS_ITEMS[Math.floor(Math.random() * WORKSPACE_NEWS_ITEMS.length)];
    setActiveFeature(randomItem);
    setModalOpen(true);
  };

  const handleExplore = (feature: WorkspaceNewsItem) => {
    setModalOpen(false);
    if (feature.id === "templates") {
      navigate("/workspace?tab=new-chat&openTemplate=1");
      return;
    }
    navigate(`/workspace?tab=${feature.targetTab}`);
  };

  return (
    <div className="min-h-screen bg-muted p-6 md:p-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Workspace News Modals Preview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Test all product news variants before enabling in production.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/workspace?tab=new-chat")}>
              Back to Workspace
            </Button>
            <Button variant="outline" onClick={() => setOnboardingModalOpen(true)}>
              Open Onboarding
            </Button>
            <Button onClick={openRandomFeature} className="button-gradient">
              <Shuffle className="mr-2 h-4 w-4" />
              Open Random
            </Button>
          </div>
        </div>

        <div className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">
          {featureCount} modal variants
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {WORKSPACE_NEWS_ITEMS.map((item) => (
            <Card key={item.id} className="border-border/60">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {item.tag}
                </div>
                <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.body[0]}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">CTA: {item.ctaLabel}</span>
                  <Button size="sm" onClick={() => openFeature(item)}>
                    Preview modal
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <ProductNewsModal
        open={modalOpen}
        feature={activeFeature}
        onClose={() => setModalOpen(false)}
        onExplore={handleExplore}
      />
      <OnboardingModal
        open={onboardingModalOpen}
        onDismiss={() => setOnboardingModalOpen(false)}
      />
    </div>
  );
}

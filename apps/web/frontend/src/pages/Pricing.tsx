import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { PricingHeroSection } from "@/components/homepage-section/pricing-hero";
import { PricingPlansSection } from "@/components/homepage-section/pricing-plans";
import { CTAContainerSection } from "@/components/homepage-section/cta";
import { FooterSection } from "@/components/homepage-section/footer-section";
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import ProjectsSidebar from "@/components/homepage-section/ProjectsSidebar";
import { useProjects } from "@/hooks/useProjects";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";

const PricingPage = () => {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const {
    projects,
    isLoading: projectsLoading,
    createNewProject,
    openProject,
    renameProject,
    deleteProject
  } = useProjects();

  const ctaText = isSignedIn ? "Go to workspace" : "Log in";
  const handleCtaClick = () => {
    if (isSignedIn) {
      navigate("/");
    } else {
      navigate("/login");
    }
  };

  const [projectsOpen, setProjectsOpen] = useState(false);

  useEffect(() => {
    const openProjects = () => setProjectsOpen(true);
    window.addEventListener('open-projects', openProjects as EventListener);
    return () => window.removeEventListener('open-projects', openProjects as EventListener);
  }, []);

  const closeProjects = () => {
    setProjectsOpen(false);
    window.dispatchEvent(new Event('close-projects'));
  };

  return (
    <div className="min-h-screen overflow-y-auto">
      {/* Fixed WaveBackground Component for entire page */}
      <WaveBackground
        className="fixed inset-0 z-0"
      />

      {/* Fixed overlay for better text readability */}
      <div className="fixed inset-0 bg-black/70 z-1"></div>

      <main className="relative z-10">
        <div className="relative z-10">
          <PricingHeroSection />
        </div>
        <div className="relative z-10 -mt-16 md:-mt-24">
          <PricingPlansSection />
        </div>
        <div className="relative z-10">
          <CTAContainerSection ctaText={ctaText} onCtaClick={handleCtaClick} />
        </div>
        <div className="relative z-10">
          <FooterSection />
        </div>
      </main>
      <FeedbackFloatingButton />

      {/* Projects sidebar */}
      <ProjectsSidebar
        open={projectsOpen}
        onClose={closeProjects}
        isLoading={projectsLoading}
        onNewProject={() => createNewProject()}
        recents={projects}
        onOpenProject={openProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
      />
    </div>
  );
};

export default PricingPage;

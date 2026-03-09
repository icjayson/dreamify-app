import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { FinanceMissionSection } from "@/components/homepage-section/finance-mission";
import { FinanceProblemSection } from "@/components/homepage-section/finance-problem";
import { FinanceFeaturesSection } from "@/components/homepage-section/finance-features";
import { DreamifyWaySection } from "@/components/homepage-section/finance-solution";
import { TrustTicker } from "@/components/homepage-section/trust-ticker";
import { CTAContainerSection } from "@/components/homepage-section/cta";
import { FooterSection } from "@/components/homepage-section/footer-section";
// @ts-ignore
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import ProjectsSidebar from "@/components/homepage-section/ProjectsSidebar";
import { useProjects } from "@/hooks/useProjects";

const FinancePage = () => {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const {
    projects,
    createNewProject,
    openProject,
    renameProject,
    deleteProject
  } = useProjects();

  const ctaText = isSignedIn ? "Go to workspace" : "Log in";
  const ctaLink = isSignedIn ? "/" : "/login";
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
          <FinanceMissionSection ctaText={ctaText} ctaLink={ctaLink} />
        </div>
        <div className="relative z-10">
          <FinanceProblemSection />
        </div>
        <div className="relative z-10">
          <FinanceFeaturesSection />
        </div>
        <div className="relative z-10 pt-10">
          <DreamifyWaySection />
        </div>
        <div className="relative z-10">
          <CTAContainerSection ctaText={ctaText} onCtaClick={handleCtaClick} />
        </div>
        <div className="relative z-10 mt-12">
          <TrustTicker />
        </div>
        <div className="relative z-10">
          <FooterSection />
        </div>
      </main>

      {/* Projects sidebar */}
      <ProjectsSidebar
        open={projectsOpen}
        onClose={closeProjects}
        onNewProject={() => createNewProject()}
        recents={projects}
        onOpenProject={openProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
      />
    </div>
  );
};

export default FinancePage;

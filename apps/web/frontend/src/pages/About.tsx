import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { MissionSection } from "@/components/homepage-section/mission";
import { ProblemSection } from "@/components/homepage-section/problem";
import { FeaturesSection } from "@/components/homepage-section/features";
import { CTAContainerSection } from "@/components/homepage-section/cta";
import { FooterSection } from "@/components/homepage-section/footer-section";
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import VideoBackground from '@/components/homepage-section/VideoBackground';
import { useTheme } from "@/hooks/useTheme";
import ProjectsSidebar from "@/components/homepage-section/ProjectsSidebar";
import { useProjects } from "@/hooks/useProjects";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";

const AboutPage = () => {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const { resolvedTheme } = useTheme();
  const {
    projects,
    isLoading: projectsLoading,
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

  // Sidebar mount/unmount and animation are handled inside ProjectsSidebar

  const closeProjects = () => {
    setProjectsOpen(false);
    window.dispatchEvent(new Event('close-projects'));
  };


  return (
    <div className="min-h-screen overflow-y-auto">
      {/* Fixed background: Video for light, Wave for dark */}
      {resolvedTheme === 'dark' ? (
        <WaveBackground className="fixed inset-0 z-0" />
      ) : (
        <VideoBackground className="fixed inset-0 z-0" />
      )}

      {/* Fixed overlay for better text readability */}
      <div className={`fixed inset-0 z-[1] ${resolvedTheme === 'dark' ? 'bg-black/60' : 'bg-white/20'}`}></div>

      <main className="relative z-10">
        <div className="relative z-10">
          <MissionSection ctaText={ctaText} ctaLink={ctaLink} />
        </div>
        <div className="relative z-10">
          <ProblemSection />
        </div>
        <div className="relative z-10">
          <FeaturesSection />
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

export default AboutPage;



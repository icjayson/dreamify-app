import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { MissionSection } from "@/components/sections/mission";
import { ProblemSection } from "@/components/sections/problem";
import { FeaturesSection } from "@/components/sections/features";
import { CTAContainerSection } from "@/components/sections/cta";
import { FooterSection } from "@/components/sections/footer-section";
import WaveBackground from '../../../src/ui/lightswind/wave-background';

const AboutPage = () => {
  const navigate = useNavigate();

  const onGetStarted = () => {
    navigate("/waitlist");
  };

  const [projectsOpen, setProjectsOpen] = useState(false);
  const [sidebarShown, setSidebarShown] = useState(false);

  useEffect(() => {
    const openProjects = () => setProjectsOpen(true);
    window.addEventListener('open-projects', openProjects as EventListener);
    return () => window.removeEventListener('open-projects', openProjects as EventListener);
  }, []);

  useEffect(() => {
    if (projectsOpen) {
      // allow mount before transitioning in
      const id = requestAnimationFrame(() => setSidebarShown(true));
      return () => cancelAnimationFrame(id);
    } else {
      setSidebarShown(false);
    }
  }, [projectsOpen]);

  const closeProjects = () => {
    setSidebarShown(false);
    // wait for transition to complete before unmount
    setTimeout(() => setProjectsOpen(false), 300);
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
          <MissionSection />
        </div>
        <div className="relative z-10">
          <ProblemSection />
        </div>
        <div className="relative z-10">
          <FeaturesSection />
        </div>
        <div className="relative z-10">
          <CTAContainerSection />
        </div>
        <div className="relative z-10">
          <FooterSection />
        </div>
      </main>

      {/* Projects sidebar */}
      {projectsOpen && (
        <div className="fixed inset-0 z-[150]">
          <div className="absolute inset-0 bg-black/10" onClick={closeProjects} />
          <div className={`absolute left-0 top-0 h-full w-[260px] max-w-[80vw] bg-muted/80 border-r border-border p-4 flex flex-col transform transition-transform duration-300 ease-out ${sidebarShown ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-white/90 font-medium">My projects</div>
              <button onClick={closeProjects} className="text-white/70 hover:text-white text-sm">✕</button>
            </div>
            <button className="w-full text-left px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white text-sm hover:bg-white/20">+ New project</button>
            <div className="text-white/50 text-xs mt-4 mb-2">Recents</div>
            <div className="flex-1 overflow-y-auto">
              <button className="w-full text-left px-3 py-2 rounded-md hover:bg-white/10 text-white/90 text-sm">Portfolio Website Builder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AboutPage;



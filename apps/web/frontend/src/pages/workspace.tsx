import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Plus, Search, Flame, Circle, Menu, PanelLeft } from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import WorkspaceSidebar from "@/components/project-section/WorkspaceSidebar";
import ProjectCard from "@/components/project-section/ProjectCard";

const HARDCODED_WORKSPACE = {
  orgName: "My Workspace",
  projects: [
    {
      id: "p1",
      name: "Performance Marketing Dashboard",
      thumbnail: "/Projectcard-image-1.png",
      updatedAt: "2 days ago",
      description: "Track campaign performance and funnel metrics.",
    },
  ],
};

export default function WorkspacePage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("projects");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const navigate = useNavigate();
  const { user } = useUser();
  const storageKey = `dreamify_welcomed_${user?.id}`;
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (user?.id && !localStorage.getItem(storageKey)) {
      setShowWelcome(true);
    }
  }, [user?.id, storageKey]);

  const handleDismissWelcome = () => {
    localStorage.setItem(storageKey, "true");
    setShowWelcome(false);
  };

  return (
    <div className="min-h-screen">

      {/* Content Area: Responsive Sidebar + Main */}
      <div
        className="grid bg-muted"
        style={{ gridTemplateColumns: `${sidebarCollapsed ? '4rem' : '16rem'} 1fr` }}
      >
        {/* Sidebar */}
        <WorkspaceSidebar 
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
          activeItem={activeTab}
          onActiveItemChange={setActiveTab}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        
        {/* Main Content */}
        <main className="p-6 h-[calc(100vh-4rem)] overflow-y-auto">
        {/* Page Header Block */}
        <div className="rounded-lg mb-6">
          <div className="flex items-center justify-between text-muted-foreground">
            <div className="flex items-center gap-2">
            <button
              type="button"
              className="p-1.5 rounded-md hover:bg-background transition-colors"
              aria-label="Toggle navigation"
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              <PanelLeft className="w-5 h-5 text-white" />
            </button>
            <div className="h-4 w-px bg-border mx-1" aria-hidden="true" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>{HARDCODED_WORKSPACE.orgName}</BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><span className='text-white'>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1).replace("-"," ")}</span></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            </div>
            {activeTab === 'projects' && (
              <button onClick={() => navigate('/workspace/project')} className="button-gradient h-8 px-3 rounded-md text-sm text-white flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <span>Create New Project</span>
              </button>
            )}
          </div>
        </div>
        
        {/* Projects Section Block */}
        <div className="rounded-lg border bg-card/50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Projects</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <ProjectCard project={HARDCODED_WORKSPACE.projects[0]} />
          {/* Create New Project Card */}
          <Card onClick={() => navigate('/workspace/project')} className="border-dashed border-2 hover:border-foreground/20 cursor-pointer max-w-sm h-full">
            <CardContent className="flex items-center justify-center h-full">
              <div className="text-center">
                <Plus className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">Create New Project</p>
              </div>
            </CardContent>
          </Card>
          </div>
        </div>
        </main>
      </div>

      <Dialog open={showWelcome} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Welcome to Dreamify! 🎉</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              You're currently on the <strong>Pro plan</strong> — enjoy full access while we're in early access.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              You have <strong>100 Sparkles per day</strong> to analyze data and generate dashboards.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleDismissWelcome} className="w-full">Start exploring</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}



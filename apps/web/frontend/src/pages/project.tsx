import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Pencil, SquareArrowOutUpRight, X } from "lucide-react";
import ChatInterface from "@/chat/ChatInterface";
import DashboardPreview from "@/components/project-section/DashboardPreview";
import DashboardLoading from "@/components/project-section/DashboardLoading";
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import BlankState from "@/components/project-section/BlankState";
import { useUser } from "@clerk/clerk-react";
import PublishModal from "@/components/project-section/PublishModal";
import { projectService } from "@/services/projectService";
import { conversationService } from "@/services/conversationService";
import { conversationNodesToMessages } from "@/chat/conversationToMessages";
import { useToast } from "@/hooks/use-toast";
import { FeedbackProjectButton } from "@/components/ui/feedback-button";
import { useProjects } from "@/hooks/useProjects";
import ProjectsSidebar from "@/components/homepage-section/ProjectsSidebar";
import { PanelRightClose } from "lucide-react";

export default function ProjectPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [processedData, setProcessedData] = useState<any>(null);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'dashboard'>('chat');
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [projectTitle, setProjectTitle] = useState("Untitled Project");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const {
    projects,
    createNewProject,
    renameProject,
    deleteProject,
    openProject
  } = useProjects();

  useEffect(() => {
    document.title = projectTitle ? `${projectTitle}` : "Dreamify";
    return () => {
      document.title = "Dreamify";
    };
  }, [projectTitle]);

  const startEditingTitle = () => {
    setRenameValue(projectTitle);
    setIsEditingTitle(true);
  };

  const cancelEditingTitle = () => {
    if (isRenaming) return;
    setRenameValue("");
    setIsEditingTitle(false);
  };

  const handleRenameSave = async () => {
    if (!projectId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast({
        title: "Name required",
        description: "Please enter a project name.",
        variant: "destructive",
      });
      return;
    }
    try {
      setIsRenaming(true);
      const response = await projectService.updateProject(projectId, trimmed);
      if (response.success) {
        setProjectTitle(trimmed);
        toast({
          title: "Project renamed",
          description: `Project name updated to "${trimmed}".`,
        });
        setIsEditingTitle(false);
      } else {
        toast({
          title: "Failed to rename project",
          description: response.error || "Could not update project name",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to rename project", error);
      toast({
        title: "Rename failed",
        description: "Could not update project name. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRenaming(false);
    }
  };
  const uploadedFiles = useChatStore((s) => s.uploadedFiles);
  const isInitialLoading = useChatStore((s) => s.isInitialLoading);
  const hasPolledStatus = uploadedFiles.some(f =>
    f.status === 'processing' || f.status === 'processed' || f.status === 'error'
  );

  // Key insight: Show dashboard if we have processedData from previous build,
  // even when a new file is uploaded (status='uploaded'). 
  // Only hide dashboard when explicitly starting new processing.
  const shouldShowDashboard = processedData || hasPolledStatus;
  const { user } = useUser();
  const { toast } = useToast();
  const displayName = user?.username || user?.fullName || user?.firstName || "you";
  const setMessages = useChatStore((s) => s.setMessages);
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId);
  const setHasShownInitialDashboard = useChatStore((s) => s.setHasShownInitialDashboard);
  const selectDashboard = useChatStore((s) => s.selectDashboard);
  const selectedDashboardId = useChatStore((s) => s.selectedDashboardId);
  const isDashboardOpen = useChatStore((s) => s.isDashboardOpen);
  const setIsDashboardOpen = useChatStore((s) => s.setIsDashboardOpen);

  const hydrateConversation = useCallback(async (projId: string, conversationId: string) => {
    try {
      const convoResponse = await conversationService.loadConversation(conversationId, projId);
      const conversation = convoResponse.conversation;
      const nodes = conversation?.nodes ?? [];

      // Extract assets from nodes
      const assets: any[] = [];
      for (const node of nodes) {
        const contents = node?.contents || [];
        for (const content of contents) {
          if (content?.type === 'asset' || content?.type === 'attachment') {
            const assetData = content?.data || {};
            if (assetData.asset_id) {
              assets.push(assetData);
            }
          }
        }
      }

      // Use first asset for display name, fallback to "dashboard"
      const primaryAsset = assets[0];
      const assetName = primaryAsset?.filename || "dashboard";

      let assetSourceType: string | undefined;
      const assetType = primaryAsset?.sourceType || '';
      const fName = primaryAsset?.filename || '';
      if (assetType.toLowerCase().includes('ga4') || fName.toLowerCase().includes('google_analytics')) {
        assetSourceType = 'GA4';
      } else if (assetType.toLowerCase().includes('sheet') || fName.toLowerCase().includes('google_sheet') || fName.toLowerCase().includes('gsheet')) {
        assetSourceType = 'Google Sheets';
      }

      const restoredMessages = conversationNodesToMessages(conversation, {
        sourceFileName: assetName,
        lastUserMessageAttachment: primaryAsset ? {
          kind: 'csv',
          name: primaryAsset.filename || 'data.csv',
          mime: 'text/csv',
          sourceType: assetSourceType,
          accountName: primaryAsset.account_name,
          propertyName: primaryAsset.property_name || primaryAsset.filename
        } : undefined
      });
      if (restoredMessages.length) {
        setMessages(restoredMessages);
      }
      setCurrentConversationId(conversationId);

      const dashboardResponse = await conversationService.getDashboardData(conversationId, projId);
      if (dashboardResponse?.dashboard_data && primaryAsset) {
        let sourceType: string | undefined;
        const assetType = primaryAsset.sourceType || '';
        const fName = primaryAsset.filename || '';
        if (assetType === 'integration_ga4' || assetType === 'GA4' || fName.startsWith('google_analytics')) {
          sourceType = 'GA4';
        } else if (assetType === 'integration_gsheets' || assetType === 'Google Sheets' || fName.startsWith('google_sheet')) {
          sourceType = 'Google Sheets';
        }

        const restoredFile = {
          fileID: primaryAsset.file_id || primaryAsset.asset_id || 'restored',
          filename: primaryAsset.filename || 'data.csv',
          size: primaryAsset.size_bytes || 0,
          ext: primaryAsset.extension || '',
          status: 'processed' as const,
          projectId: projId,
          conversationId,
          processedData: dashboardResponse.dashboard_data,
          sourceType: sourceType,
        };
        useChatStore.getState().clearFiles();
        useChatStore.getState().addFiles([restoredFile]);
        if (dashboardResponse.dashboard_id) {
          useChatStore.getState().setSelectedDashboardId(dashboardResponse.dashboard_id);
        }
        setProcessedData(dashboardResponse.dashboard_data);
        setHasShownInitialDashboard(true);
        setIsDashboardOpen(true);
        setActiveTab('dashboard');
      }
    } catch (error) {
      console.error('Failed to hydrate conversation', error);
      toast({
        title: "Unable to restore project",
        description: "Failed to load previous conversation. You can start a new one.",
        variant: "destructive",
      });
    }
  }, [setMessages, setCurrentConversationId, toast, setHasShownInitialDashboard]);

  const projectRef = useRef<string | null>(null);

  // Reset and hydrate when project changes
  useEffect(() => {
    if (!projectId) return;

    // Only reset if it's a DIFFERENT project
    if (projectRef.current !== projectId) {
      console.log('Project ID changed, resetting chat state:', projectId);
      useChatStore.getState().resetChat();
      useFileStore.getState().resetFileState();
      useChatStore.getState().setCurrentProjectId(projectId);
      projectRef.current = projectId;
    }

    let cancelled = false;
    let hasConversation = false;

    const loadProject = async () => {
      setIsProjectLoading(true);
      try {
        const response = await projectService.getProject(projectId);
        if (!cancelled) {
          if (response.success && response.project) {
            const displayTitle = response.project.name || response.project.dashboard_title || "Untitled Project";
            setProjectTitle(displayTitle);
            const latestConversationId = response.project.latest_conversation_id;
            if (latestConversationId) {
              hasConversation = true;
              await hydrateConversation(response.project.id, latestConversationId);
            }

            // Check for pending action from HomePage
            const pendingAction = useChatStore.getState().pendingAction;
            if (pendingAction && pendingAction.projectId === projectId) {
              console.log('Found pending action, executing...', pendingAction);
              hasConversation = true;  // Treat as active project to prevent cleanup
              useChatStore.getState().addFiles(pendingAction.files);

              // Execute processing
              void useChatStore.getState().processFileWithMessage(
                pendingAction.content,
                undefined,
                projectId
              );

              // Clear pending action
              useChatStore.getState().setPendingAction(null);
            }
          } else {
            toast({
              title: "Project unavailable",
              description: response.error || "Failed to load project",
              variant: "destructive",
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load project', error);
          toast({
            title: "Project unavailable",
            description: "Failed to load project data",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setIsProjectLoading(false);
        }
      }
    };

    loadProject();
    return () => {
      cancelled = true;

      // Option A: Frontend Cleanup
      // If the page loaded as an empty project, verify if it's still empty
      // by querying the backend directly (bypassing local chatStore state issues).
      if (!hasConversation) {
        (async () => {
          try {
            const projResponse = await projectService.getProject(projectId);
            const latestConvId = projResponse.project?.latest_conversation_id;

            if (latestConvId) {
              // Explicitly verify via API if the conversation JSON actually exists
              await conversationService.loadConversation(latestConvId, projectId);
              console.log("Conversation data exists, keeping project:", projectId);
            } else {
              console.log("Cleaning up empty project (no conversation started):", projectId);
              await projectService.deleteProject(projectId);
              window.dispatchEvent(new Event('projectUpdated'));
            }
          } catch (err) {
            console.log("Cleaning up empty project (invalid/no conversation JSON):", projectId);
            projectService.deleteProject(projectId)
              .then(() => window.dispatchEvent(new Event('projectUpdated')))
              .catch(console.error);
          }
        })();
      }
    };
  }, [projectId, hydrateConversation, toast]);

  // Sync processedData from store to local state
  useEffect(() => {
    const processedFile = uploadedFiles.find(f => f.processedData);
    if (processedFile?.processedData) {
      setProcessedData(processedFile.processedData);
    }
  }, [uploadedFiles]);

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="px-4 py-2">
        <div className="flex items-center justify-between h-10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="button-outline h-8 w-8 rounded-md flex items-center justify-center text-white/70 hover:text-white"
              aria-label="Toggle project sidebar"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
            <button aria-label="Go back" onClick={() => navigate('/')} className="button-outline h-8 px-4 rounded-md text-sm flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm text-white/70 truncate" title={displayName}>{displayName}</span>
              <span className="text-sm text-white/50">›</span>
              {isEditingTitle ? (
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleRenameSave();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEditingTitle();
                      }
                    }}
                    className="text-sm text-white bg-transparent border-b border-white/40 focus:outline-none focus:border-white/80 leading-none w-40 sm:w-56"
                    autoFocus
                  />
                  <button
                    className="px-2 py-1 text-xs rounded-md bg-transparent border border-border/40 text-white/70 hover:text-white"
                    onClick={cancelEditingTitle}
                    disabled={isRenaming}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-2 py-1 text-xs rounded-md button-gradient disabled:opacity-70 disabled:pointer-events-none"
                    onClick={handleRenameSave}
                    disabled={isRenaming}
                  >
                    {isRenaming ? "Saving..." : "Save"}
                  </button>
                </div>
              ) : (
                <>
                  <span className="font-regular text-sm truncate" title={projectTitle}>{projectTitle}</span>
                  <button
                    aria-label="Rename project"
                    onClick={startEditingTitle}
                    className="text-white/60 hover:text-white transition-colors p-1 rounded-md hover:bg-white/10"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center">
            <FeedbackProjectButton />
            {isDashboardOpen && (
              <button onClick={() => setIsPublishOpen(true)} className="button-gradient h-8 px-4 rounded-md text-sm text-white flex items-center ml-2"><span>Publish</span>
                <SquareArrowOutUpRight className="w-4 h-4 ml-2" />
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Top Tabs (sm only) */}
      <div className="lg:hidden px-4 pb-2">
        <div className="w-full rounded-xl border border-white/15 bg-background/70 backdrop-blur p-1 flex">
          <button
            onClick={() => setActiveTab('chat')}
            aria-pressed={activeTab === 'chat'}
            className={`flex-1 py-0 rounded-lg text-sm transition-all ${activeTab === 'chat' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'}`}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            aria-pressed={activeTab === 'dashboard'}
            className={`flex-1 py-0 rounded-lg text-sm transition-all ${activeTab === 'dashboard' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'}`}
          >
            Dashboard
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={`grid grid-cols-1 ${shouldShowDashboard && isDashboardOpen ? 'lg:grid-cols-4' : 'lg:flex lg:justify-center'} h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)] min-h-0`}>
        <div className={`${activeTab === 'chat' ? 'block w-full' : 'hidden'} ${shouldShowDashboard && isDashboardOpen ? 'lg:col-span-1 lg:w-full' : 'lg:w-[800px] lg:max-w-full w-full mx-auto'} lg:block transition-all duration-300`}>
          <div className=" bg-muted  h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)] min-h-0">
            <div>
              <div className="px-1 h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)]" data-chat-root>
                <ChatInterface
                  projectId={projectId ?? undefined}
                  onProcessedDataChange={(data) => {
                    // This is called when processing and dashboard generation is complete
                    if (data) {
                      setProcessedData(data);
                      setHasShownInitialDashboard(true);
                      setIsDashboardOpen(true);
                      setActiveTab('dashboard');
                    }
                  }}
                  onSwitchToDashboard={(dashboardId) => {
                    if (dashboardId && projectId) {
                      selectDashboard(dashboardId, projectId).then((data) => {
                        if (data) {
                          setProcessedData(data);
                        }
                      });
                    }
                    setIsDashboardOpen(true);
                    setActiveTab('dashboard');
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* dashboard columns */}
        <div className={`${activeTab === 'dashboard' ? 'block w-full' : 'hidden'} ${shouldShowDashboard && isDashboardOpen ? 'lg:col-span-3 lg:block w-full' : 'lg:hidden'} transition-all duration-300 relative`}>
          {shouldShowDashboard && isDashboardOpen && (
            <button
              onClick={() => { setIsDashboardOpen(false); setActiveTab('chat'); }}
              className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/60 shadow-lg border border-white/10 hover:bg-black/90 text-white/80 hover:text-white transition-all lg:block hidden backdrop-blur-md group"
              title="Close Dashboard"
            >
              <X className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </button>
          )}
          <div className="mr-2 sm:ml-0 ml-2 mt-0 mb-0 rounded-lg border border-white/20 h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)] overflow-hidden relative">
            {!shouldShowDashboard ? (
              <BlankState
                subtexts={[
                  "Upload a CSV file and let Dreamify build your dashboard",
                  "Connect Google Sheets, GA4, Meta, Stripe, and more",
                  "Describe your dashboard — Dreamify designs it instantly",
                  "Cinematic motion and clear storytelling for your data",
                  "Try now to experience Dreamify's capabilities",
                ]}
                intervalMs={1000}
                onWatchTutorial={() => window.open('/tutorial', '_blank')}
                handleFileUpload={() => {
                  try {
                    window.dispatchEvent(new Event('nyx:open-file-picker'));
                    const el = document.querySelector('[data-chat-root]');
                    if (el && 'scrollIntoView' in el) {
                      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  } catch (_e) { }
                }}
                onConnectDataSource={() => {
                  try {
                    useChatStore.getState().setDropdownOpen(true);
                    const el = document.querySelector('[data-chat-root]');
                    if (el && 'scrollIntoView' in el) {
                      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  } catch (_e) { }
                }}
                onUseSample={() => {
                  try {
                    useChatStore.getState().setInputValue('Use sample data and create a demo dashboard');
                    const el = document.querySelector('[data-chat-root]');
                    if (el && 'scrollIntoView' in el) {
                      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  } catch (_e) { }
                }}
              />
            ) : (
              isProjectLoading ? (
                <DashboardLoading title="Loading Project" description="Restoring your dashboard..." durationSec={5} />
              ) : processedData ? (
                // Prioritize showing dashboard if it exists, even during Q&A processing
                // This preserves the view during Q&A mode while only new dashboard generation shows loading
                <DashboardPreview dashboardId={selectedDashboardId || undefined} processedData={processedData} className="h-full overflow-y-auto" />
              ) : uploadedFiles.some(f => f.status === 'processing') ? (
                // Only show loading if no existing dashboard (fresh upload generating first dashboard)
                <DashboardLoading title="Generating Dashboard" description="Please wait while we build your dashboard..." durationSec={10} />
              ) : isInitialLoading ? (
                <DashboardLoading title="Generating Dashboard" description="Please wait while we build your dashboard..." durationSec={10} />
              ) : (
                <DashboardLoading title="Preparing Dashboard" description="Please wait..." durationSec={10} />
              )
            )}
          </div>
        </div>
      </div>
      {/* Publish Modal */}
      {isPublishOpen && <PublishModal open={isPublishOpen} onOpenChange={setIsPublishOpen} projectId={projectId ?? undefined} processedData={processedData} />}

      {/* Projects Sidebar */}
      <ProjectsSidebar
        className="bg-muted/98 backdrop-blur-lg"
        open={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNewProject={() => {
          setIsSidebarOpen(false);
          createNewProject();
        }}
        recents={projects.map(p => ({ id: p.id, title: p.title || 'Untitled Project' }))}
        onOpenProject={(id) => {
          setIsSidebarOpen(false);
          if (id === projectId) return;
          openProject(id);
        }}
        onRenameProject={(id, title) => {
          renameProject(id, title);
        }}
        onDeleteProject={(id) => {
          deleteProject(id);
          if (id === projectId) {
            navigate('/');
          }
        }}
      />
    </div>
  );
}

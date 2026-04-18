import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, LayoutTemplate, Pencil, Sparkles, SquareArrowOutUpRight, X } from "lucide-react";
import ChatInterface from "@/chat/ChatInterface";
import DashboardPreview from "@/components/project-section/DashboardPreview";
import DashboardLoading from "@/components/project-section/DashboardLoading";
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import { diffDashboardComponents } from "@/utils/dashboardDiff";
import BlankState from "@/components/project-section/BlankState";
import { useUser } from "@clerk/clerk-react";
import PublishModal from "@/components/project-section/PublishModal";
import { projectService } from "@/services/projectService";
import { conversationService } from "@/services/conversationService";
import { conversationNodesToMessages } from "@/chat/conversationToMessages";
import { useToast } from "@/hooks/use-toast";
import HeaderCreditBadge from "@/components/ui/HeaderCreditBadge";
import { useSubscription } from "@/hooks/useSubscription";
import { useProjects } from "@/hooks/useProjects";
import ProjectsSidebar from "@/components/homepage-section/ProjectsSidebar";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

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
    isLoading: projectsLoading,
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
  const refreshProjectTitle = async () => {
    if (!projectId) return;
    const response = await projectService.getProject(projectId);
    if (response.success && response.project) {
      const displayTitle = response.project.name || response.project.dashboard_title || "Untitled Project";
      setProjectTitle(displayTitle);
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

  // Extract dashboard components for @chart mention in chat
  const dashboardComponents = useMemo(() => {
    if (!processedData) return undefined;
    // processedData may have raw charts/metrics/tables arrays or a nested dashboard_config
    const config = processedData?.dashboard_config || processedData;
    // If already normalized with components array, use directly
    if (config?.components) return config.components;
    // Otherwise build from raw arrays
    const components: any[] = [];
    let id = 1;
    if (Array.isArray(config?.metrics)) {
      config.metrics.forEach((m: any) => {
        components.push({ id: String(m.id || `metric-${id}`), type: 'metric', component_config: { id: String(m.id || `metric-${id}`), title: m.title || m.name || 'Metric', type: 'metric', ...m }, position: m.layout || { x: 0, y: 0, width: 4, height: 2 } });
        id++;
      });
    }
    if (Array.isArray(config?.charts)) {
      config.charts.forEach((c: any) => {
        components.push({ id: String(c.id || `chart-${id}`), type: 'chart', component_config: { id: String(c.id || `chart-${id}`), title: c.title || 'Chart', type: c.type || c.chart_type || 'bar', ...c }, position: c.layout || { x: 0, y: 0, width: 6, height: 4 } });
        id++;
      });
    }
    if (Array.isArray(config?.tables)) {
      config.tables.forEach((t: any) => {
        components.push({ id: String(t.id || `table-${id}`), type: 'table', component_config: { id: String(t.id || `table-${id}`), title: t.title || 'Table', type: 'table', ...t }, position: t.layout || { x: 0, y: 0, width: 12, height: 6 } });
        id++;
      });
    }
    return components.length > 0 ? components : undefined;
  }, [processedData]);

  const dashboardTitle = useMemo(() => {
    if (!processedData) return null;
    const config = processedData?.dashboard_config || processedData;
    return config?.title || config?.dashboard?.title || null;
  }, [processedData]);

  const { user } = useUser();
  const { creditsRemaining, creditUsage } = useSubscription();
  const { toast } = useToast();
  const displayName = user?.username || user?.fullName || user?.firstName || "you";
  const setMessages = useChatStore((s) => s.setMessages);
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId);
  const setHasShownInitialDashboard = useChatStore((s) => s.setHasShownInitialDashboard);
  const selectDashboard = useChatStore((s) => s.selectDashboard);
  const selectedDashboardId = useChatStore((s) => s.selectedDashboardId);
  const isDashboardOpen = useChatStore((s) => s.isDashboardOpen);
  const setIsDashboardOpen = useChatStore((s) => s.setIsDashboardOpen);
  const isDashboardVisible = (shouldShowDashboard && isDashboardOpen) || (activeTab === 'dashboard');
  const selectedTemplate = useChatStore((s) => s.selectedTemplate);
  const setTemplateModalOpen = useChatStore((s) => s.setTemplateModalOpen);
  const isUpdatingDashboard = useChatStore((s) => s.isUpdatingDashboard);
  const currentWorkflowStep = useChatStore((s) => s.currentWorkflowStep);

  // Friendly step labels for the update overlay
  const UPDATING_STEP_MAP: Record<string, string> = {
    'start': 'Starting update...',
    'load_conversation': 'Loading context...',
    'download_asset': 'Analyzing data...',
    'run_workflow': 'Processing changes...',
    'routing': 'Understanding your request...',
    'reasoning': 'Planning changes...',
    'execution': 'Applying updates...',
    'synthesis': 'Rebuilding dashboard...',
    'validation': 'Verifying results...',
    'finish': 'Almost done...',
  };
  const updatingStepText = currentWorkflowStep ? (UPDATING_STEP_MAP[currentWorkflowStep] || 'Updating...') : 'Updating dashboard...';

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
      const pendingAction = useChatStore.getState().pendingAction;
      const shouldPreserveTemplate = pendingAction && pendingAction.projectId === projectId;
      useChatStore.getState().resetChat(shouldPreserveTemplate);
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
              // Resume polling if a workflow is still running (e.g. after page reload / F5)
              void useChatStore.getState().resumeWorkflowPolling(
                response.project.id,
                latestConversationId,
                setProcessedData
              );
            }

            // Check for pending action from HomePage
            const pendingAction = useChatStore.getState().pendingAction;
            if (pendingAction && pendingAction.projectId === projectId) {
              console.log('Found pending action, executing...', pendingAction);
              hasConversation = true;  // Treat as active project to prevent cleanup
              useChatStore.getState().addFiles(pendingAction.files);
              if (pendingAction.model) {
                useChatStore.getState().setSelectedModel(pendingAction.model);
              }

              // Execute processing
              void useChatStore.getState().processFileWithMessage(
                pendingAction.content,
                undefined,
                projectId,
                undefined,
                undefined,
                undefined,
                pendingAction.model
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

  // ── Post-redirect: auto-open connector modal after OAuth consent ────────────
  useEffect(() => {
    const connectorParam = searchParams.get('connector');
    if (!connectorParam) return;

    const store = useChatStore.getState();
    const CONNECTOR_MODAL_MAP: Record<string, (open: boolean) => void> = {
      'ga4': store.setGA4ModalOpen,
      'google-sheets': store.setGoogleSheetsModalOpen,
      'google-ads': store.setGoogleAdsModalOpen,
      'firebase': store.setFirebaseModalOpen,
    };

    const openModal = CONNECTOR_MODAL_MAP[connectorParam];
    if (openModal) {
      // Small delay to ensure Clerk user data is loaded after redirect
      setTimeout(() => openModal(true), 500);
    }

    // Clean up the query param from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('connector');
    const newUrl = `${window.location.pathname}${newParams.toString() ? '?' + newParams.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [searchParams]);

  // Sync processedData from store to local state
  useEffect(() => {
    const processedFile = uploadedFiles.find(f => f.processedData);
    if (processedFile?.processedData) {
      setProcessedData(processedFile.processedData);
    }
  }, [uploadedFiles]);

  return (
    <>
      {/* Loading overlay — renders on top of the page so components are visible behind */}
      {isProjectLoading && (
        <div className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center">
          <DashboardLoading title="Restoring your project..." description="Wait a few seconds" durationSec={5} />
        </div>
      )}

      <div className="h-[100dvh] flex flex-col bg-muted">
        {/* Header */}
        <div className="px-4 py-2 relative z-[200] shrink-0">
          <div className="flex flex-wrap items-center justify-between min-h-10 gap-y-2 pb-2 md:pb-0 shrink-0">
            <div className="flex items-center gap-3 order-1 shrink-0">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="button-outline h-8 w-8 rounded-md flex items-center justify-center text-white/70 hover:text-white"
                aria-label="Toggle project sidebar"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
              <button aria-label="Go back" onClick={() => navigate('/workspace?tab=connectors')} className="button-outline h-8 px-2 md:px-4 rounded-md text-sm flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden md:inline">Back</span>
              </button>
              {shouldShowDashboard && !isDashboardOpen && (
                <button
                  onClick={() => { setIsDashboardOpen(true); setActiveTab('dashboard'); }}
                  className="button-outline h-8 w-8 rounded-md flex items-center justify-center text-white/70 hover:text-white transition-colors"
                  title="Show dashboard"
                  aria-label="Show dashboard"
                >
                  <PanelRightOpen className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 sm:ml-2 min-w-0 w-full md:w-auto order-3 md:order-2 md:mr-auto pl-1 md:pl-0 mt-1 md:mt-0">
              <span className="hidden md:inline text-sm text-white/70 truncate" title={displayName}>{displayName}</span>
              <span className="hidden md:inline text-sm text-white/50">›</span>
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
            <div className="flex items-center order-2 md:order-3 ml-auto md:ml-0 shrink-0 gap-2">
              <HeaderCreditBadge creditsRemaining={creditsRemaining} monthlyCreditsUsed={creditUsage?.monthly_credits_used} />
            </div>
          </div>
        </div>
        {/* Top Tabs (sm only) */}
        <div className="lg:hidden px-4 pb-2 shrink-0">
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
        <div className={`grid grid-cols-1 ${shouldShowDashboard && isDashboardOpen ? 'lg:grid-cols-4' : 'lg:flex lg:justify-center'} flex-1 lg:flex-none lg:h-[calc(100vh-4rem)] min-h-0`}>
          <div className={`${activeTab === 'chat' ? 'block w-full' : 'hidden'} ${shouldShowDashboard && isDashboardOpen ? 'lg:col-span-1 lg:w-full' : 'lg:w-[800px] lg:max-w-full w-full mx-auto'} lg:block transition-all duration-300 h-full lg:h-auto min-h-0`}>
            <div className="bg-muted h-full lg:h-[calc(100vh-4rem)] min-h-0 flex flex-col lg:block">
              <div className="flex-1 min-h-0 h-full lg:h-auto lg:block">
                <div className="px-1 h-full lg:h-[calc(100vh-4rem)] flex flex-col lg:block" data-chat-root>
                  <ChatInterface
                    projectId={projectId ?? undefined}
                    onProcessedDataChange={(data) => {
                      // This is called when processing and dashboard generation is complete
                      if (data) {
                        // Diff detection: compare old vs new dashboard data for edit feedback
                        if (processedData) {
                          const changed = diffDashboardComponents(processedData, data);
                          if (changed.size > 0) {
                            useChatStore.getState().setChangedComponentIds(changed);
                          }
                        }
                        setProcessedData(data);
                        setHasShownInitialDashboard(true);
                        setIsDashboardOpen(true);
                        setActiveTab('dashboard');
                        void refreshProjectTitle();
                        window.dispatchEvent(new Event('projectUpdated'));
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
                    dashboardComponents={dashboardComponents}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* dashboard columns */}
          <div className={`${activeTab === 'dashboard' ? 'block w-full' : 'hidden'} ${shouldShowDashboard && isDashboardOpen ? 'lg:col-span-3 lg:block w-full' : 'lg:hidden'} transition-all duration-300 relative h-full lg:h-auto min-h-0`}>
            <div className="mr-2 sm:ml-0 ml-2 mt-0 mb-0 rounded-lg border border-white/20 h-full lg:h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
              {/* Dashboard panel header */}
              {shouldShowDashboard && isDashboardOpen && !isProjectLoading && (
                <div className="shrink-0 flex items-center gap-2 px-3 h-10 border-b border-white/10 bg-background/60 backdrop-blur-sm">
                  <span className="text-sm font-medium text-white/80 truncate min-w-0">
                    {dashboardTitle || 'Dashboard'}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setTemplateModalOpen(true, 'header')}
                      className="button-outline h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 text-white/70 hover:text-white"
                      title="Choose template"
                      aria-label="Choose template"
                    >
                      <LayoutTemplate className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Template</span>
                    </button>
                    {isDashboardVisible && (
                      <button
                        onClick={() => setIsPublishOpen(true)}
                        className="button-gradient h-7 px-2.5 rounded-md text-xs text-white flex items-center gap-1.5"
                      >
                        <span>Publish</span>
                        <SquareArrowOutUpRight className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => { setIsDashboardOpen(false); setActiveTab('chat'); }}
                      className="button-outline h-7 w-7 rounded-md flex items-center justify-center text-white/50 hover:text-white transition-colors"
                      aria-label="Close dashboard"
                      title="Close dashboard"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {/* Content area */}
              <div className="flex-1 overflow-hidden relative">
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
                    <DashboardLoading title="Restoring your dashboard..." description="Wait a few seconds" durationSec={5} />
                  ) : processedData ? (
                    <DashboardPreview
                      dashboardId={selectedDashboardId || undefined}
                      projectId={projectId || undefined}
                      processedData={processedData}
                      className="h-full overflow-y-auto"
                      showCardActionsMenu
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full bg-black/5">
                      <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-black/70 border border-white/15 shadow-lg backdrop-blur-md">
                        <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                        <span className="text-sm text-white/90 font-medium whitespace-nowrap">
                          Loading your dashboard...
                        </span>
                        <div className="flex gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:0ms]" />
                          <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:150ms]" />
                          <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:300ms]" />
                        </div>
                      </div>
                    </div>
                  )
                )}
                {/* Edit feedback overlay */}
                {isUpdatingDashboard && (
                  <div className="absolute inset-0 z-40 pointer-events-none">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
                      <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-black/70 border border-white/15 shadow-lg backdrop-blur-md">
                        <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                        <span className="text-sm text-white/90 font-medium whitespace-nowrap">
                          {updatingStepText}
                        </span>
                        <div className="flex gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:0ms]" />
                          <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:150ms]" />
                          <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:300ms]" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
          isLoading={projectsLoading}
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
    </>
  );
}

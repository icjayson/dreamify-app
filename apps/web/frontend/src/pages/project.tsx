import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Pencil, SquareArrowOutUpRight } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { Message } from "@/types/message";

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
  const uploadedFile = useChatStore((s) => s.uploadedFile);
  const isInitialLoading = useChatStore((s) => s.isInitialLoading);
  const hasPolledStatus = uploadedFile?.status === 'processing' || uploadedFile?.status === 'processed' || uploadedFile?.status === 'error';
  const { user } = useUser();
  const { toast } = useToast();
  const displayName = user?.username || user?.fullName || user?.firstName || "you";
  const setMessages = useChatStore((s) => s.setMessages);
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId);
  const setHasShownInitialDashboard = useChatStore((s) => s.setHasShownInitialDashboard);

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
      
      const restoredMessages: Message[] = nodes
        .filter((node: any) => {
          if (!node) return false;
          if (node.role === 'user') return true;
          if (node.role === 'assistant') {
            const metadata = node.metadata || {};
            const hasToolCalls = Array.isArray(metadata.tool_calls) && metadata.tool_calls.length > 0;
            if (hasToolCalls || metadata.tool_call_id) return false;
            const hasRenderableContent = node.contents?.some?.((c: any) => {
              if (c?.type === 'text') {
                const text = c?.data?.text;
                return typeof text === 'string' && text.trim().length > 0;
              }
              return c?.type === 'dashboard';
            });
            return !!hasRenderableContent;
          }
          return false;
        })
        .map((node: any) => {
          const textContent = node?.contents?.find?.((c: any) => c?.type === 'text');
          const dashboardContent = node?.contents?.find?.((c: any) => c?.type === 'dashboard');
          const assetContent = node?.contents?.find?.((c: any) => c?.type === 'asset' || c?.type === 'attachment' || c?.type === 'file');
          const normalized: Message = {
            id: node?.node_id || crypto.randomUUID(),
            role: node?.role === 'user' ? 'user' : 'assistant',
            content: textContent?.data?.text || "",
            timestamp: new Date(node?.created_at || Date.now()),
          };
          if (dashboardContent) {
            normalized.dashboardCard = {
              sourceFileName: assetName,
            };
          }
          if (assetContent?.data) {
            normalized.attachment = {
              kind: assetContent?.data?.kind === 'file' ? 'file' : 'csv',
              name: assetContent?.data?.filename || assetContent?.data?.name || assetName,
              mime: assetContent?.data?.mime,
            };
          }
          return normalized;
        });
      if (restoredMessages.length) {
        setMessages(restoredMessages);
      }
      setCurrentConversationId(conversationId);

      const dashboardResponse = await conversationService.getDashboardData(conversationId, projId);
      if (dashboardResponse?.dashboard_data && primaryAsset) {
        const restoredFile = {
          fileID: primaryAsset.file_id || primaryAsset.asset_id || 'restored',
          filename: primaryAsset.filename || 'data.csv',
          size: primaryAsset.size_bytes || 0,
          ext: primaryAsset.extension || '',
          status: 'processed' as const,
          projectId: projId,
          conversationId,
          processedData: dashboardResponse.dashboard_data,
        };
        useChatStore.getState().setUploadedFile(restoredFile);
        setProcessedData(dashboardResponse.dashboard_data);
        setHasShownInitialDashboard(true);
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

  // Reset and hydrate when project changes
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    const loadProject = async () => {
      setIsProjectLoading(true);
      useChatStore.getState().resetChat();
      useFileStore.getState().resetFileState();
      try {
        const response = await projectService.getProject(projectId);
        if (!cancelled) {
          if (response.success && response.project) {
            const displayTitle = response.project.name || response.project.dashboard_title || "Untitled Project";
            setProjectTitle(displayTitle);
            const latestConversationId = response.project.latest_conversation_id;
            if (latestConversationId) {
              await hydrateConversation(response.project.id, latestConversationId);
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
    };
  }, [projectId, hydrateConversation, toast]);
  
  // Mirror processed data from store for rendering (optional local state)
  // Keep compatibility with existing DashboardPreview API
  if (!processedData && uploadedFile?.processedData) {
    try { setProcessedData(uploadedFile.processedData); } catch (_e) {}
  }

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="px-4 py-2">
        <div className="flex items-center justify-between h-10">
          <div className="flex items-center gap-3 min-w-0">
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
            <button onClick={() => setIsPublishOpen(true)} className="button-gradient h-8 px-4 rounded-md text-sm text-white flex items-center"><span>Publish</span>
              <SquareArrowOutUpRight className="w-4 h-4 ml-2" />
            </button>
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
        {/* chatinterface */}
        <div className="grid grid-cols-1 lg:grid-cols-4 h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)] min-h-0">
            <div className={`${activeTab === 'chat' ? 'block' : 'hidden'} lg:col-span-1 lg:block`}>
            <div className=" bg-muted  h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)] min-h-0">
                <div>
                <div className="px-1 h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)]" data-chat-root>
                    <ChatInterface projectId={projectId ?? undefined} onSwitchToDashboard={() => setActiveTab('dashboard')} />
                </div>
                </div>
            </div>
        </div>
      
        {/* blank placeholder */}
        <div className={`${activeTab === 'dashboard' ? 'block' : 'hidden'} lg:col-span-3 lg:block`}>
           <div className="mr-2 sm:ml-0 ml-2 mt-0 mb-0 rounded-lg border border-white/20 h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)]">
            {!hasPolledStatus ? (
              <BlankState
                subtexts={[
                  "Upload a CSV file and let Morpheus build dashboard",
                  "Connect Google Sheets, GA4, Meta, Stripe, and more",
                  "Describe your dashboard — Morpheus designs it instantly",
                  "Cinematic motion and clear storytelling for your data",
                  "Try now to observe Morpheus's capabilities",
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
                  } catch (_e) {}
                }}
                onConnectDataSource={() => {
                  try {
                    useChatStore.getState().setDropdownOpen(true);
                    const el = document.querySelector('[data-chat-root]');
                    if (el && 'scrollIntoView' in el) {
                      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  } catch (_e) {}
                }}
                onUseSample={() => {
                  try {
                    useChatStore.getState().setInputValue('Use sample data and create a demo dashboard');
                    const el = document.querySelector('[data-chat-root]');
                    if (el && 'scrollIntoView' in el) {
                      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  } catch (_e) {}
                }}
              />
            ) : (
              isProjectLoading ? (
                <DashboardLoading title="Loading Project" description="Restoring your dashboard..." durationSec={5} />
              ) : uploadedFile?.status === 'processing' ? (
                <DashboardLoading title="Generating Dashboard" description="Please wait while we build your dashboard..." durationSec={10} />
              ) : isInitialLoading ? (
                <DashboardLoading title="Generating Dashboard" description="Please wait while we build your dashboard..." durationSec={10} />
              ) : (uploadedFile?.status === 'processed' && processedData) ? (
                <DashboardPreview processedData={processedData} className="h-full overflow-y-auto" />
              ) : (
                <DashboardLoading title="Preparing Dashboard" description="Please wait..." durationSec={10} />
              )
            )}
          </div>
        </div>
      </div>
      {/* Publish Modal */}
      {isPublishOpen && <PublishModal open={isPublishOpen} onOpenChange={setIsPublishOpen} projectId={projectId ?? undefined} />}
    </div>
  );
}

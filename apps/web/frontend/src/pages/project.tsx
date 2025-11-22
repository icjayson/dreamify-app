import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, SquareArrowOutUpRight } from "lucide-react";
import ChatInterface from "@/chat/ChatInterface";
import DashboardPreview from "@/components/project-section/DashboardPreview";
import DashboardLoading from "@/components/project-section/DashboardLoading";
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import BlankState from "@/components/project-section/BlankState";
import { useUser } from "@clerk/clerk-react";
import PublishModal from "@/components/project-section/PublishModal";

export default function ProjectPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [processedData, setProcessedData] = useState<any>(null);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'dashboard'>('chat');
  const uploadedFile = useChatStore((s) => s.uploadedFile);
  const isInitialLoading = useChatStore((s) => s.isInitialLoading);
  const hasPolledStatus = uploadedFile?.status === 'processing' || uploadedFile?.status === 'processed' || uploadedFile?.status === 'error';
  const { user } = useUser();
  const displayName = user?.username || user?.fullName || user?.firstName || "you";

  // Reset chat and file store when projectId changes
  useEffect(() => {
    if (projectId) {
      // Reset chat store for new project
      useChatStore.getState().resetChat();
      // Reset file store
      useFileStore.getState().resetFileState();
    }
  }, [projectId]);
  
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
              <span className="font-regular text-sm truncate" title="project-name">project-name</span>
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
                    <ChatInterface onSwitchToDashboard={() => setActiveTab('dashboard')} />
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
              uploadedFile?.status === 'processing' ? (
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
      {isPublishOpen && <PublishModal open={isPublishOpen} onOpenChange={setIsPublishOpen} />}
    </div>
  );
}

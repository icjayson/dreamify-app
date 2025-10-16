import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, SquareArrowOutUpRight } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";
import DashboardPreview from "@/components/DashboardPreview";
import DashboardLoading from "@/components/DashboardLoading";
import { useChatStore } from "@/stores/useChatStore";
import BlankState from "@/components/BlankState";
import { useUser } from "@clerk/clerk-react";
import PublishModal from "@/components/PublishModal";

export default function ProjectPage() {
  const navigate = useNavigate();
  const [processedData, setProcessedData] = useState<any>(null);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const uploadedFile = useChatStore((s) => s.uploadedFile);
  const isInitialLoading = useChatStore((s) => s.isInitialLoading);
  const hasPolledStatus = uploadedFile?.status === 'processing' || uploadedFile?.status === 'processed' || uploadedFile?.status === 'error';
  const { user } = useUser();
  const displayName = user?.username || user?.fullName || user?.firstName || "you";

  
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
            <button onClick={() => setIsPublishOpen(true)} className="button-gradient h-8 px-4 rounded-md text-sm text-white flex items-center">              <span>Publish</span>
              <SquareArrowOutUpRight className="w-4 h-4 ml-2" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
        {/* chatinterface */}
        <div className="grid grid-cols-1 lg:grid-cols-4 h-[calc(100vh-4rem)]">
            <div className="lg:col-span-1">
            <div className=" bg-muted h-[calc(100vh-4rem)] min-h-0">
                <div>
                <div className="px-1 h-[calc(100vh-4rem)]" data-chat-root>
                    <ChatInterface />
                </div>
                </div>
            </div>
        </div>
      
        {/* blank placeholder */}
        <div className="lg:col-span-3">
           <div className="m-2 ml-0 mt-0 rounded-lg border border-white/20 h-[calc(100vh-4rem)]">
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

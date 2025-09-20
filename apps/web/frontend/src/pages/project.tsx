import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";
import DashboardPreview from "@/components/DashboardPreview";
import { useChatStore } from "@/stores/useChatStore";
import BlankState from "@/components/BlankState";

export default function ProjectPage() {
  const navigate = useNavigate();
  const [processedData, setProcessedData] = useState<any>(null);
  const uploadedFile = useChatStore((s) => s.uploadedFile);
  const hasPolledStatus = uploadedFile?.status === 'processing' || uploadedFile?.status === 'processed' || uploadedFile?.status === 'error';

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="px-4 py-2">
        <div className="grid grid-cols-4 items-center h-10">
          <div className="col-span-1">
            <div className="flex items-center gap-3">
              <img src="/dreamable-logo.png" alt="Dreamable" className="w-6 h-6 rounded" />
              <span className="font-regular text-sm truncate">project-name</span>
            </div>
          </div>
          <div className="col-span-3">
            <div className="flex items-center justify-between h-10">
              <button onClick={() => navigate('/workspace')} className="button-outline h-8 px-4 rounded-md text-sm flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button onClick={() => { try { if (processedData) { sessionStorage.setItem('project_preview_data', JSON.stringify(processedData)); } } catch (_e) {} window.open('/workspace/project/preview', '_blank'); }} className="button-gradient h-8 px-4 rounded-md text-sm text-white">
                Publish
              </button>
            </div>
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
                    <ChatInterface onProcessedDataChange={setProcessedData} />
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
                  "Upload a CSV file and let Nyx build dashboard",
                  "Connect Google Sheets, GA4, Meta, Stripe, and more",
                  "Describe your dashboard — Nyx designs it instantly",
                  "Cinematic motion and clear storytelling for your data",
                  "Try now to observe Nyx's capabilities",
                ]}
                intervalMs={1000}
                onWatchTutorial={() => window.open('/tutorial', '_blank')}
                onUploadData={() => {
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
              <DashboardPreview processedData={processedData} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

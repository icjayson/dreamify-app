import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";
import DashboardPreview from "@/components/DashboardPreview";

export default function ProjectPage() {
  const navigate = useNavigate();
  const [processedData, setProcessedData] = useState<any>(null);

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
      <div className="grid grid-cols-1 lg:grid-cols-4 h-[calc(100vh-4rem)]">
        <div className="lg:col-span-1">
          <div className=" bg-muted h-[calc(100vh-4rem)] min-h-0">
            <div>
              <div className="px-1 h-[calc(100vh-4rem)]">
                <ChatInterface onProcessedDataChange={setProcessedData} />
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="m-2 ml-0 mt-0 rounded-lg border h-[calc(100vh-4rem)]">
            <DashboardPreview processedData={processedData} />
          </div>
        </div>
      </div>
    </div>
  );
}

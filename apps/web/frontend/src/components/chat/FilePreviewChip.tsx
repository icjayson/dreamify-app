import { Loader2, FileText, X, Sparkles } from "lucide-react";
import { type UploadedFile } from "@/chat/useChatStore";

interface FilePreviewChipProps {
  file: UploadedFile;
  onRemove: () => void;
}

const FilePreviewChip = ({ file, onRemove }: FilePreviewChipProps) => {
  const isProcessing = file.status === 'uploading' || file.status === 'processing' || file.status === 'accepted';
  const sType = file.sourceType || '';
  const isGA4 = sType.includes('GA4') || sType.includes('Google Analytics') || sType.includes('integration_ga4');
  const isSheets = sType.includes('Sheets') || sType.includes('gsheets') || sType.includes('integration_gsheets');
  const isIntegration = isGA4 || isSheets;

  // Render the "Live Status" group: App Logo (always prioritized)
  const renderLiveStatus = () => {
    // Show branded logo if it's an integration, regardless of processing status
    if (isIntegration) {
      return (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isGA4 ? (
            <img src="/GA4.png" alt="GA4" className="w-4 h-4 object-contain" />
          ) : isSheets ? (
            <img src="/google-sheet.png" alt="Sheets" className="w-4 h-4 object-contain" />
          ) : null}
        </div>
      );
    }

    if (isProcessing) {
      if (file.status === 'processing' || file.status === 'accepted') {
        return <Sparkles className="w-4 h-4 text-accent animate-pulse" />;
      }
      return <Loader2 className="w-4 h-4 text-white/70 animate-spin" />;
    }

    return (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <FileText className="w-4 h-4 text-white/70" />
      </div>
    );
  };

  const getAppShortName = () => {
    if (isGA4) return "GA4";
    if (isSheets) return "Sheets";
    return "";
  };

  const getContextText = () => {
    if (isGA4) return file.propertyName || file.filename;
    if (isSheets) return file.filename.replace(/\.[^/.]+$/, "");
    return file.filename;
  };

  return (
    <div className="group relative flex items-center gap-2.5 px-3 py-2 bg-[#1e1e1e] border border-white/10 rounded-full overflow-hidden transition-all hover:border-white/20">
      {/* Live Status Icon Group */}
      {renderLiveStatus()}

      {/* Structured Text */}
      <div className="flex items-center gap-1.5 text-xs">
        {isIntegration && (
          <>
            <span className="text-white font-semibold flex-shrink-0">
              {getAppShortName()}
            </span>
            <span className="text-white/30 font-light mr-0.5">•</span>
          </>
        )}
        <span 
          className="text-gray-400 truncate max-w-[150px]" 
          title={isGA4 ? `${file.accountName} / ${file.propertyName}` : file.filename}
        >
          {getContextText()}
        </span>
      </div>

      {/* Remove Button - visible on hover */}
      <button
        onClick={onRemove}
        className="ml-1 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
        aria-label="Remove correlation"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

export default FilePreviewChip;

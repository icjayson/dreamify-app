import { Loader2, FileText, X, Sparkles } from "lucide-react";
import { type UploadedFile } from "@/chat/useChatStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface FilePreviewChipProps {
  file: UploadedFile;
  onRemove: () => void;
}

const FilePreviewChip = ({ file, onRemove }: FilePreviewChipProps) => {
  const isProcessing = file.status === 'uploading' || file.status === 'processing' || file.status === 'accepted';
  const sType = file.sourceType || '';
  const isGA4 = sType.includes('GA4') || sType.includes('Google Analytics') || sType.includes('integration_ga4');
  const isSheets = sType.includes('Sheets') || sType.includes('gsheets') || sType.includes('integration_gsheets');
  const isMeta = sType.includes('Meta Ads') || sType.includes('meta_ads');
  const isGoogleAds = sType.includes('Google Ads');
  const isFirebase = sType.includes('Firebase');
  const isIntegration = isGA4 || isSheets || isMeta || isGoogleAds || isFirebase;


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
          ) : isMeta ? (
            <img src="/meta.png" alt="Meta" className="w-4 h-4 object-contain" />
          ) : isGoogleAds ? (
            <img src="/google-ads.svg" alt="Google Ads" className="w-4 h-4 object-contain" />
          ) : isFirebase ? (
            <img src="/firebase.svg" alt="Firebase" className="w-4 h-4 object-contain" />
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
    if (isMeta) return "Meta";
    if (isGoogleAds) return "Google Ads";
    if (isFirebase) return "Firebase";
    return "";
  };

  const getContextText = () => {
    if (isGA4) return file.propertyName || file.filename;
    if (isSheets) return file.filename.replace(/\.[^/.]+$/, "");
    if (isMeta) return file.propertyName || file.accountName || file.filename;
    if (isGoogleAds) return file.accountName || file.filename;
    if (isFirebase) return file.accountName || file.filename;
    return file.filename;
  };

  const tooltipText = isGA4 ? `${file.accountName} / ${file.propertyName}` : file.filename;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex max-w-[min(18rem,85vw)] flex-shrink-0 cursor-default items-center gap-2 rounded-full border border-white/10 bg-[#1e1e1e] px-3 py-2 transition-all hover:border-white/20 outline-none">
          {renderLiveStatus()}

          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
            {isIntegration && (
              <>
                <span className="flex-shrink-0 font-semibold text-white">
                  {getAppShortName()}
                </span>
                <span className="flex-shrink-0 font-light text-white/30">•</span>
              </>
            )}
            <span className="min-w-0 flex-1 truncate text-gray-400" title={getContextText()}>
              {getContextText()}
            </span>

          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-gray-500 transition-colors hover:text-white"
            aria-label="Remove correlation"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="max-w-[260px] bg-black/90 text-xs text-white shadow-lg break-words"
      >
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
};

export default FilePreviewChip;

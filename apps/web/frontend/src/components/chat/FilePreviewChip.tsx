import { FileText, X, Sparkles } from "lucide-react";
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
  const isTikTok = sType.includes('TikTok') || sType.includes('tiktok') || sType.includes('integration_tiktok');
  const isGoogleAds = sType.includes('Google Ads');
  const isFirebase = sType.includes('Firebase');
  const isAppsFlyer = sType.includes('AppsFlyer') || sType.includes('appsflyer');
  const isStripe = sType.includes('Stripe');
  const isIntegration = isGA4 || isSheets || isMeta || isTikTok || isGoogleAds || isFirebase || isAppsFlyer || isStripe;

  const isLocalUploading = !isIntegration && file.status === 'uploading';
  const uploadProgress = file.uploadProgress ?? 0;

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
          ) : isTikTok ? (
            <img src="/tiktok.png" alt="TikTok" className="w-4 h-4 object-contain" />
          ) : isGoogleAds ? (
            <img src="/google-ads.png" alt="Google Ads" className="w-4 h-4 object-contain" />
          ) : isFirebase ? (
            <img src="/firebase.png" alt="Firebase" className="w-4 h-4 object-contain" />
          ) : isAppsFlyer ? (
            <img src="/appsflyer.png" alt="AppsFlyer" className="w-4 h-4 object-contain" />
          ) : isStripe ? (
            <img src="/stripe.png" alt="Stripe" className="w-4 h-4 object-contain rounded-sm" />
          ) : null}
        </div>
      );
    }

    if (isProcessing) {
      if (file.status === 'processing' || file.status === 'accepted') {
        return <Sparkles className="w-4 h-4 text-accent animate-pulse flex-shrink-0" />;
      }
      // Local file uploading — show file icon (progress bar is rendered separately)
      return <FileText className="w-4 h-4 text-green-500 flex-shrink-0" />;
    }

    return (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <FileText className="w-4 h-4 text-muted-foreground dark:text-white/70" />
      </div>
    );
  };

  const getAppShortName = () => {
    if (isGA4) return "GA4";
    if (isSheets) return "Sheets";
    if (isMeta) return "Meta";
    if (isTikTok) return "TikTok";
    if (isGoogleAds) return "Google Ads";
    if (isFirebase) return "Firebase";
    if (isAppsFlyer) return "AppsFlyer";
    if (isStripe) return "Stripe";
    return "";
  };

  const getContextText = () => {
    if (isGA4) return file.propertyName || file.filename;
    if (isSheets) return file.filename.replace(/\.[^/.]+$/, "");
    if (isMeta) return file.propertyName || file.accountName || file.filename;
    if (isTikTok) return file.accountName || file.filename;
    if (isGoogleAds) return file.accountName || file.filename;
    if (isFirebase) return file.accountName || file.filename;
    if (isAppsFlyer) return file.accountName || file.filename;
    if (isStripe) return file.accountName || file.filename;
    return file.filename;
  };

  const tooltipText = isGA4 ? `${file.accountName} / ${file.propertyName}` : file.filename;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex max-w-[min(18rem,85vw)] flex-shrink-0 cursor-default items-center gap-2 rounded-full border border-border bg-background dark:bg-[#1e1e1e] px-3 py-2 transition-all hover:bg-muted dark:hover:bg-white/5 outline-none shadow-sm dark:shadow-none">
          {renderLiveStatus()}

          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
            {isIntegration && (
              <div className="flex items-center gap-1.5">
                <span className="flex-shrink-0 font-semibold text-foreground dark:text-white">
                  {getAppShortName()}
                </span>
                <span className="flex-shrink-0 font-light text-muted-foreground/30">•</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground dark:text-gray-400" title={getContextText()}>
                  {getContextText()}
                </span>
              </div>
            )}
            {!isIntegration && (
              <span className="min-w-0 flex-1 truncate text-muted-foreground dark:text-gray-400" title={getContextText()}>
                {getContextText()}
              </span>
            )}
            {isLocalUploading && (
              <div className="flex items-center gap-1.5 w-full">
                <div className="flex-1 h-1 bg-muted dark:bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="flex-shrink-0 text-[10px] text-muted-foreground dark:text-gray-400 tabular-nums">
                  {uploadProgress}%
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground dark:hover:text-white"
            aria-label="Remove file"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="max-w-[260px] bg-popover text-xs text-popover-foreground border border-border shadow-lg break-words"
      >
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
};

export default FilePreviewChip;

import { Loader2, FileText, X, Link, BarChart3 } from "lucide-react";
import { type UploadedFile } from "@/chat/useChatStore";

interface FilePreviewChipProps {
  file: UploadedFile;
  onRemove: () => void;
}

const FilePreviewChip = ({ file, onRemove }: FilePreviewChipProps) => {
  const isProcessing = file.status === 'uploading' || file.status === 'processing';
  const isIntegration = !!file.sourceType;

  // Render an appropriate icon based on the source type.
  const renderIcon = () => {
    if (isProcessing) {
      return <Loader2 className="w-4 h-4 text-white/70 animate-spin" />;
    }

    if (isIntegration) {
      if (file.sourceType === 'GA4') {
        return (
          <img src="/GA4.png" alt="GA4 Logo" className="w-5 h-5 object-contain" />
        );
      }
      return <Link className="w-4 h-4 text-white/70" />;
    }

    return <FileText className="w-4 h-4 text-white/70" />;
  };

  return (
    <div className="group relative flex w-full min-w-0 items-center gap-2 p-2 pr-6 bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden">
      {/* File Icon */}
      <div className="flex-shrink-0">
        {renderIcon()}
      </div>

      {/* Filename or Integration Name */}
      <span className="text-xs text-white truncate min-w-0 flex-1 max-w-[280px]" title={isIntegration ? `${file.sourceType} Data Connected` : file.filename}>
        {isIntegration ? `${file.sourceType} Data` : file.filename}
      </span>

      {/* Extension or Status Badge */}
      <span className="text-xs flex-shrink-0 flex items-center gap-1">
        {isIntegration ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            <span className="text-green-500/90 font-medium">Connected</span>
          </>
        ) : (
          <span className="text-white/60">{file.ext.toUpperCase()}</span>
        )}
      </span>

      {/* Remove Button - visible on hover */}
      <button
        onClick={onRemove}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-red-500/80 hover:bg-red-600 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        aria-label="Remove file"
      >
        <X className="w-3 h-3 text-white" />
      </button>
    </div>
  );
};

export default FilePreviewChip;

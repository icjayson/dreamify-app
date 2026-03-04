import { Loader2, FileText, X } from "lucide-react";
import { type UploadedFile } from "@/chat/useChatStore";

interface FilePreviewChipProps {
  file: UploadedFile;
  onRemove: () => void;
}

const FilePreviewChip = ({ file, onRemove }: FilePreviewChipProps) => {
  const isProcessing = file.status === 'uploading' || file.status === 'processing';

  return (
    <div className="group relative flex w-full min-w-0 items-center gap-2 p-2 pr-6 bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden">
      {/* File Icon */}
      <div className="flex-shrink-0">
        {isProcessing ? (
          <Loader2 className="w-4 h-4 text-white/70 animate-spin" />
        ) : (
          <FileText className="w-4 h-4 text-white/70" />
        )}
      </div>

      {/* Filename */}
      <span className="text-xs text-white truncate min-w-0 flex-1 max-w-[280px]" title={file.filename}>
        {file.filename}
      </span>

      {/* Extension Badge */}
      <span className="text-xs text-white/60 flex-shrink-0">
        {file.ext.toUpperCase()}
      </span>

      {/* Remove Button - visible on hover */}
      <button
        onClick={onRemove}
        className="absolute -right-1 -top-1 w-4 h-4 bg-red-500/80 hover:bg-red-600 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        aria-label="Remove file"
      >
        <X className="w-3 h-3 text-white" />
      </button>
    </div>
  );
};

export default FilePreviewChip;

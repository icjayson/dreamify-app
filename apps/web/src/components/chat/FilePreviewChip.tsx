import { type UploadedFile } from "@/chat/useChatStore";
import { DataContextInlineToken } from "@/components/chat/DataContextInlineToken";

interface FilePreviewChipProps {
  file: UploadedFile;
  onRemove: () => void;
}

const FilePreviewChip = ({ file, onRemove }: FilePreviewChipProps) => {
  if (file.status === "processed" || file.status === "error") return null;

  return (
    <DataContextInlineToken
      source={file}
      status={file.schemaOnly ? "schemaOnly" : file.status}
      uploadProgress={file.uploadProgress}
      onRemove={onRemove}
      variant="composer"
    />
  );
};

export default FilePreviewChip;

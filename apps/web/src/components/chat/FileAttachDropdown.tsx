import React, { useState, useEffect, useRef } from "react";
import {
  File,
  Upload,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import { fileService, type FileItem } from "@/services/fileService";
import { useChatStore, type UploadedFile } from "@/chat/useChatStore";
import { cn } from "@/lib/utils";
import { formatToDisplay } from "@/utils/timestamp";
import { useToast } from "@/hooks/use-toast";

interface FileAttachDropdownProps {
  /** Called when the user chooses "Upload" */
  onUpload: () => void;
  disabled?: boolean;
  /** Compact = icon-only trigger (used in ChatInterface toolbar) */
  compact?: boolean;
  /** Clone selected existing files into the active prompt project before attaching. */
  cloneToProject?: boolean;
  className?: string;
}

function fileIcon(ext: string) {
  const e = (ext || "").toLowerCase().replace(".", "");
  if (["csv", "xlsx", "xls"].includes(e))
    return <FileSpreadsheet className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  return <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />;
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  return formatToDisplay(dateStr, { format: "date", locale: "en-US" });
}

export default function FileAttachDropdown({
  onUpload,
  disabled,
  compact,
  cloneToProject,
  className,
}: FileAttachDropdownProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "files">("main");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectingFileId, setSelectingFileId] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const addFiles = useChatStore((s) => s.addFiles);
  const { toast } = useToast();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setView("main");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setView("main"); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => {
      if (!prev) setView("main");
      return !prev;
    });
  };

  const handleShowFiles = async () => {
    setView("files");
    setFileSearch("");
    setFilesLoading(true);
    try {
      const res = await fileService.listFiles();
      if (res.success) {
        const local = res.files.filter(
          (f) => !f.asset?.asset_type || f.asset.asset_type === "raw"
        );
        setFiles(local);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFilesLoading(false);
    }
  };

  const visibleFiles = files.filter((file) =>
    file.filename.toLowerCase().includes(fileSearch.trim().toLowerCase())
  );

  const handleSelectFile = async (file: FileItem) => {
    if (selectingFileId) return;
    if (!cloneToProject) {
      const uploaded: UploadedFile = {
        fileID: file.fileID,
        filename: file.filename,
        size: file.size,
        ext: file.ext || "",
        status: "uploaded",
        projectId: file.asset?.project_id,
        rowCount: file.asset?.row_count,
        columnCount: file.asset?.column_count,
      };
      addFiles([uploaded]);
      setOpen(false);
      setView("main");
      return;
    }
    setSelectingFileId(file.fileID);
    try {
      const existingProjectId = useChatStore.getState().currentProjectId || useChatStore.getState().uploadedFiles.find((uploadedFile) => uploadedFile.projectId)?.projectId;
      const result = existingProjectId
        ? await fileService.addAssetsToProject([file.fileID], existingProjectId)
        : await fileService.addAssetsToNewProject(
            [file.fileID],
            `${file.filename} Project`
          );
      const asset = result.assets[0];
      if (!result.success || !result.project?.id || !asset?.asset_id) {
        throw new Error(result.error || "Failed to add this file to the project.");
      }
      const uploaded: UploadedFile = {
        fileID: asset.asset_id,
        filename: asset.filename,
        size: asset.size_bytes,
        ext: asset.extension || "",
        status: "uploaded",
        projectId: result.project.id,
        rowCount: asset.row_count,
        columnCount: asset.column_count,
      };
      addFiles([uploaded]);
      setOpen(false);
      setView("main");
    } catch (error) {
      toast({
        title: "Could not add file",
        description: error instanceof Error ? error.message : "Failed to add this file to a new project.",
        variant: "destructive",
      });
    } finally {
      setSelectingFileId(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {/* ── Trigger ────────────────────────────────────────────────────────── */}
      <button
        onClick={handleToggle}
        disabled={disabled}
        aria-label="File options"
        className={cn(
          compact
            ? "p-2 flex items-center justify-center border border-border/50 dark:border-white/30 rounded-md text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-white transition-colors"
            : "px-3 py-1.5 text-sm button-outline rounded-md disabled:opacity-50 flex items-center gap-2",
          open && !compact && "bg-muted/40",
          className
        )}
      >
        <File className="w-4 h-4" />
        {!compact && (
          <span className="hidden sm:inline">File</span>
        )}
      </button>

      {/* ── Dropdown panel ─────────────────────────────────────────────────── */}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-[min(18rem,calc(100vw_-_2rem))] rounded-xl border border-border/50 bg-popover shadow-xl overflow-hidden z-[300] animate-in fade-in-0 zoom-in-95 duration-100">

          {view === "main" && (
            <>
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors text-left"
                onClick={() => { onUpload(); setOpen(false); }}
              >
                <Upload className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span>Upload</span>
              </button>
              <div className="h-px bg-border/40 mx-3" />
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors text-left"
                onClick={handleShowFiles}
              >
                <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1">Current Files</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            </>
          )}

          {view === "files" && (
            <>
              {/* Sub-header */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
                <button
                  onClick={() => setView("main")}
                  className="p-0.5 rounded hover:bg-muted/60 transition-colors"
                  aria-label="Back"
                >
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </button>
                <span className="text-sm font-medium">Current Files</span>
              </div>

              <div className="px-3 py-2 border-b border-border/30">
                <input
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Search files..."
                  className="h-8 w-full rounded-md border border-border/50 bg-background px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40"
                />
              </div>

              {/* File list */}
              <div className="max-h-60 overflow-y-auto">
                {filesLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : files.length === 0 ? (
                  <div className="px-3 py-5 text-xs text-muted-foreground text-center">
                    No files uploaded yet
                  </div>
                ) : visibleFiles.length === 0 ? (
                  <div className="px-3 py-5 text-xs text-muted-foreground text-center">
                    No files match your search
                  </div>
                ) : (
                  visibleFiles.map((f) => (
                    <button
                      key={f.fileID}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/60 transition-colors"
                      disabled={!!selectingFileId}
                      onClick={() => handleSelectFile(f)}
                    >
                      {fileIcon(f.ext)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate leading-snug">{f.filename}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(f.created_at)}
                        </p>
                      </div>
                      {selectingFileId === f.fileID && (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

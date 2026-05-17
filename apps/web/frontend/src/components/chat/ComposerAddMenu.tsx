import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileStack,
  FileText,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  Plus,
  Upload,
} from "lucide-react";
import { fileService, type FileItem } from "@/services/fileService";
import { useChatStore, type UploadedFile } from "@/chat/useChatStore";
import { cn } from "@/lib/utils";
import { formatToDisplay } from "@/utils/timestamp";
import { useToast } from "@/hooks/use-toast";

interface ComposerAddMenuProps {
  onUpload: () => void;
  onAddProjectContext: () => void;
  onChooseTheme: () => void;
  onOpen?: () => void;
  disabled?: boolean;
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  return formatToDisplay(dateStr, { format: "date", locale: "en-US" });
}

function fileIcon(ext: string) {
  const normalizedExt = (ext || "").toLowerCase().replace(".", "");
  if (["csv", "xlsx", "xls"].includes(normalizedExt)) {
    return <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-emerald-500" />;
  }
  return <FileText className="h-4 w-4 flex-shrink-0 text-blue-500" />;
}

export function ComposerAddMenu({
  onUpload,
  onAddProjectContext,
  onChooseTheme,
  onOpen,
  disabled,
}: ComposerAddMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "files">("main");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectingFileId, setSelectingFileId] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const addFiles = useChatStore((state) => state.addFiles);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setView("main");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setView("main");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    setView("main");
  };

  const toggleOpen = () => {
    if (disabled) return;
    setOpen((current) => {
      const next = !current;
      if (next) {
        setView("main");
        onOpen?.();
      }
      return next;
    });
  };

  const showFiles = async () => {
    setView("files");
    setFileSearch("");
    setFilesLoading(true);
    try {
      const response = await fileService.listFiles();
      if (response.success) {
        setFiles(response.files.filter((file) => !file.asset?.asset_type || file.asset.asset_type === "raw"));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setFilesLoading(false);
    }
  };

  const visibleFiles = files.filter((file) =>
    file.filename.toLowerCase().includes(fileSearch.trim().toLowerCase())
  );

  const selectExistingFile = async (file: FileItem) => {
    if (selectingFileId) return;
    setSelectingFileId(file.fileID);
    try {
      const existingProjectId =
        useChatStore.getState().currentProjectId ||
        useChatStore.getState().uploadedFiles.find((uploadedFile) => uploadedFile.projectId)?.projectId;
      const result = existingProjectId
        ? await fileService.addAssetsToProject([file.fileID], existingProjectId)
        : await fileService.addAssetsToNewProject([file.fileID], `${file.filename} Project`);
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
      closeMenu();
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
    <div className="composer-add-menu relative" ref={ref}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        aria-label="Add content"
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 dark:border-white/30 dark:text-gray-400 dark:hover:text-white",
          open && "bg-muted text-foreground dark:bg-white/10 dark:text-white"
        )}
      >
        <Plus className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-45")} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[300] mb-2 w-[min(19rem,calc(100vw_-_2rem))] overflow-hidden rounded-xl border border-border/50 bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-100 dark:border-white/15">
          {view === "main" ? (
            <div className="p-2">
              <MenuSectionLabel>Files</MenuSectionLabel>
              <MenuAction icon={<Upload className="h-4 w-4" />} label="Upload file" onClick={() => { closeMenu(); onUpload(); }} />
              <MenuAction icon={<FolderOpen className="h-4 w-4" />} label="Current files" onClick={showFiles} trailing={<ChevronRight className="h-4 w-4" />} />

              <MenuDivider />
              <MenuSectionLabel>Context</MenuSectionLabel>
              <MenuAction
                className="project-context-trigger"
                icon={<FileStack className="h-4 w-4" />}
                label="Add project context"
                onClick={() => { closeMenu(); onAddProjectContext(); }}
              />

              <MenuDivider />
              <MenuSectionLabel>Appearance</MenuSectionLabel>
              <MenuAction icon={<LayoutTemplate className="h-4 w-4" />} label="Choose theme" onClick={() => { closeMenu(); onChooseTheme(); }} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2.5 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setView("main")}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium">Current files</span>
              </div>
              <div className="border-b border-border/30 px-3 py-2 dark:border-white/10">
                <input
                  value={fileSearch}
                  onChange={(event) => setFileSearch(event.target.value)}
                  placeholder="Search files..."
                  className="h-8 w-full rounded-md border border-border/50 bg-background px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40 dark:border-white/15"
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {filesLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : files.length === 0 ? (
                  <div className="px-3 py-5 text-center text-xs text-muted-foreground">No files uploaded yet</div>
                ) : visibleFiles.length === 0 ? (
                  <div className="px-3 py-5 text-center text-xs text-muted-foreground">No files match your search</div>
                ) : (
                  visibleFiles.map((file) => (
                    <button
                      key={file.fileID}
                      type="button"
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-70 dark:hover:bg-white/10"
                      disabled={!!selectingFileId}
                      onClick={() => selectExistingFile(file)}
                    >
                      {fileIcon(file.ext)}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-snug">{file.filename}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(file.created_at)}</p>
                      </div>
                      {selectingFileId === file.fileID && (
                        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
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

function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground dark:text-white/35">
      {children}
    </p>
  );
}

function MenuDivider() {
  return <div className="mx-2 my-1.5 h-px bg-border/50 dark:bg-white/10" />;
}

function MenuAction({
  icon,
  label,
  trailing,
  onClick,
  className,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  onClick: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-muted dark:hover:bg-white/10",
        compact ? "px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground dark:text-white/50 dark:hover:text-white" : "px-2 py-2 text-sm",
        className
      )}
    >
      <span className={cn("flex-shrink-0", compact ? "text-muted-foreground" : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing && <span className="ml-auto flex-shrink-0 text-muted-foreground">{trailing}</span>}
    </button>
  );
}

import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "@/lib/navigation";
import {
  Search,
  Download,
  Trash2,
  CloudUpload,
  FileSpreadsheet,
  FileText,
  File,
  MoreVertical,
  ChevronUp,
  ChevronDown,
  HardDrive,
  RefreshCw,
  X,
  FolderPlus,
  Eye,
  Check,
} from "lucide-react";
import CsvPreviewPanel from "@/components/project-section/CsvPreviewPanel";
import { useUser } from "@/lib/clerk";
import { cn } from "@/lib/utils";
import { fileService, type FileItem } from "@/services/fileService";
import { useChatStore } from "@/chat/useChatStore";
import type { UploadedFile } from "@/chat/useChatStore";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

const EXT_CONFIG: Record<string, { bg: string; icon: string; label: string }> = {
  csv:  { bg: "bg-emerald-500/15 dark:bg-emerald-500/10", icon: "text-emerald-600 dark:text-emerald-400", label: "CSV"  },
  xlsx: { bg: "bg-green-500/15 dark:bg-green-500/10",     icon: "text-green-600 dark:text-green-400",     label: "XLSX" },
  xls:  { bg: "bg-green-500/15 dark:bg-green-500/10",     icon: "text-green-600 dark:text-green-400",     label: "XLS"  },
  html: { bg: "bg-blue-500/15 dark:bg-blue-500/10",       icon: "text-blue-600 dark:text-blue-400",       label: "HTML" },
  htm:  { bg: "bg-blue-500/15 dark:bg-blue-500/10",       icon: "text-blue-600 dark:text-blue-400",       label: "HTML" },
};

function FileTypeIcon({ ext, size = "md" }: { ext: string; size?: "sm" | "md" }) {
  const e = (ext || "").toLowerCase().replace(/^\./, "");
  const cfg = EXT_CONFIG[e];
  const dim = size === "sm" ? "w-7 h-7" : "w-9 h-9";
  const iconDim = size === "sm" ? "w-4 h-4" : "w-[18px] h-[18px]";
  const bg = cfg?.bg ?? "bg-foreground/8";
  const iconCls = cfg?.icon ?? "text-muted-foreground";
  const IconEl = e === "html" || e === "htm" ? FileText : e === "csv" || e === "xlsx" || e === "xls" ? FileSpreadsheet : File;
  return (
    <div className={cn("rounded-lg flex items-center justify-center flex-shrink-0", dim, bg)}>
      <IconEl className={cn(iconDim, iconCls)} />
    </div>
  );
}

function ExtBadge({ ext }: { ext: string }) {
  const e = (ext || "").toLowerCase().replace(/^\./, "");
  const cfg = EXT_CONFIG[e];
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
        cfg ? `${cfg.bg} ${cfg.icon}` : "bg-foreground/8 text-muted-foreground"
      )}
    >
      {(cfg?.label ?? e.toUpperCase()) || "FILE"}
    </span>
  );
}

type SortField = "filename" | "size" | "created_at";

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkspaceFiles() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField | null>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>("desc");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ name: string; progress: number }[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [addingToProject, setAddingToProject] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const navigate = useNavigate();
  const { isSignedIn } = useUser();
  const setPendingFilesForNewChat = useChatStore((s) => s.setPendingFilesForNewChat);
  const currentProjectId = useChatStore((s) => s.currentProjectId);

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchFiles = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
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
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // ── Close menu on outside click ──────────────────────────────────────────────
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  // ── Sort / filter ─────────────────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField !== field) {
      // New column: start asc
      setSortField(field);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      // 3rd click: clear sort
      setSortField(null);
      setSortDir(null);
    }
  };

  // ── Deduplication ─────────────────────────────────────────────────────────────
  // Group by (filename + size + checksum_sha256). Keep only the newest per group.
  // Files without a checksum fall back to filename+size key.
  const deduplicatedFiles = (() => {
    const hashGroups = new Map<string, FileItem>();
    const result: FileItem[] = [];
    for (const f of files) {
      // Only deduplicate when a real content hash exists
      if (!f.checksum_sha256) {
        result.push(f);
        continue;
      }
      const existing = hashGroups.get(f.checksum_sha256);
      if (!existing) {
        hashGroups.set(f.checksum_sha256, f);
        result.push(f);
      } else {
        // Replace in result with the newer upload, keep older hidden
        const existingTime = existing.created_at ? new Date(existing.created_at).getTime() : 0;
        const currentTime = f.created_at ? new Date(f.created_at).getTime() : 0;
        if (currentTime > existingTime) {
          const idx = result.indexOf(existing);
          if (idx !== -1) result.splice(idx, 1, f);
          hashGroups.set(f.checksum_sha256, f);
        }
        // older duplicate is silently dropped
      }
    }
    return result;
  })();

  const hiddenDuplicateCount = files.length - deduplicatedFiles.length;

  const filteredFiles = deduplicatedFiles
    .filter((f) => f.filename.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (!sortField || !sortDir) return 0;
      const av = sortField === "filename" ? a.filename : sortField === "size" ? a.size : a.created_at || "";
      const bv = sortField === "filename" ? b.filename : sortField === "size" ? b.size : b.created_at || "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const allSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selected.has(f.fileID));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filteredFiles.map((f) => f.fileID)));
  };
  const toggleFile = (id: string) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const totalSize = deduplicatedFiles.reduce((acc, f) => acc + f.size, 0);

  // ── Upload ───────────────────────────────────────────────────────────────────
  const handleUploadFile = async (file: File) => {
    if (!isSignedIn) {
      toast({ title: "Authentication Required", description: "Please login to upload files.", variant: "destructive" });
      return;
    }
    const allowed = ["csv", "xlsx", "xls"];
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowed.includes(ext)) {
      toast({ title: "Unsupported file type", description: "Only CSV, XLSX, and XLS files are supported.", variant: "destructive" });
      return;
    }
    setUploadingFiles((prev) => [...prev, { name: file.name, progress: 0 }]);
    try {
      const res = await fileService.uploadFile(file, {
        projectId: currentProjectId ?? undefined,
        onProgress: (p) =>
          setUploadingFiles((prev) =>
            prev.map((f) => (f.name === file.name ? { ...f, progress: Math.min(p, 95) } : f))
          ),
      });
      if (res.success) {
        toast({ title: "File uploaded", description: `${file.name} uploaded successfully.` });
        fetchFiles(true);
      } else {
        toast({ title: "Upload failed", description: res.error || "Upload failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload error", description: "Failed to upload file. Please try again.", variant: "destructive" });
    } finally {
      setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach(handleUploadFile);
    e.target.value = "";
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDeleteSelected = async () => {
    const ids = Array.from(selected);
    await Promise.allSettled(ids.map((id) => fileService.deleteFile(id)));
    setSelected(new Set());
    fetchFiles(true);
    toast({ title: `${ids.length} file${ids.length > 1 ? "s" : ""} deleted` });
  };

  const handleDeleteFile = async (fileID: string) => {
    await fileService.deleteFile(fileID);
    setSelected((prev) => { const s = new Set(prev); s.delete(fileID); return s; });
    fetchFiles(true);
    toast({ title: "File deleted" });
  };

  // ── Add to new project ───────────────────────────────────────────────────────
  const handleChatWithFiles = async (fileItems: FileItem[]) => {
    if (addingToProject || fileItems.length === 0) return;
    setAddingToProject(true);
    try {
      const projectName = fileItems.length === 1
        ? `${fileItems[0].filename} Project`
        : `${fileItems.length} Files Project`;
      const result = await fileService.addAssetsToNewProject(fileItems.map((f) => f.fileID), projectName);
      if (!result.success || !result.project?.id || result.assets.length === 0) {
        throw new Error(result.error || "Failed to add files to a new project.");
      }
      const toAdd: UploadedFile[] = result.assets.map((asset) => ({
        fileID: asset.asset_id,
        filename: asset.filename,
        size: asset.size_bytes,
        ext: asset.extension,
        status: "uploaded" as const,
        projectId: result.project?.id,
        rowCount: asset.row_count,
        columnCount: asset.column_count,
      }));
      // Store in pending slot — WorkspaceNewChat picks these up after resetChat()
      setPendingFilesForNewChat(toAdd);
      navigate("/workspace?tab=new-chat");
    } catch (error) {
      toast({
        title: "Could not create project",
        description: error instanceof Error ? error.message : "Failed to add files to a new project.",
        variant: "destructive",
      });
    } finally {
      setAddingToProject(false);
    }
  };

  // ── Download ─────────────────────────────────────────────────────────────────
  const handleDownloadFile = async (fileID: string, filename?: string) => {
    try {
      const res = await fileService.getDownloadUrl(fileID);
      if (res.url) {
        const a = document.createElement("a");
        a.href = res.url;
        a.download = res.filename ?? filename ?? fileID;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        toast({ title: "Download failed", description: res.error || "Could not get download link.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Download error", description: "Failed to download file.", variant: "destructive" });
    }
  };
  const handleDownloadSelected = () => {
    filteredFiles
      .filter((f) => selected.has(f.fileID))
      .forEach((f) => handleDownloadFile(f.fileID, f.filename));
  };

  // ── Preview ──────────────────────────────────────────────────────────────────
  const handleOpenPreview = (file: FileItem) => {
    setPreviewFile(file);
  };

  // ── Drag ─────────────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    Array.from(e.dataTransfer.files).forEach(handleUploadFile);
  };

  // ── Sort indicator ────────────────────────────────────────────────────────────
  const SI = ({ field }: { field: SortField }) =>
    sortField !== field ? null : sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 ml-0.5 opacity-60" />
      : <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm ring-1 ring-foreground/5">
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground tracking-tight">Files</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Manage uploaded datasets and start new projects from the same place.</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Stats pills */}
            {!loading && (
              <div className="hidden sm:flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary">
                  <File className="w-3 h-3" />
                  <span className="tabular-nums font-medium text-foreground">{files.length}</span>
                  <span>file{files.length !== 1 ? "s" : ""}</span>
                </div>
                {totalSize > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/70 border border-border/60 text-xs text-muted-foreground">
                    <HardDrive className="w-3 h-3" />
                    <span className="font-medium text-foreground">{formatBytes(totalSize)}</span>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => fetchFiles(true)}
              disabled={refreshing}
              className="p-2 rounded-lg border border-transparent hover:border-border/60 hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </button>
            {/* Upload button — moved to header */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="button-gradient flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            >
              <CloudUpload className="w-4 h-4" />
              Upload file
            </button>
          </div>
        </div>
      </div>

      {/* ── Upload card ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-card via-background to-primary/5 overflow-hidden shadow-sm ring-1 ring-foreground/5">
        {/* Drop zone */}
        <div
          className={cn(
            "relative flex flex-col items-center justify-center py-9 cursor-pointer transition-all duration-200 select-none group",
            isDragging
              ? "bg-primary/5"
              : "hover:bg-primary/5"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {/* Animated dashed border overlay */}
          <div
            className={cn(
              "absolute inset-4 rounded-xl border-2 border-dashed transition-colors duration-200 pointer-events-none",
              isDragging ? "border-primary/70" : "border-primary/25 group-hover:border-primary/45"
            )}
          />

          {/* Icon */}
          <div
            className={cn(
              "relative w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-all duration-300",
              isDragging
                ? "gradient-panel scale-110 glow-primary"
                : "bg-primary/10 text-primary group-hover:bg-primary/15"
            )}
          >
            <CloudUpload
              className={cn(
                "w-7 h-7 transition-colors duration-200",
                isDragging ? "text-white" : "text-primary"
              )}
            />
          </div>

          <p className={cn(
            "text-sm font-medium transition-colors",
            isDragging ? "text-primary" : "text-foreground/70 group-hover:text-foreground"
          )}>
            {isDragging ? "Drop files here" : "Drag & drop files to upload"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">CSV, XLSX, XLS supported</p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      </div>

      {/* ── Upload progress ──────────────────────────────────────────────────── */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          {uploadingFiles.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5"
            >
              <FileTypeIcon ext={f.name.split(".").pop() || ""} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-foreground mb-1.5">{f.name}</p>
                <div className="relative h-1.5 bg-primary/15 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${f.progress}%` }}
                  />
                  {/* shimmer */}
                  <div className="absolute inset-0 overflow-hidden rounded-full">
                    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                </div>
              </div>
              <span className="text-xs font-medium text-primary flex-shrink-0 tabular-nums">{f.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {/* ── File list ────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/60 bg-card/80 overflow-hidden shadow-sm ring-1 ring-foreground/5">

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-background/70">
          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-0 rounded-xl px-3 py-2 bg-card border border-border/50 focus-within:border-primary/45 focus-within:ring-4 focus-within:ring-primary/10 transition-all duration-200">
            <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted-foreground/60 hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-border/50 flex-shrink-0" />

          {/* Bulk actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <ActionBtn
              icon={<Download className="w-3.5 h-3.5" />}
              label={`Download (${selected.size})`}
              active={selected.size > 0}
              onClick={handleDownloadSelected}
            />
            <ActionBtn
              icon={<Trash2 className="w-3.5 h-3.5" />}
              label={`Delete (${selected.size})`}
              active={selected.size > 0}
              onClick={handleDeleteSelected}
              danger
            />
            <ActionBtn
              icon={<FolderPlus className="w-3.5 h-3.5" />}
              label={`Add to new project (${selected.size})`}
              active={selected.size > 0 && !addingToProject}
              onClick={() => {
                const sel = filteredFiles.filter((f) => selected.has(f.fileID));
                if (sel.length) handleChatWithFiles(sel);
              }}
              primary
            />
          </div>
        </div>

        {/* Table header */}
        <div
          className="grid items-center px-4 py-2.5 border-b border-border/30 bg-muted/30"
          style={{ gridTemplateColumns: "2.5rem 1fr 6.5rem 9rem 6rem" }}
        >
          <RoundCheckbox checked={allSelected} onChange={toggleAll} />
          <ColHeader label="Name" field="filename" current={sortField} dir={sortDir} onSort={handleSort} />
          <ColHeader label="Size" field="size" current={sortField} dir={sortDir} onSort={handleSort} />
          <ColHeader label="Uploaded Time" field="created_at" current={sortField} dir={sortDir} onSort={handleSort} />
          <div />
        </div>

        {/* Table body */}
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading your files…</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center px-8">
            {search ? (
              <>
                <Search className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm font-medium text-foreground mb-1">No results found</p>
                <p className="text-xs text-muted-foreground">No files match "{search}"</p>
                <button onClick={() => setSearch("")} className="mt-3 text-xs text-primary hover:underline">
                  Clear search
                </button>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl gradient-panel flex items-center justify-center mb-4 glow-primary">
                  <CloudUpload className="w-8 h-8 text-white" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No files yet</p>
                <p className="text-xs text-muted-foreground mb-4">Upload a CSV or spreadsheet to get started</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="button-gradient px-4 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-2"
                >
                  <CloudUpload className="w-4 h-4" />
                  Upload file
                </button>
              </>
            )}
          </div>
        ) : (
          <div>
            {filteredFiles.map((file, idx) => (
              <div
                key={file.fileID}
                className={cn(
                  "grid items-center px-4 py-3 border-b border-border/15 last:border-b-0 transition-colors group cursor-default",
                  selected.has(file.fileID)
                    ? "bg-primary/5 hover:bg-primary/10"
                    : "hover:bg-primary/5",
                  idx === 0 && "rounded-t-none"
                )}
                style={{ gridTemplateColumns: "2.5rem 1fr 6.5rem 9rem 6rem" }}
              >
                {/* Checkbox */}
                <RoundCheckbox checked={selected.has(file.fileID)} onChange={() => toggleFile(file.fileID)} />

                {/* Name + badge */}
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <FileTypeIcon ext={file.ext} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate block" title={file.filename}>
                        {file.filename}
                      </span>
                    </div>
                    {file.asset?.row_count != null && (
                      <span className="text-[11px] text-muted-foreground">
                        {file.asset.row_count.toLocaleString()} rows
                        {file.asset.column_count != null ? ` · ${file.asset.column_count} cols` : ""}
                      </span>
                    )}
                  </div>
                </div>

                {/* Size */}
                <span className="text-sm text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>

                {/* Date */}
                <span className="text-sm text-muted-foreground">{timeAgo(file.created_at)}</span>

                {/* Row actions */}
                <div
                  className="flex items-center gap-0.5 justify-end"
                  ref={openMenuId === file.fileID ? menuRef : undefined}
                >
                  <button
                    onClick={() => handleOpenPreview(file)}
                    className="p-1.5 rounded-md hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100"
                    title="Preview data"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleChatWithFiles([file])}
                    disabled={addingToProject}
                    className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all opacity-0 group-hover:opacity-100"
                    title="Add to new project"
                  >
                    <FolderPlus className="w-4 h-4" />
                  </button>
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId((p) => (p === file.fileID ? null : file.fileID));
                      }}
                      className="p-1.5 rounded-md hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100"
                      title="More options"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {openMenuId === file.fileID && (
                      <div className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border/50 rounded-xl shadow-xl py-1.5 z-50 animate-zoom-in">
                        <DropdownItem
                          icon={<Eye className="w-3.5 h-3.5" />}
                          label="Preview"
                          onClick={() => { handleOpenPreview(file); setOpenMenuId(null); }}
                        />
                        <DropdownItem
                          icon={<FolderPlus className="w-3.5 h-3.5" />}
                          label="Add to new project"
                          onClick={() => { handleChatWithFiles([file]); setOpenMenuId(null); }}
                        />
                        <DropdownItem
                          icon={<Download className="w-3.5 h-3.5" />}
                          label="Download"
                          onClick={() => { handleDownloadFile(file.fileID, file.filename); setOpenMenuId(null); }}
                        />
                        <div className="my-1 border-t border-border/30" />
                        <DropdownItem
                          icon={<Trash2 className="w-3.5 h-3.5" />}
                          label="Delete"
                          onClick={() => { handleDeleteFile(file.fileID); setOpenMenuId(null); }}
                          danger
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer count */}
        {!loading && (filteredFiles.length > 0 || hiddenDuplicateCount > 0) && (
          <div className="px-4 py-2 border-t border-border/20 bg-background/70 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {selected.size > 0
                  ? `${selected.size} of ${filteredFiles.length} selected`
                  : `${filteredFiles.length} file${filteredFiles.length !== 1 ? "s" : ""}`}
              </span>
              {hiddenDuplicateCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  {hiddenDuplicateCount} duplicate{hiddenDuplicateCount > 1 ? "s" : ""} hidden
                </span>
              )}
            </div>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="text-xs text-primary hover:underline">
                Clear selection
              </button>
            )}
          </div>
        )}
      </div>
      {/* ── File Preview Modal ──────────────────────────────────────────────── */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ColHeader({
  label, field, current, dir, onSort,
}: {
  label: string;
  field: SortField;
  current: SortField | null;
  dir: "asc" | "desc" | null;
  onSort: (f: SortField) => void;
}) {
  const active = current === field && dir !== null;
  return (
    <button
      onClick={() => onSort(field)}
      className={cn(
        "flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wide transition-colors",
        active ? "text-primary" : "text-foreground/40 hover:text-foreground/70"
      )}
    >
      {label}
      {active ? (
        dir === "asc"
          ? <ChevronUp className="w-3 h-3 ml-0.5" />
          : <ChevronDown className="w-3 h-3 ml-0.5" />
      ) : null}
    </button>
  );
}

function ActionBtn({
  icon, label, active, onClick, danger, primary,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!active}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
        active
          ? danger
            ? "text-red-500 hover:bg-red-500/10"
            : primary
            ? "text-primary hover:bg-primary/10"
            : "text-foreground/70 hover:bg-foreground/8"
          : "text-muted-foreground/40 cursor-not-allowed"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function DropdownItem({
  icon, label, onClick, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors",
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-foreground/80 hover:bg-muted"
      )}
    >
      <span className="opacity-70">{icon}</span>
      {label}
    </button>
  );
}

function RoundCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        onChange();
        e.currentTarget.blur();
      }}
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded-full border transition-colors outline-none focus:outline-none focus-visible:outline-none",
        checked
          ? "border-primary bg-primary"
          : "border-muted-foreground/40 bg-transparent hover:border-primary/40"
      )}
    >
      {checked && <Check className="h-3 w-3 text-primary-foreground/80" />}
    </button>
  );
}

// ─── File Preview Modal ────────────────────────────────────────────────────────

function FilePreviewModal({
  file, onClose,
}: {
  file: FileItem;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const ext = (file.ext || "").toLowerCase();
  const isSpreadsheet = ["csv", "xlsx", "xls"].includes(ext);

  const modalContent = (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 99999 }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-[90vw] flex flex-col rounded-2xl border border-border/50 bg-background shadow-2xl animate-zoom-in overflow-hidden"
        style={{ zIndex: 100000, maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/40 flex-shrink-0">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
            isSpreadsheet ? "bg-emerald-500/15" : "bg-blue-500/15"
          )}>
            {isSpreadsheet
              ? <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              : <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{file.filename}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — CsvPreviewPanel handles loading, pagination, row counts */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CsvPreviewPanel assetId={file.fileID} />
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
}

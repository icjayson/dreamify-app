import React from "react";
import { ArrowLeft, CalendarDays, Check, ChevronDown, ChevronUp, Download, Pencil, Plug, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CsvPreviewPanel from "@/components/project-section/CsvPreviewPanel";
import { CONNECTORS } from "@/constants/connectors";
import { integrationService } from "@/services/integrationService";
import type { ConnectorEntityDetailResponse, ConnectorEntityRunItem } from "@/services/integrationService";
import { fileService } from "@/services/fileService";
import { useToast } from "@/hooks/use-toast";
import { formatToDisplay } from "@/utils/timestamp";

type ConnectorCard = {
  connectorKey: string;
  connectorName: string;
  entityId: string;
  entityName: string;
};

type Props = {
  selectedConnectorCard: ConnectorCard;
  detailTab: "overview" | "data-table";
  setDetailTab: (v: "overview" | "data-table") => void;
  onBack: () => void;
  onAddToNewProject: () => void;
  onAddSelectedHistoryToNewProject: (assetId: string, syncVersionName?: string) => void;
  onDeleteEntity: () => void;
  detailLoading: boolean;
  connectorDetail: ConnectorEntityDetailResponse | null;
  relatedProjectPreviewUrls: Record<string, string>;
  activeAssetId: string | null;
  refreshingData: boolean;
  onOpenRefreshModal: () => void;
  selectedHistoryRun: ConnectorEntityRunItem | null;
  connectorHistory: ConnectorEntityRunItem[];
  selectedHistoryRunId: string | null;
  setSelectedHistoryRunId: (id: string | null) => void;
  setActiveAssetId: (id: string | null) => void;
  isHistoryExpanded: boolean;
  setIsHistoryExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  refreshModalOpen: boolean;
  setRefreshModalOpen: (v: boolean) => void;
  refreshDatePreset: string;
  setRefreshDatePreset: (v: string) => void;
  refreshStartDate: string;
  setRefreshStartDate: (v: string) => void;
  refreshEndDate: string;
  setRefreshEndDate: (v: string) => void;
  refreshCampaignIds: string;
  setRefreshCampaignIds: (v: string) => void;
  refreshAdsetIds: string;
  setRefreshAdsetIds: (v: string) => void;
  onSubmitRefreshModal: () => void;
  onOpenRelatedProject: (projectId: string, dashboardId?: string | null) => void;
};

export default function ConnectorEntityDetailView(props: Props) {
  const {
    selectedConnectorCard,
    detailTab,
    setDetailTab,
    onBack,
    onAddToNewProject,
    onAddSelectedHistoryToNewProject,
    onDeleteEntity,
    detailLoading,
    connectorDetail,
    relatedProjectPreviewUrls,
    activeAssetId,
    refreshingData,
    onOpenRefreshModal,
    selectedHistoryRun,
    connectorHistory,
    selectedHistoryRunId,
    setSelectedHistoryRunId,
    setActiveAssetId,
    isHistoryExpanded,
    setIsHistoryExpanded,
    refreshModalOpen,
    setRefreshModalOpen,
    refreshDatePreset,
    setRefreshDatePreset,
    refreshStartDate,
    setRefreshStartDate,
    refreshEndDate,
    setRefreshEndDate,
    refreshCampaignIds,
    setRefreshCampaignIds,
    refreshAdsetIds,
    setRefreshAdsetIds,
    onSubmitRefreshModal,
    onOpenRelatedProject,
  } = props;

  const connectorKey = selectedConnectorCard.connectorKey;
  const isGoogleSheetsConnector = connectorKey === "google_sheets";
  const isGA4Connector = connectorKey === "ga4";
  const isMetaAdsConnector = connectorKey === "meta_ads";
  const configSnapshot = (selectedHistoryRun?.config_snapshot as Record<string, unknown> | undefined) || {};
  const fallbackSchedule = (connectorDetail?.latest_schedule as Record<string, unknown> | undefined) || {};
  const fallbackConnectorConfig = (fallbackSchedule.connector_config as Record<string, unknown> | undefined) || {};
  const selectedCampaignIds = Array.isArray((configSnapshot as any)?.campaign_ids)
    ? ((configSnapshot as any).campaign_ids as string[])
    : (Array.isArray((fallbackConnectorConfig as any)?.campaign_ids) ? ((fallbackConnectorConfig as any).campaign_ids as string[]) : []);
  const selectedAdsetIds = Array.isArray((configSnapshot as any)?.adset_ids)
    ? ((configSnapshot as any).adset_ids as string[])
    : (Array.isArray((fallbackConnectorConfig as any)?.adset_ids) ? ((fallbackConnectorConfig as any).adset_ids as string[]) : []);
  const selectedDatePreset = (configSnapshot as any)?.date_preset || (fallbackSchedule as any)?.date_range_preset || "last_30d";
  const timeStart = (configSnapshot as any)?.start_date || selectedHistoryRun?.date_range_start || (fallbackConnectorConfig as any)?.start_date || "";
  const timeEnd = (configSnapshot as any)?.end_date || selectedHistoryRun?.date_range_end || (fallbackConnectorConfig as any)?.end_date || "";
  const timeRangeLabel = timeStart && timeEnd ? `${timeStart} -> ${timeEnd}` : selectedDatePreset;
  const { toast } = useToast();
  const [customVersionNames, setCustomVersionNames] = React.useState<Record<string, string>>({});
  const [editingRunId, setEditingRunId] = React.useState<string | null>(null);
  const [editingVersionName, setEditingVersionName] = React.useState("");

  React.useEffect(() => {
    setCustomVersionNames({});
    setEditingRunId(null);
    setEditingVersionName("");
  }, [selectedConnectorCard.connectorKey, selectedConnectorCard.entityId]);
  const syncVersionNumberByRunId = React.useMemo(() => {
    const getRunTimestamp = (run: ConnectorEntityRunItem) => {
      const raw = run.completed_at || run.triggered_at;
      if (!raw) return Number.MAX_SAFE_INTEGER;
      const time = new Date(raw).getTime();
      return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
    };

    // Numbering is now based on run timestamp (oldest run => Sync Version 1).
    const sortedByTimestamp = [...connectorHistory].sort((a, b) => {
      const timeA = getRunTimestamp(a);
      const timeB = getRunTimestamp(b);
      if (timeA !== timeB) return timeA - timeB;
      return a.run_id.localeCompare(b.run_id);
    });

    const map: Record<string, number> = {};
    sortedByTimestamp.forEach((run, idx) => {
      map[run.run_id] = idx + 1;
    });
    return map;
  }, [connectorHistory]);

  const getDefaultSyncVersionName = React.useCallback(
    (run: ConnectorEntityRunItem, fallbackIndex: number) =>
      `Sync Version ${syncVersionNumberByRunId[run.run_id] ?? fallbackIndex + 1}`,
    [syncVersionNumberByRunId]
  );

  const getSyncVersionName = React.useCallback((run: ConnectorEntityRunItem, index: number) => {
    const backendName = (run as any)?.sync_version_name || (run as any)?.version_name;
    const localName = customVersionNames[run.run_id];
    const trimmedLocalName = typeof localName === "string" ? localName.trim() : "";
    const trimmedBackendName = typeof backendName === "string" ? backendName.trim() : "";
    return trimmedLocalName || trimmedBackendName || getDefaultSyncVersionName(run, index);
  }, [customVersionNames, getDefaultSyncVersionName]);

  const startEditingSyncVersionName = React.useCallback((run: ConnectorEntityRunItem, index: number) => {
    setEditingRunId(run.run_id);
    setEditingVersionName(getSyncVersionName(run, index));
  }, [getSyncVersionName]);

  const saveEditingSyncVersionName = React.useCallback(async () => {
    if (!editingRunId) return;
    const trimmed = editingVersionName.trim();
    const targetRunId = editingRunId;
    const previousLocalValue = customVersionNames[targetRunId];
    setCustomVersionNames((prev) => ({ ...prev, [targetRunId]: trimmed }));
    try {
      const res = await integrationService.updateConnectorSyncVersionName(
        selectedConnectorCard.connectorKey,
        selectedConnectorCard.entityId,
        targetRunId,
        trimmed
      );
      if (!res.success) {
        throw new Error(res.error || "Failed to save sync version name");
      }
      setCustomVersionNames((prev) => {
        const next = { ...prev };
        if (res.sync_version_name?.trim()) next[targetRunId] = res.sync_version_name.trim();
        else delete next[targetRunId];
        return next;
      });
      setEditingRunId(null);
      setEditingVersionName("");
    } catch (error) {
      setCustomVersionNames((prev) => {
        const next = { ...prev };
        if (previousLocalValue) next[targetRunId] = previousLocalValue;
        else delete next[targetRunId];
        return next;
      });
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Could not save sync version name.",
        variant: "destructive",
      });
    }
  }, [
    editingRunId,
    editingVersionName,
    customVersionNames,
    selectedConnectorCard.connectorKey,
    selectedConnectorCard.entityId,
    toast,
  ]);

  const cancelEditingSyncVersionName = React.useCallback(() => {
    setEditingRunId(null);
    setEditingVersionName("");
  }, []);

  const handleDownloadSyncVersion = React.useCallback(async (assetId: string, fallbackFilename?: string) => {
    try {
      const res = await fileService.getDownloadUrl(assetId);
      if (!res.url) {
        toast({
          title: "Download failed",
          description: res.error || "Could not get download link.",
          variant: "destructive",
        });
        return;
      }
      const link = document.createElement("a");
      link.href = res.url;
      link.download = res.filename ?? fallbackFilename ?? assetId;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      toast({
        title: "Download error",
        description: "Failed to download this sync version.",
        variant: "destructive",
      });
    }
  }, [toast]);
  const handleOpenDataTableForSyncVersion = React.useCallback(
    (syncVersionName?: string) => {
      const targetName = syncVersionName?.trim();
      if (targetName) {
        const matched = connectorHistory.find((run, index) => {
          const normalized = getSyncVersionName(run, index).trim();
          return normalized.toLowerCase() === targetName.toLowerCase();
        });
        if (matched) {
          setSelectedHistoryRunId(matched.run_id);
          if (matched.asset_id) {
            setActiveAssetId(matched.asset_id);
          }
        }
      }
      setDetailTab("data-table");
    },
    [connectorHistory, getSyncVersionName, setActiveAssetId, setDetailTab, setSelectedHistoryRunId]
  );

  return (
    <>
      <div className="mb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline pb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to connectors
        </button>
      </div>

      <div
        className={`flex flex-col ${
          detailTab === "data-table"
            ? "h-[calc(100dvh-4.5rem)] max-h-[calc(100dvh-4.5rem)] min-h-[calc(100dvh-4.5rem)] overflow-hidden"
            : "h-auto overflow-visible"
        }`}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 ${CONNECTORS.find((c) => c.name === selectedConnectorCard.connectorName)?.iconBg ?? "bg-muted dark:bg-white/5"}`}>
              {CONNECTORS.find((c) => c.name === selectedConnectorCard.connectorName)?.icon ? (
                <img
                  src={CONNECTORS.find((c) => c.name === selectedConnectorCard.connectorName)?.icon}
                  alt={selectedConnectorCard.connectorName}
                  className={`w-7 h-7 object-contain ${selectedConnectorCard.connectorName === "TikTok Ads" ? "scale-125" : ""}`}
                />
              ) : (
                <Plug className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base truncate">{selectedConnectorCard.entityName}</h3>
              <p className="text-sm text-muted-foreground truncate">{selectedConnectorCard.connectorName}</p>
            </div>
          </div>
          <Button
            onClick={() => onAddToNewProject()}
            className="button-gradient shrink-0 text-white border-0 hover:bg-foreground/5 hover:text-white"
          >
            Add lastest sync version to new project
          </Button>
        </div>

        <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as "overview" | "data-table")} className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="data-table">Data Table</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={onOpenRefreshModal}
                disabled={refreshingData || detailTab !== "data-table"}
                className="inline-flex items-center gap-2 hover:bg-foreground/5 hover:text-foreground"
              >
                <RefreshCw className={`w-4 h-4 ${refreshingData ? "animate-spin" : ""}`} />
                Refresh data
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-500 hover:bg-foreground/5"
                onClick={onDeleteEntity}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete entity
              </Button>
            </div>
          </div>
          <TabsContent
            value="overview"
            className="mt-4"
          >
            {detailLoading ? (
              <div className="text-sm text-muted-foreground">Loading connector detail...</div>
            ) : connectorDetail ? (
              <div className="text-sm flex flex-col">
                <div className="text-sm text-muted-foreground mb-3 flex-shrink-0">
                  Overview and project links for this connector data.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-shrink-0">
                  <div className="rounded-md border border-border/50 bg-card px-3 py-2.5">
                    <div className="text-xs text-muted-foreground mb-1">Source</div>
                    <div className="font-medium">{connectorDetail.display_name}</div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-card px-3 py-2.5">
                    <div className="text-xs text-muted-foreground mb-1">Account</div>
                    <div className="font-medium truncate">{connectorDetail.account_name || selectedConnectorCard.entityName || "—"}</div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-card px-3 py-2.5">
                    <div className="text-xs text-muted-foreground mb-1">Last synced</div>
                    <div className="font-medium">{connectorDetail.last_synced_at ? formatToDisplay(connectorDetail.last_synced_at, { format: "full" }) : "—"}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-border/50 bg-card px-3 py-3 mt-3 min-h-[52vh] flex flex-col overflow-hidden">
                  <div className="text-xs font-medium text-muted-foreground mb-2 flex-shrink-0">Related projects / dashboards</div>
                  {connectorDetail.related_projects.length === 0 ? (
                    <div className="text-muted-foreground">No related projects yet.</div>
                  ) : (
                    <div className="space-y-2 overflow-y-auto pr-1 max-h-[48vh]">
                      {connectorDetail.related_projects.map((project) => (
                        <div
                          key={`${project.project_id}-${project.latest_dashboard_id || "no-dash"}-${project.conversation_id || ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpenRelatedProject(project.project_id, project.latest_dashboard_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpenRelatedProject(project.project_id, project.latest_dashboard_id);
                            }
                          }}
                          className={`rounded-xl border border-border/50 bg-background/50 p-3.5 transition-all hover:bg-background/80 hover:border-border/70 ${
                            project.latest_dashboard_id ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-stretch" : ""
                          } cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                        >
                          <div className={`min-w-0 flex flex-col justify-between ${project.latest_dashboard_id ? "" : ""}`}>
                            <div>
                              <div className="inline-flex items-center rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground mb-2">
                                Project
                              </div>
                              <div className="text-sm font-semibold leading-5 line-clamp-2">{project.project_name}</div>
                            </div>
                            <div className="mt-2.5 space-y-1.5">
                              <div className="text-xs text-muted-foreground truncate">
                                <span className="text-foreground/80">Created:</span>{" "}
                              {project.project_created_at
                                ? `Created ${formatToDisplay(project.project_created_at, { format: "full" })}`
                                : "Created date unknown"}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                <span className="text-foreground/80">Input data:</span>{" "}
                                <button
                                  type="button"
                                  className="inline text-foreground/90 hover:text-foreground font-medium hover:underline underline-offset-2 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenDataTableForSyncVersion(project.sync_version_name);
                                  }}
                                >
                                  {selectedConnectorCard.entityName}
                                  {project.sync_version_name?.trim() ? ` - ${project.sync_version_name.trim()}` : ""}
                                </button>
                              </div>
                            </div>
                            {project.latest_dashboard_id && (
                              <button
                                type="button"
                                className="mt-3 inline-flex items-center rounded-full border border-border/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground w-fit transition-all hover:text-foreground hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenRelatedProject(project.project_id, project.latest_dashboard_id);
                                }}
                              >
                                Dashboard: {project.dashboard_title || "Untitled dashboard"}
                              </button>
                            )}
                          </div>
                          {project.latest_dashboard_id && (
                            <div className="relative w-full h-[170px] rounded-lg overflow-hidden bg-muted/30 border border-border/40 shadow-sm">
                              {relatedProjectPreviewUrls[project.project_id] ? (
                                <img
                                  src={relatedProjectPreviewUrls[project.project_id]}
                                  alt={`${project.project_name} preview`}
                                  className="h-full w-full object-cover object-top"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : null}
                              {!relatedProjectPreviewUrls[project.project_id] && (
                                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                                  Preview is loading...
                                </div>
                              )}
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 to-transparent" />
                              <div className="absolute bottom-2 left-2 right-2 text-[11px] font-medium text-white truncate">
                                {project.dashboard_title || "Untitled dashboard"}
                              </div>
                            </div>
                          )}
                          {!project.latest_dashboard_id && (
                            <div className="mt-3 text-xs text-muted-foreground">
                              This project has no dashboard preview yet.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No detail data available.</div>
            )}
          </TabsContent>
          <TabsContent value="data-table" className="mt-4 flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div className="text-sm text-muted-foreground">Preview and sync history for this connector data.</div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 flex-1 min-h-0">
              <div className="xl:col-span-2 min-h-0 rounded-md border border-border/50 p-2 flex flex-col min-w-0">
                {activeAssetId ? <CsvPreviewPanel assetId={activeAssetId} /> : <div className="h-full min-h-[280px] flex items-center justify-center text-sm text-muted-foreground">No data snapshot available yet.</div>}
              </div>
              <div className="h-full min-h-0 flex flex-col gap-3">
                <div className="rounded-lg border border-border/50 bg-card px-3 py-2.5 overflow-hidden flex-shrink-0">
                  <h4 className="text-sm font-medium mb-2">Selected sync version config</h4>
                  {selectedHistoryRun ? (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Rows</span><span>{(configSnapshot as any)?.rows ?? selectedHistoryRun.rows_fetched ?? connectorDetail?.latest_asset?.row_count ?? "—"}</span></div>
                      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Columns</span><span>{(configSnapshot as any)?.columns ?? selectedHistoryRun.columns_fetched ?? connectorDetail?.latest_asset?.column_count ?? "—"}</span></div>
                      {!isGoogleSheetsConnector && (
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Time range</span><span>{timeRangeLabel}</span></div>
                      )}
                      {isMetaAdsConnector && <div className="text-muted-foreground">Campaigns: {selectedCampaignIds.length ? selectedCampaignIds.join(", ") : "All"}</div>}
                      {isMetaAdsConnector && <div className="text-muted-foreground">Adsets: {selectedAdsetIds.length ? selectedAdsetIds.join(", ") : "All"}</div>}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No run selected.</div>
                  )}
                </div>

                <div className={`rounded-lg border border-border/50 bg-card px-3 py-2.5 overflow-hidden ${isHistoryExpanded ? "flex-1 min-h-0 flex flex-col" : "flex-shrink-0"}`}>
                  <button onClick={() => setIsHistoryExpanded((prev) => !prev)} className="w-full flex items-center justify-between text-sm font-medium mb-2">
                    <span>Sync history</span>
                    {isHistoryExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {isHistoryExpanded && (
                    connectorHistory.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No sync runs yet.</div>
                    ) : (
                      <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
                        {connectorHistory.map((run, index) => (
                          <div
                            key={run.run_id}
                            onClick={() => {
                              setSelectedHistoryRunId(run.run_id);
                              if (run.asset_id) setActiveAssetId(run.asset_id);
                            }}
                            className={`w-full rounded-md border px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                              run.run_id === selectedHistoryRunId ? "border-primary/50 bg-primary/10" : "border-border/50 hover:bg-muted/40"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex items-center gap-1.5">
                                {editingRunId === run.run_id ? (
                                  <>
                                    <input
                                      value={editingVersionName}
                                      onChange={(e) => setEditingVersionName(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          saveEditingSyncVersionName();
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          cancelEditingSyncVersionName();
                                        }
                                      }}
                                      className="h-7 w-full min-w-0 rounded border border-border/60 bg-background px-2 text-xs"
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      className="p-1 rounded hover:bg-muted/60 text-foreground/70 hover:text-foreground"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        saveEditingSyncVersionName();
                                      }}
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      className="p-1 rounded hover:bg-muted/60 text-foreground/70 hover:text-foreground"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cancelEditingSyncVersionName();
                                      }}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <div className="font-medium truncate">{getSyncVersionName(run, index)}</div>
                                    <button
                                      type="button"
                                      className="p-1 rounded hover:bg-muted/60 text-foreground/70 hover:text-foreground"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditingSyncVersionName(run, index);
                                      }}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px] hover:bg-foreground/5 hover:text-foreground"
                                  disabled={!run.asset_id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (run.asset_id) onAddSelectedHistoryToNewProject(run.asset_id, getSyncVersionName(run, index));
                                  }}
                                >
                                  Add this sync version to new project
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-7 w-7 hover:bg-foreground/5 hover:text-foreground"
                                  disabled={!run.asset_id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (run.asset_id) handleDownloadSyncVersion(run.asset_id, run.asset_filename);
                                  }}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                run.status?.toLowerCase() === "success"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-muted text-muted-foreground"
                              }`}>
                                {run.status || "unknown"}
                              </span>
                              <span>{run.rows_fetched ?? "—"} rows</span>
                              <span>{run.completed_at ? formatToDisplay(run.completed_at, { format: "full" }) : "In progress"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={refreshModalOpen} onOpenChange={setRefreshModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Refresh connector data</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Entity (locked)</label>
              <div className="text-sm px-3 py-2 rounded-md border border-border/50 bg-muted/20">{selectedConnectorCard.entityName}</div>
            </div>
            {!isGoogleSheetsConnector && (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Date range preset</label>
                  <select className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm" value={refreshDatePreset} onChange={(e) => setRefreshDatePreset(e.target.value)}>
                    <option value="last_7d">Last 7 days</option>
                    <option value="last_14d">Last 14 days</option>
                    <option value="last_30d">Last 30 days</option>
                    <option value="last_90d">Last 90 days</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                {refreshDatePreset === "custom" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Start date</label>
                      <div className="relative">
                        <input type="date" value={refreshStartDate} onChange={(e) => setRefreshStartDate(e.target.value)} className="date-input-themed w-full px-3 py-2 pr-10 rounded-md border border-border/50 bg-background text-sm" />
                        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">End date</label>
                      <div className="relative">
                        <input type="date" value={refreshEndDate} onChange={(e) => setRefreshEndDate(e.target.value)} className="date-input-themed w-full px-3 py-2 pr-10 rounded-md border border-border/50 bg-background text-sm" />
                        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {isMetaAdsConnector && (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Campaign IDs (optional, comma separated)</label>
                  <input value={refreshCampaignIds} onChange={(e) => setRefreshCampaignIds(e.target.value)} placeholder="123,456,789" className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Adset IDs (optional, comma separated)</label>
                  <input value={refreshAdsetIds} onChange={(e) => setRefreshAdsetIds(e.target.value)} placeholder="111,222,333" className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm" />
                </div>
              </>
            )}
            {isGoogleSheetsConnector && <p className="text-xs text-muted-foreground">Google Sheets refresh will re-crawl data from this connected spreadsheet.</p>}
            {isGA4Connector && <p className="text-xs text-muted-foreground">GA4 refresh supports time range only.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefreshModalOpen(false)} disabled={refreshingData}>Cancel</Button>
            <Button onClick={onSubmitRefreshModal} disabled={refreshingData}>{refreshingData ? "Refreshing..." : "Refresh"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


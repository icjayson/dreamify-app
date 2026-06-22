import React from "react";
import { ArrowLeft, CalendarCheck, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsRight, Clock, Database, Download, ExternalLink, FolderPlus, LayoutDashboard, Pencil, Plug, RefreshCw, Trash2, X } from "lucide-react";
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
import { CreateScheduleModal } from "@/components/schedules/CreateScheduleModal";
import type { ProviderKey } from "@/services/scheduleService";
import type { Project } from "@/hooks/useProjects";

type ConnectorCard = {
  connectorKey: string;
  connectorName: string;
  entityId: string;
  entityName: string;
};

function stringArrayField(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value) ? value.map(String) : [];
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" ? value : undefined;
}

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
  projects?: Project[];
};

export default function ConnectorEntityDetailView(props: Props) {
  const {
    selectedConnectorCard,
    detailTab,
    setDetailTab,
    onBack,
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
    projects = [],
  } = props;

  const connectorKey = selectedConnectorCard.connectorKey;
  const connectorMeta = CONNECTORS.find((c) => c.name === selectedConnectorCard.connectorName);
  const isGoogleSheetsConnector = connectorKey === "google_sheets";
  const isGA4Connector = connectorKey === "ga4";
  const isMetaAdsConnector = connectorKey === "meta_ads";
  const configSnapshot = (selectedHistoryRun?.config_snapshot as Record<string, unknown> | undefined) || {};
  const fallbackSchedule = React.useMemo(
    () => (connectorDetail?.latest_schedule as Record<string, unknown> | undefined) || {},
    [connectorDetail?.latest_schedule]
  );
  const fallbackConnectorConfig = React.useMemo(
    () => (fallbackSchedule.connector_config as Record<string, unknown> | undefined) || {},
    [fallbackSchedule]
  );
  const selectedCampaignIds = stringArrayField(configSnapshot, "campaign_ids").length > 0
    ? stringArrayField(configSnapshot, "campaign_ids")
    : stringArrayField(fallbackConnectorConfig, "campaign_ids");
  const selectedAdsetIds = stringArrayField(configSnapshot, "adset_ids").length > 0
    ? stringArrayField(configSnapshot, "adset_ids")
    : stringArrayField(fallbackConnectorConfig, "adset_ids");
  const selectedDatePreset = stringField(configSnapshot, "date_preset") || stringField(fallbackSchedule, "date_range_preset") || "last_30d";
  const timeStart = stringField(configSnapshot, "start_date") || selectedHistoryRun?.date_range_start || stringField(fallbackConnectorConfig, "start_date") || "";
  const timeEnd = stringField(configSnapshot, "end_date") || selectedHistoryRun?.date_range_end || stringField(fallbackConnectorConfig, "end_date") || "";
  const hasExplicitTimeRange = Boolean(timeStart && timeEnd);
  const { toast } = useToast();
  const [customVersionNames, setCustomVersionNames] = React.useState<Record<string, string>>({});
  const [editingRunId, setEditingRunId] = React.useState<string | null>(null);
  const [editingVersionName, setEditingVersionName] = React.useState("");
  const [isPanelCollapsed, setIsPanelCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("connector_panel_collapsed") === "true";
  });
  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  React.useEffect(() => {
    setCustomVersionNames({});
    setEditingRunId(null);
    setEditingVersionName("");
  }, [selectedConnectorCard.connectorKey, selectedConnectorCard.entityId]);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("connector_panel_collapsed", String(isPanelCollapsed));
    }
  }, [isPanelCollapsed]);

  const getRunTimestamp = React.useCallback((run: ConnectorEntityRunItem) => {
    const raw = run.completed_at || run.triggered_at;
    if (!raw) return 0;
    const parsed = new Date(raw).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }, []);
  const formatRunTimestampLabel = React.useCallback((raw?: string | null) => {
    if (!raw) return "In progress";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "In progress";
    const datePart = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const timePart = parsed.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${datePart} · ${timePart}`;
  }, []);

  const sortedConnectorHistory = React.useMemo(
    () => [...connectorHistory].sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a)),
    [connectorHistory, getRunTimestamp]
  );

  const lastSuccessfulSync = React.useMemo(
    () => sortedConnectorHistory.find((run) => run.status?.toLowerCase() === "success" && !!(run.completed_at || run.triggered_at)),
    [sortedConnectorHistory]
  );
  const lastSyncLabel = lastSuccessfulSync?.completed_at || lastSuccessfulSync?.triggered_at
    ? formatRunTimestampLabel(lastSuccessfulSync.completed_at || lastSuccessfulSync.triggered_at)
    : "No successful sync yet";
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
    const runWithVersion = run as ConnectorEntityRunItem & { version_name?: string };
    const backendName = runWithVersion.sync_version_name || runWithVersion.version_name;
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

  const scheduleDefaults = React.useMemo(() => {
    const scheduleConfig = (fallbackSchedule.connector_config as Record<string, unknown> | undefined) || {};
    const entityId = selectedConnectorCard.entityId;
    const entityName = connectorDetail?.entity?.name || selectedConnectorCard.entityName;
    const accountName = connectorDetail?.account_name || String(fallbackSchedule.account_name || "") || selectedConnectorCard.entityName;
    const projectId =
      String(fallbackSchedule.project_id || "")
      || connectorDetail?.latest_asset?.project_id
      || connectorDetail?.related_projects?.[0]?.project_id
      || projects[0]?.id
      || "";

    if (connectorKey === "ga4") {
      return {
        provider: "ga4" as ProviderKey,
        config: {
          property_id: String(scheduleConfig.property_id || entityId),
          property_name: String(scheduleConfig.property_name || entityName),
          account_name: String(scheduleConfig.account_name || accountName),
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "meta_ads" || connectorKey === "tiktok_ads") {
      return {
        provider: (connectorKey === "meta_ads" ? "meta_ads" : "tiktok") as ProviderKey,
        config: {
          ad_account_id: String(scheduleConfig.ad_account_id || entityId),
          account_name: String(scheduleConfig.account_name || accountName),
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "appsflyer") {
      return {
        provider: "appsflyer" as ProviderKey,
        config: {
          app_id: String(scheduleConfig.app_id || entityId),
          app_name: String(scheduleConfig.app_name || entityName),
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "stripe") {
      return {
        provider: "stripe" as ProviderKey,
        config: { report_type: String(scheduleConfig.report_type || "charges") },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "hubspot") {
      const [, reportTypeFromId = "sales_pipeline", pipelineFromId = "all", ownerFromId = "all"] = entityId.split(":");
      return {
        provider: "hubspot" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || connectorDetail?.entity?.report_type || reportTypeFromId),
          pipeline_id: String(scheduleConfig.pipeline_id || connectorDetail?.entity?.pipeline_id || pipelineFromId),
          owner_id: String(scheduleConfig.owner_id || connectorDetail?.entity?.owner_id || ownerFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_associations: scheduleConfig.include_associations ?? true,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "salesforce") {
      const [, reportTypeFromId = "sales_pipeline", objectFromId = "all", ownerFromId = "all"] = entityId.split(":");
      return {
        provider: "salesforce" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || connectorDetail?.entity?.report_type || reportTypeFromId),
          object_name: String(scheduleConfig.object_name || connectorDetail?.entity?.object_name || objectFromId),
          owner_id: String(scheduleConfig.owner_id || connectorDetail?.entity?.owner_id || ownerFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "pipedrive") {
      const [, reportTypeFromId = "sales_pipeline", pipelineFromId = "all", ownerFromId = "all"] = entityId.split(":");
      return {
        provider: "pipedrive" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || connectorDetail?.entity?.report_type || reportTypeFromId),
          pipeline_id: String(scheduleConfig.pipeline_id || connectorDetail?.entity?.pipeline_id || pipelineFromId),
          owner_id: String(scheduleConfig.owner_id || connectorDetail?.entity?.owner_id || ownerFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "supabase") {
      const entity = connectorDetail?.entity;
      const [, connectionIdFromId = "", kindFromId = "", pathFromId = ""] = entityId.split(":");
      const dotIndex = pathFromId.lastIndexOf(".");
      const schemaFromId = dotIndex >= 0 ? pathFromId.slice(0, dotIndex) : "";
      const tableFromId = dotIndex >= 0 ? pathFromId.slice(dotIndex + 1) : "";
      const syncMode = String(
        scheduleConfig.sync_mode ||
        entity?.sync_mode ||
        (kindFromId === "profile" ? "profile_only" : kindFromId === "storage" || kindFromId === "auth_users" ? "app_profile" : "bounded_table_snapshot")
      );
      return {
        provider: "supabase" as ProviderKey,
        config: {
          connection_id: String(scheduleConfig.connection_id || entity?.connection_id || connectionIdFromId),
          sync_mode: syncMode,
          schema: String(scheduleConfig.schema || entity?.schema_name || schemaFromId),
          table: String(scheduleConfig.table || entity?.table_name || tableFromId),
          bucket: String(scheduleConfig.bucket || entity?.bucket || (kindFromId === "storage" ? pathFromId : "all")),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "shopify") {
      const entity = connectorDetail?.entity;
      const [, reportTypeFromId = "sales_overview", shopDomainFromId = "", resourceFromId = "all"] = entityId.split(":");
      return {
        provider: "shopify" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || entity?.report_type || reportTypeFromId),
          shop_domain: String(scheduleConfig.shop_domain || entity?.shop_domain || shopDomainFromId),
          resource: String(scheduleConfig.resource || entity?.resource || resourceFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_pii: scheduleConfig.include_pii ?? false,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "klaviyo") {
      const entity = connectorDetail?.entity;
      const [, reportTypeFromId = "lifecycle_overview", accountIdFromId = "all", resourceIdFromId = "all"] = entityId.split(":");
      return {
        provider: "klaviyo" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || entity?.report_type || reportTypeFromId),
          account_id: String(scheduleConfig.account_id || entity?.account_id || accountIdFromId),
          resource_id: String(scheduleConfig.resource_id || entity?.resource_id || resourceIdFromId),
          metric_id: String(scheduleConfig.metric_id || entity?.metric_id || ""),
          channel: String(scheduleConfig.channel || entity?.channel || "all"),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_pii: scheduleConfig.include_pii ?? false,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "quickbooks") {
      const entity = connectorDetail?.entity;
      const [, reportTypeFromId = "finance_overview", realmIdFromId = "all", resourceIdFromId = "all"] = entityId.split(":");
      return {
        provider: "quickbooks" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || entity?.report_type || reportTypeFromId),
          realm_id: String(scheduleConfig.realm_id || entity?.realm_id || realmIdFromId),
          resource_id: String(scheduleConfig.resource_id || entity?.resource_id || resourceIdFromId),
          accounting_basis: String(scheduleConfig.accounting_basis || entity?.accounting_basis || "Accrual"),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_pii: scheduleConfig.include_pii ?? false,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "amazon_seller") {
      const entity = connectorDetail?.entity;
      const [, reportTypeFromId = "sales_overview", sellerIdFromId = "all", marketplaceIdFromId = "all"] = entityId.split(":");
      return {
        provider: "amazon_seller" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || entity?.report_type || reportTypeFromId),
          seller_id: String(scheduleConfig.seller_id || entity?.seller_id || sellerIdFromId),
          marketplace_id: String(scheduleConfig.marketplace_id || entity?.marketplace_id || marketplaceIdFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_pii: false,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "tiktok_shop_seller") {
      const entity = connectorDetail?.entity;
      const [, reportTypeFromId = "sales_overview", shopIdFromId = "all", regionFromId = "US"] = entityId.split(":");
      return {
        provider: "tiktok_shop_seller" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || entity?.report_type || reportTypeFromId),
          shop_id: String(scheduleConfig.shop_id || entity?.shop_id || shopIdFromId),
          region: String(scheduleConfig.region || entity?.region || regionFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_pii: false,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "shopee_seller") {
      const entity = connectorDetail?.entity;
      const [, reportTypeFromId = "sales_overview", shopIdFromId = "all", regionFromId = "VN"] = entityId.split(":");
      return {
        provider: "shopee_seller" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || entity?.report_type || reportTypeFromId),
          shop_id: String(scheduleConfig.shop_id || entity?.shop_id || shopIdFromId),
          region: String(scheduleConfig.region || entity?.region || regionFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_pii: false,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "lazada_seller") {
      const entity = connectorDetail?.entity;
      const [, reportTypeFromId = "sales_overview", sellerIdFromId = "all", regionFromId = "VN"] = entityId.split(":");
      return {
        provider: "lazada_seller" as ProviderKey,
        config: {
          report_type: String(scheduleConfig.report_type || entity?.report_type || reportTypeFromId),
          seller_id: String(scheduleConfig.seller_id || entity?.seller_id || sellerIdFromId),
          region: String(scheduleConfig.region || entity?.region || regionFromId),
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
          include_pii: false,
        },
        projectId,
        accountName,
        entityName,
      };
    }
    if (connectorKey === "postgres" || connectorKey === "bigquery" || connectorKey === "snowflake" || connectorKey === "databricks") {
      const entity = connectorDetail?.entity;
      const [connectionIdFromId, tablePath = ""] = entityId.split(":");
      const dotIndex = tablePath.lastIndexOf(".");
      const schemaFromId = dotIndex >= 0 ? tablePath.slice(0, dotIndex) : "";
      const tableFromId = dotIndex >= 0 ? tablePath.slice(dotIndex + 1) : tablePath;
      const connectionId = String(scheduleConfig.connection_id || entity?.connection_id || connectionIdFromId);
      const schema = String(scheduleConfig.schema || entity?.schema_name || schemaFromId);
      const table = String(scheduleConfig.table || entity?.table_name || tableFromId);
      return {
        provider: "warehouse" as ProviderKey,
        config: {
          connector_key: connectorKey,
          connection_id: connectionId,
          catalog: String(scheduleConfig.catalog || entity?.catalog_name || ""),
          schema,
          table,
          entity_id: String(scheduleConfig.entity_id || entityId),
          entity_name: entityName,
          row_limit: Number(scheduleConfig.row_limit || 5000),
        },
        projectId,
        accountName,
        entityName,
      };
    }
    return null;
  }, [connectorDetail, connectorKey, fallbackSchedule, projects, selectedConnectorCard.entityId, selectedConnectorCard.entityName]);

  return (
    <>
      <div className="mb-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to connectors
        </button>
      </div>

      <div
        className={`flex flex-col ${
          detailTab === "data-table" || detailTab === "overview"
            ? "h-[calc(100dvh-4.5rem)] max-h-[calc(100dvh-4.5rem)] min-h-[calc(100dvh-4.5rem)] overflow-hidden"
            : "h-auto overflow-visible"
        }`}
      >
        <div className="mb-4 overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-sm ring-1 ring-foreground/5">
          <div className="relative p-4 sm:p-5">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_140%_at_0%_0%,hsl(var(--primary)/0.12),transparent_48%),radial-gradient(80%_120%_at_100%_0%,hsl(var(--accent)/0.10),transparent_50%)]"
            />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-3.5">
                <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-sm ring-1 ring-border/60 ${connectorMeta?.iconBg ?? "bg-muted dark:bg-white/5"}`}>
              {connectorMeta?.icon ? (
                <img
                  src={connectorMeta.icon}
                  alt={selectedConnectorCard.connectorName}
                  className={`h-8 w-8 object-contain ${selectedConnectorCard.connectorName === "TikTok Ads" ? "scale-125" : ""}`}
                />
              ) : (
                <Plug className="h-5 w-5 text-muted-foreground" />
              )}
                </div>
                <div className="min-w-0">
                  <div className="mb-1 inline-flex items-center rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Connected entity
                  </div>
                  <h3 className="truncate text-xl font-semibold tracking-tight text-foreground">{selectedConnectorCard.entityName}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{selectedConnectorCard.connectorName}</span>
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                    <span>{lastSyncLabel}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Sync versions</div>
                  <div className="mt-0.5 text-sm font-semibold">{connectorHistory.length}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Linked projects</div>
                  <div className="mt-0.5 text-sm font-semibold">{connectorDetail?.related_projects.length ?? 0}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as "overview" | "data-table")} className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <TabsList className="rounded-xl border border-border/60 bg-background/70 p-1 shadow-sm">
              <TabsTrigger
                value="overview"
                className="rounded-lg px-4 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="data-table"
                className="rounded-lg px-4 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Data Table
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {scheduleDefaults && (
                <Button
                  variant="ghost"
                  onClick={() => setScheduleOpen(true)}
                  className="inline-flex items-center gap-2 border border-border/60 hover:bg-foreground/5 hover:text-foreground"
                >
                  <Clock className="w-4 h-4" />
                  Schedule sync
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={onOpenRefreshModal}
                disabled={refreshingData || detailTab !== "data-table"}
                className="inline-flex items-center gap-2 border border-border/60 hover:bg-foreground/5 hover:text-foreground"
              >
                <RefreshCw className={`w-4 h-4 ${refreshingData ? "animate-spin" : ""}`} />
                Refresh data
              </Button>
              <Button
                variant="ghost"
                className="inline-flex items-center gap-2 border border-red-500 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={onDeleteEntity}
              >
                <Trash2 className="w-4 h-4" />
                Delete entity
              </Button>
            </div>
          </div>
          {detailTab === "overview" && (
            <TabsContent
              value="overview"
              className="mt-4 flex-1 min-h-0 overflow-hidden"
            >
              {detailLoading ? (
                <div className="text-sm text-muted-foreground">Loading connector detail...</div>
              ) : connectorDetail ? (
                <div className="text-sm flex h-full min-h-0 flex-col">
                  <div className="mb-3 flex flex-shrink-0 items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">Overview</div>
                      <div className="text-sm text-muted-foreground">
                        Connector health, source details, and dashboards using this data.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-shrink-0">
                    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm ring-1 ring-foreground/5">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Database className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</div>
                        <div className="mt-1 truncate text-base font-semibold">{connectorDetail.display_name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm ring-1 ring-foreground/5">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                        <Plug className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</div>
                        <div className="mt-1 truncate text-base font-semibold">{connectorDetail.account_name || selectedConnectorCard.entityName || "—"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm ring-1 ring-foreground/5">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-300">
                        <CalendarCheck className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last synced</div>
                        <div className="mt-1 truncate text-base font-semibold">{connectorDetail.last_synced_at ? formatToDisplay(connectorDetail.last_synced_at, { format: "full" }) : "—"}</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm ring-1 ring-foreground/5">
                    <div className="mb-3 flex flex-shrink-0 items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Related projects</div>
                        <div className="text-xs text-muted-foreground">Dashboards and project contexts created from this connector.</div>
                      </div>
                      <div className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {connectorDetail.related_projects.length} total
                      </div>
                    </div>
                    {connectorDetail.related_projects.length === 0 ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border/70 text-muted-foreground">
                        No related projects yet.
                      </div>
                    ) : (
                      <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0">
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
                            className={`group rounded-2xl border border-border/60 bg-gradient-to-br from-background to-muted/25 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md ${
                              project.latest_dashboard_id ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-stretch" : ""
                            } cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                          >
                            <div className={`min-w-0 flex flex-col justify-between ${project.latest_dashboard_id ? "" : ""}`}>
                              <div>
                                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                  <LayoutDashboard className="h-3 w-3" />
                                  Project
                                </div>
                                <div className="line-clamp-2 text-base font-semibold leading-6 text-foreground">{project.project_name}</div>
                              </div>
                              <div className="mt-3 space-y-1.5">
                                <div className="text-xs text-muted-foreground truncate">
                                  <span className="text-foreground/80">Created:</span>{" "}
                                {project.project_created_at
                                  ? formatToDisplay(project.project_created_at, { format: "full" })
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
                                  className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-foreground hover:shadow-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenRelatedProject(project.project_id, project.latest_dashboard_id);
                                  }}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Dashboard: {project.dashboard_title || "Untitled dashboard"}
                                </button>
                              )}
                            </div>
                            {project.latest_dashboard_id && (
                              <div className="relative h-[185px] w-full overflow-hidden rounded-xl border border-border/60 bg-muted/30 shadow-sm ring-1 ring-foreground/5">
                                {relatedProjectPreviewUrls[project.project_id] ? (
                                  <img
                                    src={relatedProjectPreviewUrls[project.project_id]}
                                    alt={`${project.project_name} preview`}
                                    className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
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
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
                                <div className="absolute bottom-2.5 left-3 right-3 truncate text-[11px] font-semibold text-white drop-shadow">
                                  {project.dashboard_title || "Untitled dashboard"}
                                </div>
                              </div>
                            )}
                            {!project.latest_dashboard_id && (
                              <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
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
          )}
          {detailTab === "data-table" && (
          <TabsContent value="data-table" className="mt-4 flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="mb-3 flex flex-shrink-0 items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">Data snapshot</div>
                <div className="text-sm text-muted-foreground">Preview rows, inspect sync versions, and export or reuse snapshots.</div>
              </div>
              {selectedHistoryRun && (
                <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                    <Database className="h-3.5 w-3.5" />
                    {(selectedHistoryRun.rows_fetched ?? connectorDetail?.latest_asset?.row_count ?? 0).toLocaleString()} rows
                    <span className="h-1 w-1 rounded-full bg-primary/50" />
                    {(selectedHistoryRun.columns_fetched ?? connectorDetail?.latest_asset?.column_count ?? 0).toLocaleString()} columns
                  </div>
                  {!isGoogleSheetsConnector && (
                    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                      <CalendarDays className="h-3.5 w-3.5 text-primary" />
                      {hasExplicitTimeRange ? (
                        <>
                          <span>{timeStart}</span>
                          <ChevronsRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{timeEnd}</span>
                        </>
                      ) : (
                        <span>{selectedDatePreset}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-4 flex-1 min-h-0">
              <div className="min-h-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-2 shadow-sm ring-1 ring-foreground/5">
                <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      <span className="font-medium text-muted-foreground">Current preview:</span>{" "}
                      {selectedHistoryRun ? getSyncVersionName(selectedHistoryRun, 0) : "No sync version selected"}
                    </div>
                  </div>
                  <div className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {activeAssetId ? "Loaded" : "No snapshot"}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/50 bg-background">
                  {activeAssetId ? <CsvPreviewPanel assetId={activeAssetId} /> : <div className="h-full min-h-[280px] flex items-center justify-center text-sm text-muted-foreground">No data snapshot available yet.</div>}
                </div>
              </div>
              <div className={`h-full min-h-0 flex-shrink-0 transition-all duration-200 ${isPanelCollapsed ? "w-11" : "w-[300px]"}`}>
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-sm ring-1 ring-foreground/5">
                  <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-3 py-2.5">
                    {!isPanelCollapsed && (
                      <div>
                        <span className="text-sm font-semibold text-foreground">Sync history</span>
                        <div className="text-[11px] text-muted-foreground">{sortedConnectorHistory.length} versions available</div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsPanelCollapsed((prev) => !prev)}
                      className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                      aria-label={isPanelCollapsed ? "Expand sync history panel" : "Collapse sync history panel"}
                      title={isPanelCollapsed ? "Expand panel" : "Collapse panel"}
                    >
                      {isPanelCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                  {!isPanelCollapsed && (
                    <div className="flex h-full min-h-0 flex-col p-3">
                    {sortedConnectorHistory.length === 0 ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/50 px-3 text-center text-xs text-muted-foreground">
                        No sync runs yet.
                      </div>
                    ) : (
                      <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
                        {sortedConnectorHistory.map((run, index) => {
                          const isActiveRun = run.run_id === selectedHistoryRunId;
                          const isSuccessRun = run.status?.toLowerCase() === "success";
                          return (
                          <div
                            key={run.run_id}
                            onClick={() => {
                              setSelectedHistoryRunId(run.run_id);
                              if (run.asset_id) setActiveAssetId(run.asset_id);
                            }}
                            className={`w-full rounded-xl border px-2.5 py-2 text-xs transition-all cursor-pointer ${
                              isActiveRun
                                ? "border-primary/35 bg-primary/10 shadow-sm ring-1 ring-primary/10"
                                : "border-border/60 bg-card/70 hover:border-primary/25 hover:bg-primary/5"
                            }`}
                          >
                            <div className="flex items-start gap-2 flex-wrap">
                              <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
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
                                      title="Save name"
                                      aria-label="Save name"
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
                                      title="Cancel rename"
                                      aria-label="Cancel rename"
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
                                    <div className="font-medium">
                                      {getSyncVersionName(run, index)}
                                    </div>
                                  </>
                                )}
                              </div>
                              {isActiveRun && (
                                <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                                  Active
                                </span>
                              )}
                              {!(isActiveRun && isSuccessRun) && (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                isSuccessRun
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}>
                                {run.status || "Unknown"}
                              </span>
                              )}
                            </div>
                            <div className="mt-1.5 text-muted-foreground">
                              {formatRunTimestampLabel(run.completed_at || run.triggered_at)}
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <div className="text-muted-foreground">
                                {(run.rows_fetched ?? 0).toLocaleString()} rows · {(run.columns_fetched ?? 0).toLocaleString()} cols
                              </div>
                              {!isActiveRun && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 p-0 hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                    disabled={!run.asset_id}
                                    title="Export this version as CSV"
                                    aria-label="Export this version as CSV"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (run.asset_id) handleDownloadSyncVersion(run.asset_id, run.asset_filename);
                                    }}
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 p-0 hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                    title="Rename"
                                    aria-label="Rename"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEditingSyncVersionName(run, index);
                                    }}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                            {isActiveRun && (
                            <div className="mt-2 flex items-center gap-1">
                              {isActiveRun && (
                                <Button
                                size="sm"
                                variant="outline"
                                className="h-7 flex-1 justify-center text-[11px] hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                disabled={!run.asset_id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (run.asset_id) onAddSelectedHistoryToNewProject(run.asset_id, getSyncVersionName(run, index));
                                }}
                              >
                                <FolderPlus className="w-3.5 h-3.5 mr-1" />
                                Add to project
                                </Button>
                              )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-7 p-0 hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                  disabled={!run.asset_id}
                                  title="Export this version as CSV"
                                  aria-label="Export this version as CSV"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (run.asset_id) handleDownloadSyncVersion(run.asset_id, run.asset_filename);
                                  }}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-7 p-0 hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                  title="Rename"
                                  aria-label="Rename"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditingSyncVersionName(run, index);
                                  }}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                            )}
                          </div>
                        )})}
                      </div>
                    )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          )}
        </Tabs>
      </div>
      {scheduleDefaults && (
        <CreateScheduleModal
          open={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
          defaultProvider={scheduleDefaults.provider}
          defaultConnectorConfig={scheduleDefaults.config}
          defaultAccountName={scheduleDefaults.accountName}
          defaultEntityName={scheduleDefaults.entityName}
          projectId={scheduleDefaults.projectId}
          projects={projects}
        />
      )}

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

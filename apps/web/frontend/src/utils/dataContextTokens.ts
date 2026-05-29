import { CONNECTORS } from "@/constants/connectors";
import type { Message } from "@/types/message";

export type DataContextTokenStatus =
  | "idle"
  | "uploading"
  | "uploaded"
  | "accepted"
  | "processing"
  | "processed"
  | "error"
  | "schemaOnly";

export interface DataContextTokenSource {
  id?: string;
  name?: string;
  filename?: string;
  ext?: string;
  kind?: string;
  sourceType?: string;
  accountName?: string;
  propertyName?: string;
  syncVersionName?: string;
  status?: DataContextTokenStatus;
  uploadProgress?: number;
  schemaOnly?: boolean;
}

export interface NormalizedConnector {
  name: string;
  shortName: string;
  icon?: string;
  iconBg?: string;
}

const CONNECTOR_ALIASES: Array<{
  name: string;
  shortName: string;
  aliases: string[];
}> = [
  { name: "Google Ads", shortName: "Google Ads", aliases: ["google_ads", "google ads", "integration_google_ads"] },
  { name: "Google Sheets", shortName: "Sheets", aliases: ["google_sheets", "google sheets", "google_sheet", "gsheets", "gsheet", "integration_gsheets", "spreadsheet"] },
  { name: "GA4", shortName: "GA4", aliases: ["ga4", "google_analytics", "google analytics", "integration_ga4"] },
  { name: "Meta Ads", shortName: "Meta", aliases: ["meta_ads", "meta ads", "facebook_ads", "facebook ads", "integration_meta_ads"] },
  { name: "TikTok Ads", shortName: "TikTok", aliases: ["tiktok_ads", "tiktok ads", "tik_tok", "tiktok", "integration_tiktok"] },
  { name: "Firebase", shortName: "Firebase", aliases: ["firebase", "integration_firebase"] },
  { name: "AppsFlyer", shortName: "AppsFlyer", aliases: ["appsflyer", "apps_flyer", "integration_appsflyer"] },
  { name: "Stripe", shortName: "Stripe", aliases: ["stripe", "integration_stripe"] },
];

function compact(value: string): string {
  return value.toLowerCase().replace(/[-\s]+/g, "_");
}

function withoutExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

function humanizeFileStem(name: string): string {
  return withoutExtension(name).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeConnectorSource(raw?: string | null): NormalizedConnector | null {
  if (!raw) return null;
  const normalizedRaw = compact(raw);
  if (normalizedRaw === "multiple") return null;

  const match = CONNECTOR_ALIASES.find((entry) =>
    entry.aliases.some((alias) => normalizedRaw.includes(compact(alias))),
  );
  if (!match) return null;

  const connector = CONNECTORS.find((item) => item.name === match.name);
  return {
    name: match.name,
    shortName: match.shortName,
    icon: connector?.icon,
    iconBg: connector?.iconBg,
  };
}

export function getDataContextFileName(source: DataContextTokenSource): string {
  return source.filename || source.name || "Data source";
}

export function getDataContextLabel(source: DataContextTokenSource): string {
  const fileName = getDataContextFileName(source);
  const connector = normalizeConnectorSource(source.sourceType);

  if (source.sourceType === "Multiple") {
    return fileName || "Multiple data sources";
  }
  if (!connector) {
    return withoutExtension(fileName);
  }
  if (connector.name === "GA4") {
    return source.propertyName || source.accountName || withoutExtension(fileName);
  }
  if (connector.name === "Google Sheets") {
    return source.propertyName || withoutExtension(fileName);
  }
  if (connector.name === "Stripe") {
    return source.accountName || source.propertyName || withoutExtension(fileName);
  }
  return source.accountName || source.propertyName || withoutExtension(fileName);
}

export function getDataContextLabelWithVersion(source: DataContextTokenSource): string {
  const label = getDataContextLabel(source);
  const syncVersion = source.syncVersionName?.trim();
  return syncVersion ? `${label} - ${syncVersion}` : label;
}

export function getCompactDataContextLabel(source: DataContextTokenSource): string {
  const label = getDataContextLabel(source);
  const connector = normalizeConnectorSource(source.sourceType);
  const shortestSegment = label.split(/[\\/]/).map((part) => part.trim()).filter(Boolean).pop();
  const compactLabel = shortestSegment || label;

  if (connector) {
    return humanizeFileStem(compactLabel);
  }

  return humanizeFileStem(compactLabel);
}

export function getDataContextSourceLabel(source: DataContextTokenSource): string {
  if (source.sourceType === "Multiple") return "Data";
  const connector = normalizeConnectorSource(source.sourceType);
  if (connector) return connector.shortName;
  return source.ext ? source.ext.toUpperCase() : "File";
}

export function getDataContextTooltip(source: DataContextTokenSource): string {
  const connector = normalizeConnectorSource(source.sourceType);
  const fileName = getDataContextFileName(source);
  const context = getDataContextLabelWithVersion(source);

  if (source.sourceType === "Multiple") {
    return context;
  }
  if (connector?.name === "GA4") {
    const account = source.accountName || connector.name;
    const property = source.propertyName || withoutExtension(fileName);
    return source.syncVersionName ? `${account} / ${property} - ${source.syncVersionName}` : `${account} / ${property}`;
  }
  return connector ? `${connector.name}: ${context}` : fileName;
}

export interface SpreadsheetPreviewProjectAsset {
  id: string;
  name: string;
  ext?: string;
  sourceType?: string;
}

export interface SpreadsheetPreviewTarget {
  assetId: string;
  filename: string;
  ext: "csv" | "xls" | "xlsx";
}

const SPREADSHEET_EXTENSIONS = new Set(["csv", "xls", "xlsx"]);

function getFileExtension(name?: string, fallbackExt?: string): string {
  const fromExt = fallbackExt?.replace(/^\./, "").toLowerCase();
  if (fromExt) return fromExt;
  const fromName = name?.split(".").pop()?.toLowerCase();
  return fromName || "";
}

function isConnectorAttachment(sourceType?: string): boolean {
  return sourceType === "Multiple" || Boolean(normalizeConnectorSource(sourceType));
}

type SpreadsheetAttachmentCandidate = {
  id?: string;
  name?: string;
  ext?: string;
  sourceType?: string;
};

function getSpreadsheetAttachmentCandidates(
  attachment: NonNullable<Message["attachment"]>,
): SpreadsheetAttachmentCandidate[] {
  if (attachment.files?.length) {
    return attachment.files.map((file) => ({
      id: file.id,
      name: file.name,
      ext: file.ext,
      sourceType: file.sourceType || (attachment.sourceType === "Multiple" ? undefined : attachment.sourceType),
    }));
  }

  return [{
    name: attachment.name,
    sourceType: attachment.sourceType,
  }];
}

export function getSpreadsheetPreviewTarget(
  attachment?: Message["attachment"],
  projectAssets: readonly SpreadsheetPreviewProjectAsset[] = [],
): SpreadsheetPreviewTarget | null {
  if (!attachment) return null;

  const candidates = getSpreadsheetAttachmentCandidates(attachment);
  const file = candidates.find((candidate) => {
    if (isConnectorAttachment(candidate.sourceType)) return false;
    return SPREADSHEET_EXTENSIONS.has(getFileExtension(candidate.name, candidate.ext));
  });
  if (!file) return null;

  const filename = file.name || attachment.name;

  const ext = getFileExtension(filename, file.ext);
  if (!SPREADSHEET_EXTENSIONS.has(ext)) return null;

  const matchedAsset = file.id
    ? undefined
    : projectAssets.find((asset) => asset.name === filename || asset.name === attachment.name);
  if (matchedAsset && isConnectorAttachment(matchedAsset.sourceType)) return null;

  const assetId = file.id || matchedAsset?.id;
  if (!assetId) return null;

  return {
    assetId,
    filename,
    ext: ext as SpreadsheetPreviewTarget["ext"],
  };
}

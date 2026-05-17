import { create } from 'zustand';
import { EXPLICIT_PROMPT_THEME_SOURCE, type ClarificationOption, type ClarificationRequest, type Message, type ThinkingEvent } from '@/types/message';
import { conversationNodesToMessages } from '@/chat/conversationToMessages';
import { processingService } from '@/services/processingService';
import type { ConversationChatRequest } from '@/services/conversationService';
import type { AssetRecord } from '@/services/fileService';
import {
  createThemeSelection,
  resolveAnalysisFocus,
  resolveVisualTheme,
  type ThemeSelection,
} from '@/constants/builtinTemplates';

// Monotonic request counter for selectDashboard. When two dashboard cards
// are clicked in rapid succession, only the latest fetch's result is
// applied; older in-flight resolutions are discarded by request-id check.
let selectDashboardSeq = 0;

// ---------------------------------------------------------------------------
// Per-dashboard visual theme persistence. The old template map is still read
// as a fallback for dashboards generated before the theme/focus split.
// ---------------------------------------------------------------------------
const DASHBOARD_TEMPLATE_MAP_KEY = 'dreamify_dashboard_template_map';
const DASHBOARD_THEME_MAP_KEY = 'dreamify_dashboard_theme_map';
const SELECTED_THEME_KEY = 'dreamify_selected_theme';
const LEGACY_SELECTED_TEMPLATE_KEY = 'dreamify_selected_template';

type SelectedTemplate = ThemeSelection;

function getStorageMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveStorageMapValue(key: string, dashboardId: string, value: string): void {
  try {
    const map = getStorageMap(key);
    map[dashboardId] = value;
    localStorage.setItem(key, JSON.stringify(map));
  } catch { /* ignore */ }
}

function saveDashboardThemeId(dashboardId: string, themeId: string): void {
  saveStorageMapValue(DASHBOARD_THEME_MAP_KEY, dashboardId, themeId);
}

function getThemeIdForDashboard(dashboardId: string): string | null {
  try {
    return getStorageMap(DASHBOARD_THEME_MAP_KEY)[dashboardId] ?? null;
  } catch { return null; }
}

function getLegacyTemplateIdForDashboard(dashboardId: string): string | null {
  try {
    return getStorageMap(DASHBOARD_TEMPLATE_MAP_KEY)[dashboardId] ?? null;
  } catch { return null; }
}

function resolveStoredTheme(
  themeId: string | null,
  analysisFocusId?: string | null,
  legacyTemplateId?: string | null,
): SelectedTemplate | null {
  const resolvedTheme = themeId || legacyTemplateId;
  const resolvedFocus = analysisFocusId || legacyTemplateId;
  return createThemeSelection(resolvedTheme, resolvedFocus);
}

function readPendingThemeSelection(): SelectedTemplate | null {
  try {
    const current = localStorage.getItem(SELECTED_THEME_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      return createThemeSelection(parsed?.id ?? parsed?.suggestedTheme, parsed?.analysisFocusId) ?? null;
    }
    const legacy = localStorage.getItem(LEGACY_SELECTED_TEMPLATE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      return createThemeSelection(parsed?.suggestedTheme ?? parsed?.id, parsed?.id) ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

function persistPendingThemeSelection(selection: SelectedTemplate | null): void {
  try {
    if (selection) {
      localStorage.setItem(SELECTED_THEME_KEY, JSON.stringify(selection));
      localStorage.removeItem(LEGACY_SELECTED_TEMPLATE_KEY);
    } else {
      localStorage.removeItem(SELECTED_THEME_KEY);
      localStorage.removeItem(LEGACY_SELECTED_TEMPLATE_KEY);
    }
  } catch { /* ignore */ }
}

function getThemeId(selection: SelectedTemplate | null): string | undefined {
  const theme = resolveVisualTheme(selection?.suggestedTheme ?? selection?.id);
  return theme?.id;
}

function getAnalysisFocusId(selection: SelectedTemplate | null): string | undefined {
  const focus = resolveAnalysisFocus(selection?.analysisFocusId ?? null);
  return focus?.id;
}

function emitConnectorSynced(connector: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('dreamify:connector-synced', {
      detail: { connector, at: Date.now() },
    })
  );
}


export interface UploadedFile {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error' | 'accepted';
  projectId?: string;
  conversationId?: string;
  processedData?: unknown;
  rowCount?: number;
  columnCount?: number;
  /** Upload progress percentage (0-100) for local file uploads */
  uploadProgress?: number;
  /** True if file was selected from @mention dropdown (already exists in conversation) */
  isFromMention?: boolean;
  /** Integration source type if the file came from an API sync */
  sourceType?: string;
  /** GA4 account display name */
  accountName?: string;
  /** GA4 property display name */
  propertyName?: string;
  /** Human-readable sync version label from connector history */
  syncVersionName?: string;
  /** True when user chose to keep a header-only / zero-row integration export (not sufficient for analysis) */
  schemaOnly?: boolean;
}

/** Result of Meta Ads sync API (used by Meta modal for empty-data hybrid flow) */
export interface MetaAdsSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: AssetRecord;
  message?: string;
}

/** Result of TikTok Ads sync API */
export interface TikTokAdsSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: AssetRecord;
  message?: string;
}

/** Files that must not trigger analysis-only flows. */
export function isNonAnalyzableUpload(file: UploadedFile): boolean {
  if (file.schemaOnly) return true;
  if (file.rowCount === 0 && (file.sourceType === 'Meta Ads' || file.sourceType === 'TikTok Ads')) return true;
  return false;
}

export function isFreshPromptUpload(file: UploadedFile): boolean {
  return (
    !file.conversationId &&
    !file.isFromMention &&
    (file.status === 'uploaded' || file.status === 'accepted')
  );
}

export function getExplicitPromptFiles(
  files: UploadedFile[],
  selectedAssetIds: readonly string[] = [],
): UploadedFile[] {
  const selectedIds = new Set(selectedAssetIds.filter(Boolean));
  return files.filter((file) => {
    if (!file.fileID) return false;
    return selectedIds.has(file.fileID) || isFreshPromptUpload(file);
  });
}

function uniqueIds(ids: readonly (string | undefined | null)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

export function getExplicitPromptAssetIds(
  files: UploadedFile[],
  selectedAssetIds: readonly string[] = [],
): string[] {
  return uniqueIds([
    ...selectedAssetIds,
    ...files.filter(isFreshPromptUpload).map((file) => file.fileID),
  ]);
}

export function buildAttachmentFromFiles(files: UploadedFile[]): Message['attachment'] | undefined {
  if (files.length === 0) return undefined;
  const firstFile = files[0];
  return {
    kind: 'csv',
    name: files.length === 1 ? firstFile.filename : `${files.length} files`,
    sourceType: files.length === 1 ? firstFile.sourceType : 'Multiple',
    accountName: files.length === 1 ? firstFile.accountName : undefined,
    propertyName: files.length === 1 ? firstFile.propertyName : undefined,
    syncVersionName: files.length === 1 ? firstFile.syncVersionName : undefined,
    files: files.map((file) => ({
      id: file.fileID,
      name: file.filename,
      ext: file.ext,
      sourceType: file.sourceType,
      accountName: file.accountName,
      propertyName: file.propertyName,
      syncVersionName: file.syncVersionName,
    })),
  };
}

interface ChatState {
  // Input state
  inputValue: string;
  isTyping: boolean;

  // Messages state
  messages: Message[];

  // File state
  uploadedFiles: UploadedFile[];
  /** Files queued from the Files tab to be restored after WorkspaceNewChat's resetChat() */
  pendingFilesForNewChat: UploadedFile[];
  currentConversationId: string | null;
  currentProjectId: string | null;

  // Processing state
  isProcessing: boolean;
  currentWorkflowStep: string | null;
  priorWorkflowSteps: string[];
  thinkingEvents: ThinkingEvent[];

  // UI state
  dropdownOpen: boolean;
  selectedDataSource: string;

  // Speech recognition state
  isListening: boolean;
  transcript: string;
  detectedLanguage: string | null;

  // Theme state
  dashboardTheme: 'light' | 'dark';
  isThemeChanging: boolean;
  hasShownInitialDashboard: boolean;
  isInitialLoading: boolean;

  // Layout state
  isDashboardOpen: boolean;

  // Dashboard update feedback state
  isUpdatingDashboard: boolean;
  // True while `selectDashboard` is awaiting the GET /dashboard fetch.
  // Drives the in-place loading pill, dim/freeze, and sidebar-disable in
  // project.tsx so the user gets immediate feedback instead of a 1–3 s
  // silent gap that ends in a layout snap.
  isSwitchingDashboard: boolean;
  previousDashboardData: unknown | null;
  changedComponentIds: Set<string>;
  dashboardThumbnails: Record<string, string>;

  // Dashboard selection state
  selectedDashboardId: string | null;

  // Original file for exports
  originalFileBlob?: Blob | null;
  originalFileName?: string | null;

  // Theme/focus state. selectedTemplate/isTemplatePending are compatibility aliases
  // for existing UI surfaces that still render a single chip.
  selectedTheme: SelectedTemplate | null;
  selectedAnalysisFocusId: string | null;
  selectedTemplate: SelectedTemplate | null;
  /** True only when the user explicitly chose a theme before submitting. False when restored from a saved dashboard. */
  isThemePending: boolean;
  isTemplatePending: boolean;

  // Abort controller for stopping generation
  abortController: AbortController | null;

  // Integration states
  isGoogleSheetsModalOpen: boolean;
  isGA4ModalOpen: boolean;
  isMetaAdsModalOpen: boolean;
  isTikTokModalOpen: boolean;
  isAppsFlyerModalOpen: boolean;
  isStripeModalOpen: boolean;
  isGoogleAdsModalOpen: boolean;
  isFirebaseModalOpen: boolean;
  isAllConnectorsModalOpen: boolean;
  isTemplateModalOpen: boolean;
  templateModalSource: 'toolbar' | 'header';
  googleSheetsFileId: string | null;
  googleSheetsFileName: string | null;

  // Pending action state for cross-page navigation
  pendingAction: PendingAction | null;

  // Selected model state
  selectedModel: 'pro' | 'fast';

  // Actions
  setInputValue: (value: string) => void;
  setIsTyping: (typing: boolean) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  addFiles: (files: UploadedFile[]) => void;
  removeFile: (fileId: string) => void;
  clearFiles: () => void;
  updateFile: (fileId: string, updates: Partial<UploadedFile>) => void;
  setPendingFilesForNewChat: (files: UploadedFile[]) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDropdownOpen: (open: boolean) => void;
  setSelectedDataSource: (source: string) => void;
  setIsListening: (listening: boolean) => void;
  setTranscript: (transcript: string) => void;
  setDetectedLanguage: (language: string | null) => void;
  setIsProcessing: (processing: boolean) => void;
  setCurrentWorkflowStep: (step: string | null) => void;
  setPriorWorkflowSteps: (steps: string[]) => void;
  setThinkingEvents: (events: ThinkingEvent[]) => void;
  clearThinkingEvents: () => void;
  updateMessages: (updater: (prev: Message[]) => Message[]) => void;
  setDashboardTheme: (theme: 'light' | 'dark') => void;
  setIsThemeChanging: (changing: boolean) => void;
  setHasShownInitialDashboard: (flag: boolean) => void;
  setIsInitialLoading: (flag: boolean) => void;
  setIsDashboardOpen: (open: boolean) => void;
  setIsUpdatingDashboard: (updating: boolean) => void;
  setIsSwitchingDashboard: (switching: boolean) => void;
  setPreviousDashboardData: (data: unknown | null) => void;
  setChangedComponentIds: (ids: Set<string>) => void;
  setDashboardThumbnail: (dashboardId: string, thumbnailUrl: string) => void;
  setSelectedDashboardId: (dashboardId: string | null) => void;
  setOriginalFile: (file: { blob: Blob; name: string } | null) => void;
  setSelectedTheme: (theme: SelectedTemplate | null, pending?: boolean) => void;
  setSelectedTemplate: (template: SelectedTemplate | null, pending?: boolean) => void;
  setCurrentProjectId: (id: string | null) => void;
  setPendingAction: (action: PendingAction | null) => void;
  setSelectedModel: (model: 'pro' | 'fast') => void;

  // Integration setters
  setGoogleSheetsModalOpen: (open: boolean) => void;
  setGA4ModalOpen: (open: boolean) => void;
  setMetaAdsModalOpen: (open: boolean) => void;
  setTikTokModalOpen: (open: boolean) => void;
  setAppsFlyerModalOpen: (open: boolean) => void;
  setStripeModalOpen: (open: boolean) => void;
  setGoogleAdsModalOpen: (open: boolean) => void;
  setFirebaseModalOpen: (open: boolean) => void;
  setAllConnectorsModalOpen: (open: boolean) => void;
  setTemplateModalOpen: (open: boolean, source?: 'toolbar' | 'header') => void;
  setGoogleSheetsFileId: (id: string | null) => void;
  setGoogleSheetsFileName: (name: string | null) => void;

  // Complex actions
  sendMessage: (content: string) => void;
  clearInput: () => void;
  resetChat: (preserveTemplate?: boolean) => void;
  processFileWithMessage: (content: string, onProcessedDataChange?: (data: unknown) => void, projectId?: string, mentionedAssetIds?: string[], activeFileAttachment?: Message['attachment'], mentionedCharts?: Array<{ id: string; componentId: string; title: string; type: string; config?: unknown }>, model?: 'pro' | 'fast', onAccepted?: () => void, onProjectNameAccepted?: (projectName: string) => void) => Promise<void>;
  submitClarificationResponse: (request: ClarificationRequest, option: ClarificationOption, freeText: string | undefined, projectId: string, onProcessedDataChange?: (data: unknown) => void, model?: 'pro' | 'fast', onAccepted?: () => void, onProjectNameAccepted?: (projectName: string) => void) => Promise<void>;
  stopGeneration: () => Promise<void>;
  resumeWorkflowPolling: (projectId: string, conversationId: string, onProcessedDataChange?: (data: unknown) => void) => Promise<void>;
  selectDashboard: (dashboardId: string, projectId: string) => Promise<unknown>;

  // Sync actions
  syncGoogleSheets: (projectId?: string, oauthToken?: string) => Promise<void>;
  syncGA4: (propertyId: string, projectId?: string, startDate?: string, endDate?: string, accountName?: string, propertyName?: string) => Promise<void>;
  syncMetaAds: (adAccountId: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string, accountName?: string, adsetIds?: string[], campaignIds?: string[]) => Promise<MetaAdsSyncResult>;
  syncAppsFlyer: (appId: string, appName: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string) => Promise<AppsFlyerSyncResult>;
  syncStripe: (reportType: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string) => Promise<StripeSyncResult>;
  syncGoogleAds: (adAccountId: string, projectId?: string, startDate?: string, endDate?: string, accountName?: string) => Promise<StripeSyncResult>;
  syncFirebase: (firebaseProjectId: string, projectName: string, projectId?: string, startDate?: string, endDate?: string) => Promise<StripeSyncResult>;
}

/** Result of AppsFlyer sync API */
export interface AppsFlyerSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
}

/** Result of Stripe sync API */
export interface StripeSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
}

export interface PendingAction {
  type: 'process_file';
  content: string;
  files: UploadedFile[];
  projectId: string;
  model?: 'pro' | 'fast';
}

// Ordered sequence of workflow steps (used to reconstruct prior steps on resume)
const STEP_ORDER = ['initializing', 'initialized', 'load_conversation', 'download_asset', 'run_workflow', 'explore_files', 'routing', 'reasoning', 'reasoning_internal', 'execution', 'synthesis', 'validation', 'finish'];

const getPriorWorkflowSteps = (step: string): string[] => {
  const stepIdx = STEP_ORDER.indexOf(step);
  return stepIdx > 0 ? STEP_ORDER.slice(0, stepIdx) : [];
};

function getPendingPromptTheme(state: Pick<ChatState, 'selectedTheme' | 'selectedTemplate' | 'isThemePending' | 'isTemplatePending'>): SelectedTemplate | null {
  if (state.isThemePending && state.selectedTheme) return state.selectedTheme;
  if (state.isTemplatePending && state.selectedTemplate) return state.selectedTemplate;
  return null;
}

function getPromptThemeMetadata(selection: SelectedTemplate | null): Partial<NonNullable<ConversationChatRequest['user_node_metadata']>> {
  return selection ? { theme_source: EXPLICIT_PROMPT_THEME_SOURCE } : {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function getClarificationAssetIds(option: ClarificationOption): string[] {
  const rawIds = option.metadata?.asset_ids;
  return Array.isArray(rawIds)
    ? rawIds.map((id) => String(id)).filter(Boolean)
    : [];
}

function getClarificationAssetRecords(option: ClarificationOption): Record<string, unknown>[] {
  const metadata = option.metadata ?? {};
  const asset = asRecord(metadata.asset);
  const assets = Array.isArray(metadata.assets)
    ? metadata.assets.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return asset ? [asset, ...assets] : assets;
}

function findClarificationAssetRecord(
  option: ClarificationOption,
  assetId: string,
): Record<string, unknown> | null {
  return getClarificationAssetRecords(option).find((asset) => (
    readString(asset.asset_id) === assetId || readString(asset.file_id) === assetId
  )) ?? null;
}

function createClarificationAssetData(
  option: ClarificationOption,
  assetId: string,
  index: number,
): Record<string, unknown> {
  const asset = findClarificationAssetRecord(option, assetId);
  const extension = readString(asset?.extension) || readString(asset?.ext);
  const sourceType = readString(asset?.sourceType) || readString(asset?.asset_type);
  const filename = readString(asset?.filename) || readString(asset?.name) || option.label;

  return compactRecord({
    asset_id: assetId,
    file_id: readString(asset?.file_id),
    filename,
    extension,
    kind: readString(asset?.kind) || (extension === 'csv' ? 'csv' : 'file'),
    sourceType,
    asset_type: readString(asset?.asset_type) || sourceType,
    accountName: readString(asset?.accountName) || readString(asset?.account_name),
    propertyName: readString(asset?.propertyName) || readString(asset?.property_name) || (index === 0 ? option.label : undefined),
    syncVersionName: readString(asset?.syncVersionName) || readString(asset?.sync_version_name),
  });
}

function buildClarificationAttachment(option: ClarificationOption): Message['attachment'] | undefined {
  const selectedAssetIds = getClarificationAssetIds(option);
  if (selectedAssetIds.length === 0) return undefined;

  const files = selectedAssetIds.map((assetId, index) => {
    const data = createClarificationAssetData(option, assetId, index);
    return {
      id: assetId,
      name: readString(data.filename) || option.label,
      ext: readString(data.extension),
      sourceType: readString(data.sourceType) || readString(data.asset_type),
      accountName: readString(data.accountName),
      propertyName: readString(data.propertyName),
      syncVersionName: readString(data.syncVersionName),
    };
  });
  const firstFile = files[0];

  return {
    kind: firstFile?.ext === 'csv' ? 'csv' : 'file',
    name: files.length > 1 ? `${files.length} files` : firstFile.name,
    sourceType: files.length > 1 ? 'Multiple' : firstFile.sourceType,
    accountName: files.length > 1 ? undefined : firstFile.accountName,
    propertyName: files.length > 1 ? undefined : firstFile.propertyName,
    syncVersionName: files.length > 1 ? undefined : firstFile.syncVersionName,
    files,
  };
}

function createClarificationResponseContents(
  request: ClarificationRequest,
  option: ClarificationOption,
  freeText?: string,
): ConversationChatRequest['user_node_contents'] {
  const selectedAssetIds = getClarificationAssetIds(option);
  const contents: ConversationChatRequest['user_node_contents'] = [
    {
      type: 'clarification_response',
      data: {
        clarification_id: request.clarification_id,
        selected_option_id: option.id,
        selected_option_label: option.label,
        free_text: freeText ?? null,
        metadata: option.metadata ?? {},
      },
    },
  ];

  selectedAssetIds.forEach((assetId, index) => {
    contents.push({
      type: 'asset',
      data: createClarificationAssetData(option, assetId, index),
    });
  });

  return contents;
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hi! I'm Dreamify, your analytics intern. Upload data, visualise motion-rich dashboard in seconds!",
    timestamp: new Date()
  }
];

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  inputValue: "",
  isTyping: false,
  messages: initialMessages,
  uploadedFiles: [],
  pendingFilesForNewChat: [],
  currentConversationId: null,
  currentProjectId: null,
  isProcessing: false,
  currentWorkflowStep: null,
  priorWorkflowSteps: [],
  thinkingEvents: [],
  dropdownOpen: false,
  selectedDataSource: "",
  isListening: false,
  transcript: "",
  detectedLanguage: null,
  dashboardTheme: 'light',
  isThemeChanging: false,
  hasShownInitialDashboard: false,
  isInitialLoading: false,
  isDashboardOpen: false,
  isUpdatingDashboard: false,
  isSwitchingDashboard: false,
  previousDashboardData: null,
  changedComponentIds: new Set<string>(),
  dashboardThumbnails: {},
  selectedDashboardId: null,
  originalFileBlob: null,
  originalFileName: null,
  selectedTheme: readPendingThemeSelection(),
  selectedAnalysisFocusId: readPendingThemeSelection()?.analysisFocusId ?? null,
  selectedTemplate: readPendingThemeSelection(),
  isThemePending: (() => { try { return !!localStorage.getItem(SELECTED_THEME_KEY) || !!localStorage.getItem(LEGACY_SELECTED_TEMPLATE_KEY); } catch { return false; } })(),
  isTemplatePending: (() => { try { return !!localStorage.getItem(SELECTED_THEME_KEY) || !!localStorage.getItem(LEGACY_SELECTED_TEMPLATE_KEY); } catch { return false; } })(),
  abortController: null,
  pendingAction: null,
  isGoogleSheetsModalOpen: false,
  isGA4ModalOpen: false,
  isMetaAdsModalOpen: false,
  isTikTokModalOpen: false,
  isAppsFlyerModalOpen: false,
  isStripeModalOpen: false,
  isGoogleAdsModalOpen: false,
  isFirebaseModalOpen: false,
  isAllConnectorsModalOpen: false,
  isTemplateModalOpen: false,
  templateModalSource: 'toolbar' as const,
  googleSheetsFileId: null,
  googleSheetsFileName: null,
  selectedModel: 'pro',

  // Basic setters
  setInputValue: (value) => set({ inputValue: value }),
  setIsTyping: (typing) => set({ isTyping: typing }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  addFiles: (files) => set((state) => {
    const currentLength = state.uploadedFiles.length;
    const newLength = currentLength + files.length;
    if (newLength > 5) {
      console.warn('Maximum 5 files allowed');
      return state;
    }
    const existingIds = new Set(state.uploadedFiles.map(f => f.fileID));
    const uniqueFiles = files.filter(f => !existingIds.has(f.fileID));
    return {
      uploadedFiles: [...state.uploadedFiles, ...uniqueFiles]
    };
  }),
  removeFile: (fileId) => set((state) => ({
    uploadedFiles: state.uploadedFiles.filter(f => f.fileID !== fileId)
  })),
  clearFiles: () => set({ uploadedFiles: [] }),
  setPendingFilesForNewChat: (files) => set({ pendingFilesForNewChat: files }),
  updateFile: (fileId, updates) => set((state) => ({
    uploadedFiles: state.uploadedFiles.map(f => f.fileID === fileId ? { ...f, ...updates } : f)
  })),
  setCurrentConversationId: (conversationId) => set({ currentConversationId: conversationId }),
  setDropdownOpen: (open) => set({ dropdownOpen: open }),
  setSelectedDataSource: (source) => set({ selectedDataSource: source }),
  setIsListening: (listening) => set({ isListening: listening }),
  setTranscript: (transcript) => set({ transcript }),
  setDetectedLanguage: (language) => set({ detectedLanguage: language }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setCurrentWorkflowStep: (step) => set({ currentWorkflowStep: step }),
  setPriorWorkflowSteps: (steps) => set({ priorWorkflowSteps: steps }),
  setThinkingEvents: (events) => set({ thinkingEvents: events }),
  clearThinkingEvents: () => set({ thinkingEvents: [] }),
  updateMessages: (updater) => set((state) => ({ messages: updater(state.messages) })),
  setDashboardTheme: (theme) => set({ dashboardTheme: theme }),
  setIsThemeChanging: (changing) => set({ isThemeChanging: changing }),
  setHasShownInitialDashboard: (flag) => set({ hasShownInitialDashboard: flag }),
  setIsInitialLoading: (flag) => set({ isInitialLoading: flag }),
  setIsDashboardOpen: (open) => set({ isDashboardOpen: open }),
  setIsUpdatingDashboard: (updating) => set({ isUpdatingDashboard: updating }),
  setIsSwitchingDashboard: (switching) => set({ isSwitchingDashboard: switching }),
  setPreviousDashboardData: (data) => set({ previousDashboardData: data }),
  setChangedComponentIds: (ids) => set({ changedComponentIds: ids }),
  setDashboardThumbnail: (dashboardId, thumbnailUrl) => set((state) => ({
    dashboardThumbnails: { ...state.dashboardThumbnails, [dashboardId]: thumbnailUrl }
  })),
  setSelectedDashboardId: (dashboardId) => {
    const restoredTheme = dashboardId
      ? resolveStoredTheme(getThemeIdForDashboard(dashboardId), null, getLegacyTemplateIdForDashboard(dashboardId))
      : null;
    set({
      selectedDashboardId: dashboardId,
      selectedTheme: restoredTheme,
      selectedAnalysisFocusId: restoredTheme?.analysisFocusId ?? null,
      selectedTemplate: restoredTheme,
      isThemePending: false,
      isTemplatePending: false,
    });
  },
  setOriginalFile: (file) => set({ originalFileBlob: file?.blob ?? null, originalFileName: file?.name ?? null }),
  setSelectedTheme: (template, pending = true) => {
    const themeId = getThemeId(template);
    try {
      if (template) {
        persistPendingThemeSelection(pending ? template : null);
        const { selectedDashboardId, currentConversationId, currentProjectId } = get();
        if (selectedDashboardId && themeId) {
          saveDashboardThemeId(selectedDashboardId, themeId);
          // Persist to backend only when changing theme on an existing dashboard
          // (pending=false = post-run change from dashboard header).
          // Skip when pending=true: that means a pre-run toolbar pick for the NEXT
          // generation — it must NOT overwrite the current dashboard in S3.
          if (!pending && currentConversationId && currentProjectId) {
            import('@/services/conversationService').then(({ conversationService }) => {
              conversationService.updateDashboardTheme(
                currentConversationId,
                selectedDashboardId,
                currentProjectId,
                themeId,
              );
            });
          }
        }
      } else {
        persistPendingThemeSelection(null);
      }
    } catch { /* ignore */ }
    set({
      selectedTheme: template,
      selectedAnalysisFocusId: template?.analysisFocusId ?? null,
      selectedTemplate: template,
      isThemePending: pending && !!template,
      isTemplatePending: pending && !!template,
    });
  },
  setSelectedTemplate: (template, pending = true) => get().setSelectedTheme(template, pending),
  setPendingAction: (action) => set({ pendingAction: action }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setGoogleSheetsModalOpen: (open) => set({ isGoogleSheetsModalOpen: open }),
  setGA4ModalOpen: (open) => set({ isGA4ModalOpen: open }),
  setMetaAdsModalOpen: (open) => set({ isMetaAdsModalOpen: open }),
  setTikTokModalOpen: (open) => set({ isTikTokModalOpen: open }),
  setAppsFlyerModalOpen: (open) => set({ isAppsFlyerModalOpen: open }),
  setStripeModalOpen: (open) => set({ isStripeModalOpen: open }),
  setGoogleAdsModalOpen: (open) => set({ isGoogleAdsModalOpen: open }),
  setFirebaseModalOpen: (open) => set({ isFirebaseModalOpen: open }),
  setAllConnectorsModalOpen: (open) => set({ isAllConnectorsModalOpen: open }),
  setTemplateModalOpen: (open, source = 'toolbar') => set({ isTemplateModalOpen: open, templateModalSource: source }),
  setGoogleSheetsFileId: (id) => {
    console.log('Store: setting googleSheetsFileId:', id);
    set({ googleSheetsFileId: id });
  },
  setGoogleSheetsFileName: (name) => {
    console.log('Store: setting googleSheetsFileName:', name);
    set({ googleSheetsFileName: name });
  },
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  // Sync actions implementation
  syncGoogleSheets: async (projectId, oauthToken) => {
    const { googleSheetsFileId, googleSheetsFileName, addFiles, setGoogleSheetsFileId, setGoogleSheetsFileName, setGoogleSheetsModalOpen } = get();
    if (!googleSheetsFileId) return;

    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleSheetData(googleSheetsFileId, projectId, oauthToken);

      if (response.success && response.asset) {
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'Google Sheets',
          accountName: 'Google Sheets',
          propertyName: googleSheetsFileName || response.asset.filename,
          rowCount: response.asset.row_count,
          columnCount: response.asset.column_count,
        };

        addFiles([newFile]);
        setGoogleSheetsFileId(null);
        setGoogleSheetsFileName(null);
        setGoogleSheetsModalOpen(false);
        emitConnectorSynced('Google Sheets');
      } else {
        throw new Error(response.error || 'Failed to sync Google Sheets');
      }
    } catch (err) {
      console.error('Sync Google Sheets error:', err);
      throw err;
    }
  },

  syncGA4: async (propertyId, projectId, startDate, endDate, accountName, propertyName) => {
    const { addFiles, setGA4ModalOpen } = get();
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleAnalyticsData(
        propertyId,
        projectId,
        startDate || '30daysAgo',
        endDate || 'today',
        accountName || 'GA4',
        propertyName || 'GA4',
      );

      if (response.success && response.asset) {
        const assetMetadata = response.asset as AssetRecord & {
          accountName?: string;
          propertyName?: string;
        };
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'GA4',
          accountName: accountName || assetMetadata.accountName || 'GA4',
          propertyName: propertyName || assetMetadata.propertyName || response.asset.filename,
        };
        addFiles([newFile]);
        setGA4ModalOpen(false);
        emitConnectorSynced('GA4');
      } else {
        throw new Error(response.error || 'Failed to sync GA4');
      }
    } catch (err) {
      console.error('Sync GA4 error:', err);
      throw err;
    }
  },

  syncMetaAds: async (adAccountId, projectId, datePreset, startDate, endDate, accountName, adsetIds, campaignIds) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncMetaAdsData(
        adAccountId,
        projectId,
        datePreset || 'last_30d',
        startDate,
        endDate,
        accountName || 'Meta Ads',
        adsetIds,
        campaignIds
      );

      if (response.success && response.asset) {
        emitConnectorSynced('Meta Ads');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Meta Ads');
    } catch (err) {
      console.error('Sync Meta Ads error:', err);
      throw err;
    }
  },

  syncTikTokAds: async (adAccountId, projectId, datePreset, startDate, endDate, accountName) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncTikTokAdsData(
        adAccountId,
        projectId,
        datePreset || 'last_30d',
        startDate,
        endDate,
        accountName || 'TikTok Ads',
      );

      if (response.success && response.asset) {
        emitConnectorSynced('TikTok Ads');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync TikTok Ads');
    } catch (err) {
      console.error('Sync TikTok Ads error:', err);
      throw err;
    }
  },

  syncAppsFlyer: async (appId, appName, projectId, datePreset, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncAppsFlyer({
        app_id: appId,
        app_name: appName,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('AppsFlyer');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync AppsFlyer');
    } catch (err) {
      console.error('Sync AppsFlyer error:', err);
      throw err;
    }
  },

  syncStripe: async (reportType, projectId, datePreset, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncStripe({
        report_type: reportType,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Stripe');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Stripe');
    } catch (err) {
      console.error('Sync Stripe error:', err);
      throw err;
    }
  },

  syncGoogleAds: async (adAccountId, projectId, startDate, endDate, accountName) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleAdsData({
        ad_account_id: adAccountId,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(accountName && { account_name: accountName }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Google Ads');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Google Ads');
    } catch (err) {
      console.error('Sync Google Ads error:', err);
      throw err;
    }
  },

  syncFirebase: async (firebaseProjectId, projectName, projectId, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncFirebaseData({
        firebase_project_id: firebaseProjectId,
        app_name: projectName,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Firebase');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Firebase data');
    } catch (err) {
      console.error('Sync Firebase error:', err);
      throw err;
    }
  },

	  // Complex actions
	  sendMessage: (content) => {
	    const promptTheme = getPendingPromptTheme(get());
	    const promptFiles = getExplicitPromptFiles(get().uploadedFiles);
	    const userMessage: Message = {
	      id: Date.now().toString(),
	      role: "user",
	      content: content.trim(),
      timestamp: new Date(),
      attachment: buildAttachmentFromFiles(promptFiles),
	      template: promptTheme || undefined,
	    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      inputValue: ""
    }));
  },

  clearInput: () => set({ inputValue: "" }),

	  processFileWithMessage: async (content: string, onProcessedDataChange?: (data: unknown) => void, projectIdParam?: string, mentionedAssetIds?: string[], activeFileAttachment?: Message['attachment'], mentionedCharts?: Array<{ id: string; componentId: string; title: string; type: string; config?: unknown }>, model?: 'pro' | 'fast', onAccepted?: () => void, onProjectNameAccepted?: (projectName: string) => void) => {
	    const state = get();
	    const { uploadedFiles, updateFile, setIsProcessing, setIsTyping, addMessage, updateMessages, messages, setDashboardTheme, setIsThemeChanging, hasShownInitialDashboard, dashboardTheme, currentConversationId, setCurrentConversationId, setCurrentWorkflowStep, setPriorWorkflowSteps } = state;
	    const promptTheme = getPendingPromptTheme(state);
	    const promptThemeId = getThemeId(promptTheme);
	    const promptAnalysisFocusId = getAnalysisFocusId(promptTheme);
	    const promptThemeMetadata = getPromptThemeMetadata(promptTheme);

    // Create new AbortController for this processing session
    const abortController = new AbortController();
    set({ abortController, currentProjectId: projectIdParam || null, thinkingEvents: [], priorWorkflowSteps: [] });

    // Clear current workflow step at start
    setCurrentWorkflowStep(null);
    setPriorWorkflowSteps([]);

    const explicitAssetIds = getExplicitPromptAssetIds(uploadedFiles, mentionedAssetIds ?? []);
    const explicitPromptFiles = getExplicitPromptFiles(uploadedFiles, explicitAssetIds);
    const freshPromptUploads = uploadedFiles.filter(isFreshPromptUpload);

    // Text-only message path: allow theme change after initial dashboard shown, only if currently light
    // @mentioned files should use Q&A path (they're already in conversation)
    const hasUploadedFiles = freshPromptUploads.length > 0;

    // Clear uploaded files immediately so they disappear from the input chips area 
    // once the message start process is initiated.
    get().clearFiles();

    const isTextOnly = !hasUploadedFiles;

    if (isTextOnly) {
      // No file uploaded - process Q&A (with or without existing conversation)
      console.log('No file - processing Q&A', { hasConversation: !!currentConversationId, projectId: projectIdParam });

      // Check if we have projectId (required for API call)
      if (!projectIdParam) {
        console.log('No projectId - cannot process Q&A');
        const userMessage: Message = {
	          id: Date.now().toString(),
	          role: "user",
	          content: content.trim(),
	          timestamp: new Date(),
	          template: promptTheme || undefined,
	        };
        addMessage(userMessage);

        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Project context is required. Please ensure you are in a project workspace.",
          timestamp: new Date(),
        };
        addMessage(errorMessage);
        return;
      }

      // Process Q&A (with or without existing conversation)
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          attachment: activeFileAttachment || buildAttachmentFromFiles(explicitPromptFiles),
	          chartMentions: mentionedCharts && mentionedCharts.length > 0
	            ? mentionedCharts.map(c => ({ title: c.title, type: c.type, componentId: c.componentId || c.id }))
	            : undefined,
	          template: promptTheme || undefined,
	        };
        addMessage(userMessage);
      }

      setIsTyping(true);
      setIsProcessing(true);

      // If dashboard is already open, mark as updating for edit feedback loop
      if (get().isDashboardOpen) {
        set({ isUpdatingDashboard: true });
      }

      // Update file status to processing to show loading indicator in chip
      // Skip files already 'processed' from previous conversation (restored on reload)
      explicitPromptFiles
        .filter(f => f.status !== 'processed')
        .forEach(f => updateFile(f.fileID, { status: 'processing' }));

      try {
        // Use projectId from parameter (required)
        const projectId = projectIdParam;

        if (!projectId) {
          throw new Error('Project context missing. Please ensure you are in a project workspace.');
        }

        // Only attach asset content if this is a NEW file upload, not an @mention of existing file
        const freshUploads = freshPromptUploads;

        let assetContents: ConversationChatRequest['user_node_contents'] = undefined;
        const assetId: string | null = freshUploads[0]?.fileID ?? null;

        const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
        for (const file of freshUploads) {
          try {
            const { fileService } = await import('@/services/fileService');
            const assetResponse = await fileService.getAsset(file.fileID);
            if (assetResponse.success && assetResponse.asset) {
              const assetData = assetResponse.asset;
              assetContentsList.push({
                type: 'asset',
                data: {
                  asset_id: assetData.asset_id,
                  file_id: assetData.file_id,
                  s3_bucket: assetData.s3_bucket,
                  s3_key: assetData.s3_key,
                  extension: assetData.extension,
                  filename: assetData.filename,
                  sourceType: assetData?.asset_type || '',
                  accountName: file.accountName,
                  propertyName: file.propertyName,
                  syncVersionName: file.syncVersionName,
                }
              });
            }
          } catch (error) {
            console.warn('Failed to fetch asset data for QnA:', error);
          }
        }

        // Add @selected files as asset content so backend can enrich and Morpheus can analyze
        // only the explicit assets the user chose.
        if (mentionedAssetIds && mentionedAssetIds.length > 0) {
          for (const mentionedId of mentionedAssetIds) {
            if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
            const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
            if (mentionedFile) {
              assetContentsList.push({
                type: 'asset',
                data: {
                  asset_id: mentionedId,
                  filename: mentionedFile.filename,
                  kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                  sourceType: mentionedFile?.sourceType || '',
                  accountName: mentionedFile.accountName,
                  propertyName: mentionedFile.propertyName,
                  syncVersionName: mentionedFile.syncVersionName,
                }
              });
            }
          }
        }

        // Add chart mention entries
        if (mentionedCharts && mentionedCharts.length > 0) {
          for (const chart of mentionedCharts) {
            assetContentsList.push({
              type: 'chart_mention',
              data: {
                component_id: chart.componentId,
                chart_id: chart.id,
                title: chart.title,
                chart_type: chart.type,
                config: chart.config,
              }
            });
          }
        }

        if (assetContentsList.length > 0) {
          assetContents = assetContentsList;
        }

        const assetSelectionMetadata = explicitAssetIds.length > 0
          ? { asset_selection: 'explicit' as const, selected_asset_ids: explicitAssetIds, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
          : { asset_selection: 'none' as const, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) };
        const userNodeMetadata = {
          ...assetSelectionMetadata,
          ...promptThemeMetadata,
        };

	        // Call processing service with file attachment if available
	        const startResult = await processingService.runProcessing(
	          projectId,
	          assetId,
          content,
          currentConversationId || undefined,  // Use existing conversation if available
	          assetContents,
	          userNodeMetadata,
	          model,
	          promptThemeId,
	          promptAnalysisFocusId
	        );

        console.log('Q&A processing result:', startResult);

        if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
          // Invoke onAccepted callback to allow early UI updates (e.g. credit refresh)
          if (onAccepted) onAccepted();
          const acceptedProjectName = startResult.data?.project_name;
          if (typeof acceptedProjectName === 'string' && acceptedProjectName.trim()) {
            onProjectNameAccepted?.(acceptedProjectName.trim());
          }

          const conversationId = startResult.data?.conversation_id || currentConversationId;
          if (conversationId) {
            setCurrentConversationId(conversationId);
          }

          // Poll for completion
          const finalResult = await processingService.pollProcessingStatus(
            '',  // No assetId for Q&A
            projectId,
            conversationId,
            (status) => {
              // Update status based on workflow status
              const workflowStatus = status.data?.workflow_status?.status;

              // For QnA: DON'T update uploadedFile status to 'processing'
              // This prevents ProjectPage from showing "Generating Dashboard"
              // Keep status as 'uploaded' until QnA completes
              if (workflowStatus === 'error') {
                explicitPromptFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
              }

              if (workflowStatus === 'error' || workflowStatus === 'stopped') {
                setIsProcessing(false);
              }
              if (workflowStatus === 'stopped') {
                setIsTyping(false);
              }
              // Track current workflow step
              const step = status.data?.workflow_status?.metadata?.step;
              if (step) {
                setCurrentWorkflowStep(step);
                setPriorWorkflowSteps(getPriorWorkflowSteps(step));
              }
            },
            360,
            5000,
            abortController.signal
          );

          console.log('Q&A final result:', finalResult);

	          if (finalResult.data?.success && finalResult.data?.status === 'awaiting_user_input') {
	            try {
	              const { conversationService } = await import('@/services/conversationService');
	              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	              const restoredMessages = conversationNodesToMessages(conversationResponse.conversation);
	              if (restoredMessages.length) {
	                get().setMessages(restoredMessages);
	              }
	            } catch (error) {
	              console.error('Failed to load clarification request:', error);
	            }
	          } else if (finalResult.data?.success && finalResult.data?.status === 'completed') {
	            if (promptTheme) {
	              persistPendingThemeSelection(null);
	              set({ isThemePending: false, isTemplatePending: false });
	            }
	            // Q&A response - check if it's a message or dashboard
	            if (finalResult.data?.dashboard_data) {
              // Dashboard response - load conversation to get LLM's actual response text
              try {
                const { conversationService } = await import('@/services/conversationService');
                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
                const conversation = conversationResponse.conversation;

                // Extract dashboard_id from conversation
                const dashboards = conversation.dashboards || [];
                const latestDashboard = dashboards[dashboards.length - 1];
                const dashboardId = latestDashboard?.dashboard_id || "";

	                // Set the latest dashboard as selected and update processedData
	                if (dashboardId) {
	                  set({ selectedDashboardId: dashboardId, isDashboardOpen: true });
	                  const generatedTheme = resolveStoredTheme(
	                    finalResult.data.dashboard_data?.theme_id ?? null,
	                    finalResult.data.dashboard_data?.analysis_focus_id ?? null,
	                    finalResult.data.dashboard_data?.template_id ?? null,
	                  );
	                  const appliedTheme = promptTheme ?? generatedTheme;
	                  const themeId = getThemeId(appliedTheme);
	                  if (themeId) {
	                    saveDashboardThemeId(dashboardId, themeId);
	                  }
	                  persistPendingThemeSelection(null);
	                  set({
	                    selectedTheme: appliedTheme,
	                    selectedAnalysisFocusId: appliedTheme?.analysisFocusId ?? null,
	                    selectedTemplate: appliedTheme,
	                    isThemePending: false,
	                    isTemplatePending: false,
	                  });
                  // Update processedData with the new dashboard data (first file for display)
                  const firstFile = get().uploadedFiles[0];
                  if (firstFile) {
                    updateFile(firstFile.fileID, { status: 'processed', processedData: finalResult.data.dashboard_data });
                  }

                  // Signal completion to UI for automatic rendering (unconditional)
                  if (onProcessedDataChange) {
                    onProcessedDataChange(finalResult.data.dashboard_data);
                  }

                  // Auto-capture PNG preview (fire-and-forget, non-blocking)
                  const _captureProjectId = projectId;
                  const _captureDashboardId = dashboardId;
                  setTimeout(async () => {
                    try {
                      const { captureDashboardAsWebpBlob } = await import('@/utils/exportUtils');
                      const blob = await captureDashboardAsWebpBlob('dashboard-preview-root');
                      if (blob && _captureProjectId && _captureDashboardId) {
                        const { projectService } = await import('@/services/projectService');
                        await projectService.uploadDashboardPreview(_captureProjectId, _captureDashboardId, blob);
                        console.log('Dashboard preview captured and uploaded for project', _captureProjectId);
                      }
                    } catch (e) {
                      console.warn('Dashboard preview capture failed (non-critical):', e);
                    }
                  }, 4000);
                }

                const firstFile = get().uploadedFiles[0];
                const restoredAttachmentFiles = get().uploadedFiles.map((file) => ({
                  id: file.fileID,
                  name: file.filename,
                  ext: file.ext,
                  sourceType: file.sourceType,
                  accountName: file.accountName,
                  propertyName: file.propertyName,
                  syncVersionName: file.syncVersionName,
                }));
                const restoredMessages = conversationNodesToMessages(conversation, {
                  sourceFileName: firstFile?.filename || 'dashboard',
                  lastUserMessageAttachment: firstFile ? {
                    kind: 'csv',
                    name: restoredAttachmentFiles.length > 1 ? `${restoredAttachmentFiles.length} files` : firstFile.filename,
                    mime: 'text/csv',
                    sourceType: restoredAttachmentFiles.length > 1 ? 'Multiple' : firstFile.sourceType,
                    accountName: restoredAttachmentFiles.length > 1 ? undefined : firstFile.accountName,
                    propertyName: restoredAttachmentFiles.length > 1 ? undefined : firstFile.propertyName,
                    syncVersionName: restoredAttachmentFiles.length > 1 ? undefined : firstFile.syncVersionName,
                    files: restoredAttachmentFiles,
                  } : undefined
                });
                if (restoredMessages.length) {
                  const lastRestored = restoredMessages[restoredMessages.length - 1];

                  // Case 1: Last message is assistant with dashboardCard but empty content
                  if (lastRestored?.role === 'assistant' && lastRestored.dashboardCard && !lastRestored.content) {
                    const prevUserMsg = [...restoredMessages].reverse().find(m => m.role === 'user' && m.chartMentions?.length);
                    if (prevUserMsg?.chartMentions?.length) {
                      const chartNames = prevUserMsg.chartMentions.map(c => c.title).filter(Boolean).join(', ');
                      lastRestored.content = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
                    } else {
                      lastRestored.content = 'Your dashboard has been updated with the requested changes.';
                    }
                  }

                  // Case 2: Last message is a user message — backend's assistant node was filtered out
                  // (no text, no dashboard content). Synthesize a response.
                  if (lastRestored?.role === 'user') {
                    const chartMentions = lastRestored.chartMentions;
                    let responseContent = 'Your dashboard has been updated with the requested changes.';
                    if (chartMentions?.length) {
                      const chartNames = chartMentions.map(c => c.title).filter(Boolean).join(', ');
                      responseContent = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
                    }
                    restoredMessages.push({
                      id: (Date.now() + 1).toString(),
                      role: 'assistant',
                      content: responseContent,
                      dashboardCard: {
                        sourceFileName: get().uploadedFiles[0]?.filename || 'dashboard',
                        dashboardId: dashboardId,
                        dashboardTitle: latestDashboard?.title || undefined,
                        accountName: get().uploadedFiles[0]?.accountName,
                        sourceType: get().uploadedFiles[0]?.sourceType,
                      },
                      timestamp: new Date(),
                    });
                  }

                  get().setMessages(restoredMessages);
                }
              } catch (error) {
                console.error('Failed to load conversation for dashboard response:', error);
                // No fallback message
                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: "",
                    dashboardCard: {
                      sourceFileName: get().uploadedFiles[0]?.filename || "dashboard",
                      dashboardId: "",
                      accountName: get().uploadedFiles[0]?.accountName,
                      sourceType: get().uploadedFiles[0]?.sourceType,
                    },
                    timestamp: new Date(),
                  }
                ]));
              }
	            } else {
	              // Q&A text response - load conversation and show all nodes in workflow order
	              if (promptTheme) {
	                persistPendingThemeSelection(null);
	                set({ isThemePending: false, isTemplatePending: false });
	              }
	              try {
                const { conversationService } = await import('@/services/conversationService');
                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
                const conversation = conversationResponse.conversation;
                const restoredMessages = conversationNodesToMessages(conversation);
                if (restoredMessages.length) {
                  get().setMessages(restoredMessages);

                  // Auto-open dashboard if the latest message includes a dashboard card
                  const lastMsg = restoredMessages[restoredMessages.length - 1];
                  const dashId = lastMsg?.dashboardCard?.dashboardId;
                  if (dashId) {
                    set({
                      isDashboardOpen: true,
                      hasShownInitialDashboard: true,
                      isInitialLoading: false,
                    });
                    get().selectDashboard(dashId, projectId).then((data) => {
                      if (data && onProcessedDataChange) {
                        onProcessedDataChange(data);
                      }
                    });
                  }
                }
                // Update file status to processed to hide chip
                get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'processed' }));
              } catch (error) {
                console.error('Failed to load conversation for Q&A response:', error);
                // Fallback to workflow status metadata
                const workflowStatus = finalResult.data?.workflow_status;
                const responseText = workflowStatus?.metadata?.content ||
                  workflowStatus?.message ||
                  "I've processed your question.";

                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                  }
                ]));
              }
            }
          } else if (finalResult.data?.status === 'error') {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your question.';
            explicitPromptFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          }
        } else {
          const errorMsg = startResult.data?.error || 'Failed to start processing.';
          updateMessages((prev) => ([
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: 'Error while generating dashboard',
              timestamp: new Date(),
              isError: true,
            }
          ]));
        }
      } catch (error) {
        console.error('Q&A processing error:', error);
        explicitPromptFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
        const errObj = error as Record<string, unknown>;
        const errDetail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        const isInsufficientCredits =
          errObj?.status === 402 ||
          (errDetail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
          (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Error while generating dashboard',
            timestamp: new Date(),
            isError: true,
            isInsufficientCredits,
          }
        ]));
      } finally {
        setIsTyping(false);
        setIsProcessing(false);
        set({ isUpdatingDashboard: false });
      }
      return;
    }

    // Check if user message with this content already exists
    const firstUploadedFile = freshPromptUploads[0];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
      // User message doesn't exist, add it
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        attachment: activeFileAttachment || buildAttachmentFromFiles(explicitPromptFiles),
	        chartMentions: mentionedCharts && mentionedCharts.length > 0
	          ? mentionedCharts.map(c => ({ title: c.title, type: c.type, componentId: c.componentId || c.id }))
	          : undefined,
	        template: promptTheme || undefined,
	      };
      addMessage(userMessage);
    }

    // Get updated messages after adding user message
    const updatedMessages = get().messages;
    setIsTyping(true);
    setIsProcessing(true);

    try {
      // Start processing with user prompt - set all files to processing
      set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => isFreshPromptUpload(f) ? { ...f, status: 'processing' as const } : f) }));
      const projectId = projectIdParam || firstUploadedFile.projectId;
      if (!projectId) {
        throw new Error('Project context missing for uploaded file');
      }

      console.log('Starting processing for fileIDs:', freshPromptUploads.map(f => f.fileID));
      const freshUploadsForProcessing = freshPromptUploads;
      const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
      for (const file of freshUploadsForProcessing) {
        try {
          const { fileService } = await import('@/services/fileService');
          const assetResponse = await fileService.getAsset(file.fileID);
          if (assetResponse.success && assetResponse.asset) {
            const assetData = assetResponse.asset;
            assetContentsList.push({
              type: 'asset',
              data: {
                asset_id: assetData.asset_id,
                file_id: assetData.file_id,
                s3_bucket: assetData.s3_bucket,
                s3_key: assetData.s3_key,
                extension: assetData.extension,
                filename: assetData.filename,
                sourceType: assetData?.asset_type || '',
                accountName: file.accountName,
                propertyName: file.propertyName,
                syncVersionName: file.syncVersionName,
              }
            });
          }
        } catch (error) {
          console.warn('Failed to fetch asset data:', error);
        }
      }

      // Add @selected files as asset content so backend can enrich and Morpheus can analyze
      // only the explicit assets the user chose.
      if (mentionedAssetIds && mentionedAssetIds.length > 0) {
        for (const mentionedId of mentionedAssetIds) {
          if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
          const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
          if (mentionedFile) {
            assetContentsList.push({
              type: 'asset',
              data: {
                asset_id: mentionedId,
                filename: mentionedFile.filename,
                kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                sourceType: mentionedFile?.sourceType || '',
                accountName: mentionedFile.accountName,
                propertyName: mentionedFile.propertyName,
                syncVersionName: mentionedFile.syncVersionName,
              }
            });
          }
        }
      }

      // Add chart mention entries (second code path)
      if (mentionedCharts && mentionedCharts.length > 0) {
        for (const chart of mentionedCharts) {
          assetContentsList.push({
            type: 'chart_mention',
            data: {
              component_id: chart.componentId,
              chart_id: chart.id,
              title: chart.title,
              chart_type: chart.type,
              config: chart.config,
            }
          });
        }
      }

      const assetContents = assetContentsList.length > 0 ? assetContentsList : undefined;
	      const assetSelectionMetadata = explicitAssetIds.length > 0
	        ? { asset_selection: 'explicit' as const, selected_asset_ids: explicitAssetIds, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
	        : { asset_selection: 'none' as const, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) };
	      const userNodeMetadata = {
	        ...assetSelectionMetadata,
	        ...promptThemeMetadata,
	      };

	      const startResult = await processingService.runProcessing(
	        projectId,
	        firstUploadedFile.fileID,
        content,
        firstUploadedFile.conversationId || currentConversationId || undefined,
	        assetContents,
	        userNodeMetadata,
	        model,
	        promptThemeId,
	        promptAnalysisFocusId
	      );
      console.log('Run processing result:', startResult);
      // processing or accepted
      if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
        // Invoke onAccepted callback to allow early UI updates (e.g. credit refresh)
        if (onAccepted) onAccepted();
        const acceptedProjectName = startResult.data?.project_name;
        if (typeof acceptedProjectName === 'string' && acceptedProjectName.trim()) {
          onProjectNameAccepted?.(acceptedProjectName.trim());
        }

        const conversationId = startResult.data?.conversation_id;
        if (conversationId) {
          set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, conversationId })), currentConversationId: conversationId }));
          setCurrentConversationId(conversationId);
        }

        console.log('Processing started, beginning polling...');
        const finalResult = await processingService.pollProcessingStatus(
          firstUploadedFile.fileID,
          projectId,
          conversationId,
          (status) => {
            const workflowStatus = status.data?.workflow_status?.status;
            if (workflowStatus === 'processing') {
              set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: 'processing' as const })) }));
            } else if (workflowStatus === 'error' || workflowStatus === 'stopped') {
              const newStatus = workflowStatus === 'stopped' ? 'processed' : 'error';
              set((s) => ({
                uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: newStatus }))
              }));
            }
            if (workflowStatus === 'stopped') {
              setIsProcessing(false);
              setIsTyping(false);
            }
            const step = status.data?.workflow_status?.metadata?.step;
            if (step) {
              setCurrentWorkflowStep(step);
              setPriorWorkflowSteps(getPriorWorkflowSteps(step));
            }
          },
          360, // max attempts (30 minutes)
          5000, // 5 second intervals
          abortController.signal
        );
        console.log('Final polling result:', finalResult);

	        if (finalResult.data?.success && finalResult.data?.status === 'awaiting_user_input') {
	          try {
	            const { conversationService } = await import('@/services/conversationService');
	            const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	            const restoredMessages = conversationNodesToMessages(conversationResponse.conversation);
	            if (restoredMessages.length) {
	              get().setMessages(restoredMessages);
	            }
	          } catch (error) {
	            console.error('Failed to load clarification request:', error);
	          }
	        } else if (finalResult.data?.success && finalResult.data?.status === 'completed') {
	          if (promptTheme) {
	            persistPendingThemeSelection(null);
	            set({ isThemePending: false, isTemplatePending: false });
	          }
	          if (finalResult.data?.dashboard_data) {
            const files = get().uploadedFiles;
            if (files.length > 0) {
              updateFile(files[0].fileID, { status: 'processed', processedData: finalResult.data?.dashboard_data });
            }
            // Load conversation to get LLM's actual response text and dashboard_id
            try {
              const { conversationService } = await import('@/services/conversationService');
              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
              const conversation = conversationResponse.conversation;

              // Extract dashboard_id from conversation
              const dashboards = conversation.dashboards || [];
              const latestDashboard = dashboards[dashboards.length - 1];
              const dashboardId = latestDashboard?.dashboard_id || "";

              // Set the latest dashboard as selected and update processedData
              if (dashboardId) {
                // Auto open the dashboard FIRST, before signaling data
                set({
                  selectedDashboardId: dashboardId,
                  isDashboardOpen: true,
                  hasShownInitialDashboard: true,
                  isInitialLoading: false,
                });
                const files = get().uploadedFiles;
                if (files.length > 0) {
                  updateFile(files[0].fileID, { processedData: finalResult.data.dashboard_data });
                }
                // Signal completion to UI for automatic rendering
                if (onProcessedDataChange) {
                  onProcessedDataChange(finalResult.data.dashboard_data);
                }

                // Auto-capture PNG preview (fire-and-forget, non-blocking)
                const _captureProjectId2 = projectId;
                const _captureDashboardId2 = dashboardId;
                setTimeout(async () => {
                  try {
                    const { captureDashboardAsWebpBlob } = await import('@/utils/exportUtils');
                    const blob = await captureDashboardAsWebpBlob('dashboard-preview-root');
                    if (blob && _captureProjectId2 && _captureDashboardId2) {
                      const { projectService } = await import('@/services/projectService');
                      await projectService.uploadDashboardPreview(_captureProjectId2, _captureDashboardId2, blob);
                      console.log('Dashboard preview captured and uploaded for project', _captureProjectId2);
                    }
                  } catch (e) {
                    console.warn('Dashboard preview capture failed (non-critical):', e);
                  }
                }, 4000);

	                const generatedTheme = resolveStoredTheme(
	                  finalResult.data.dashboard_data?.theme_id ?? null,
	                  finalResult.data.dashboard_data?.analysis_focus_id ?? null,
	                  finalResult.data.dashboard_data?.template_id ?? null,
	                );
	                const appliedTheme = promptTheme ?? generatedTheme;
	                const themeId = getThemeId(appliedTheme);
	                if (dashboardId && themeId) {
	                  saveDashboardThemeId(dashboardId, themeId);
	                }
	                persistPendingThemeSelection(null);
	                set({
	                  selectedTheme: appliedTheme,
	                  selectedAnalysisFocusId: appliedTheme?.analysisFocusId ?? null,
	                  selectedTemplate: appliedTheme,
	                  isThemePending: false,
	                  isTemplatePending: false,
	                });
              }

              const currentFiles = get().uploadedFiles;
              const restoredAttachmentFiles = currentFiles.map((file) => ({
                id: file.fileID,
                name: file.filename,
                ext: file.ext,
                sourceType: file.sourceType,
                accountName: file.accountName,
                propertyName: file.propertyName,
                syncVersionName: file.syncVersionName,
              }));
              const restoredMessages = conversationNodesToMessages(conversation, {
                sourceFileName: currentFiles[0]?.filename ?? 'dashboard',
                lastUserMessageAttachment: currentFiles[0] ? {
                  kind: 'csv',
                  name: restoredAttachmentFiles.length > 1 ? `${restoredAttachmentFiles.length} files` : currentFiles[0].filename,
                  sourceType: restoredAttachmentFiles.length > 1 ? 'Multiple' : currentFiles[0].sourceType,
                  accountName: restoredAttachmentFiles.length > 1 ? undefined : currentFiles[0].accountName,
                  propertyName: restoredAttachmentFiles.length > 1 ? undefined : currentFiles[0].propertyName,
                  syncVersionName: restoredAttachmentFiles.length > 1 ? undefined : currentFiles[0].syncVersionName,
                  files: restoredAttachmentFiles,
                } : undefined,
              });
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);
              }

              // DON'T clear uploadedFile - ProjectPage needs it to determine dashboard display
              // The FilePreviewChip will be hidden based on processing status
              // setUploadedFile(null); // REMOVED - causes dashboard to disappear in ProjectPage
            } catch (error) {
              console.error('Failed to load conversation for dashboard response:', error);
              // No fallback message
              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 3).toString(),
                  role: 'assistant',
                  content: "",
                  dashboardCard: {
                    sourceFileName: get().uploadedFiles[0]?.filename ?? "dashboard",
                    dashboardId: "",
                    accountName: get().uploadedFiles[0]?.accountName,
                    sourceType: get().uploadedFiles[0]?.sourceType,
                  },
                  timestamp: new Date(),
                }
              ]));

              // DON'T clear uploadedFile - see comment above
              // setUploadedFile(null); // REMOVED
            }

            if (conversationId) {
              setCurrentConversationId(conversationId);
            }
	          } else {
	            // Q&A text response (with @mentioned file) - load conversation and show response
	            console.log('Q&A response detected (no dashboard_data) - loading conversation');
	            if (promptTheme) {
	              persistPendingThemeSelection(null);
	              set({ isThemePending: false, isTemplatePending: false });
	            }
	            try {
              const { conversationService } = await import('@/services/conversationService');
              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
              const conversation = conversationResponse.conversation;
              const restoredMessages = conversationNodesToMessages(conversation);
              console.log('Q&A conversation loaded, restored', restoredMessages.length, 'messages');
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);

                // Auto-open dashboard if the latest message includes a dashboard card
                const lastMsg = restoredMessages[restoredMessages.length - 1];
                const dashId = lastMsg?.dashboardCard?.dashboardId;
                if (dashId) {
                  set({
                    isDashboardOpen: true,
                    hasShownInitialDashboard: true,
                    isInitialLoading: false,
                  });
                  get().selectDashboard(dashId, projectId).then((data) => {
                    if (data && onProcessedDataChange) {
                      onProcessedDataChange(data);
                    }
                  });
                }
              }
            } catch (error) {
              console.error('Failed to load conversation for Q&A response:', error);
              // Fallback to workflow status metadata
              const workflowStatus = finalResult.data?.workflow_status;
              const responseText = workflowStatus?.metadata?.content ||
                workflowStatus?.message ||
                "I've processed your question.";

              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: responseText,
                  timestamp: new Date(),
                }
              ]));
            }
          }
        } else {
          // Explicitly handle error status from polling
          if (finalResult.data?.status === 'error' || !finalResult.success) {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your request.';
            get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));

            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          } else {
            // Timeout or unknown state — show explicit error to user
            const timeoutMsg = finalResult.data?.error || 'Processing timed out. Please try again.';
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          }
        }
      } else {
        // startResult failed — show error to user
        const startErrorMsg = startResult.data?.error || 'Failed to start processing.';
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Error while generating dashboard',
            timestamp: new Date(),
            isError: true,
          }
        ]));
      }
    } catch (error) {
      console.error('Processing error:', error);
      get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
      const errObj = error as Record<string, unknown>;
      const errDetail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const isInsufficientCredits =
        errObj?.status === 402 ||
        (errDetail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
        (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
      updateMessages((prev) => ([
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Error while generating dashboard',
          timestamp: new Date(),
          isError: true,
          isInsufficientCredits,
        }
      ]));
    } finally {
      setIsTyping(false);
      setIsProcessing(false);
      set({ isUpdatingDashboard: false, abortController: null });
    }
  },

  submitClarificationResponse: async (
    request: ClarificationRequest,
    option: ClarificationOption,
    freeText: string | undefined,
    projectId: string,
    onProcessedDataChange?: (data: unknown) => void,
    model?: 'pro' | 'fast',
    onAccepted?: () => void,
    onProjectNameAccepted?: (projectName: string) => void,
  ) => {
    const state = get();
    const {
      currentConversationId,
      setIsProcessing,
      setIsTyping,
      setCurrentWorkflowStep,
      setPriorWorkflowSteps,
      setCurrentConversationId,
      updateMessages,
	    } = state;
	    const promptTheme = getPendingPromptTheme(state);
	    const promptThemeId = getThemeId(promptTheme);
	    const promptAnalysisFocusId = getAnalysisFocusId(promptTheme);
	    const promptThemeMetadata = getPromptThemeMetadata(promptTheme);
	    if (!currentConversationId) {
	      throw new Error('Conversation context missing for clarification response');
	    }

    const abortController = new AbortController();
    set({ abortController, currentProjectId: projectId, thinkingEvents: [], priorWorkflowSteps: [] });
    setCurrentWorkflowStep(null);
    setPriorWorkflowSteps([]);

    const selectedAssetIds = getClarificationAssetIds(option);
    const selectionMode = option.metadata?.asset_selection || (selectedAssetIds.length > 0 ? 'explicit' : 'none');
    const clarificationAttachment = buildClarificationAttachment(option);
    const displayText = freeText
      ? `${option.label}\n${freeText}`
      : option.label;

    updateMessages((prev) => ([
      ...prev,
      {
        id: Date.now().toString(),
	        role: 'user',
	        content: displayText,
	        timestamp: new Date(),
	        attachment: clarificationAttachment,
	        template: promptTheme || undefined,
	      },
	    ]));

    setIsTyping(true);
    setIsProcessing(true);

    try {
	      const startResult = await processingService.runProcessing(
	        projectId,
	        null,
        displayText,
        currentConversationId,
        createClarificationResponseContents(request, option, freeText),
        {
	          asset_selection: selectionMode,
	          ...(selectedAssetIds.length > 0 ? { selected_asset_ids: selectedAssetIds } : {}),
	          clarification_id: request.clarification_id,
	          ...promptThemeMetadata,
	        },
	        model,
	        promptThemeId,
	        promptAnalysisFocusId,
	      );

      if (!(startResult.data?.success && (startResult.data.status === 'processing' || startResult.data.status === 'accepted'))) {
        throw new Error(startResult.data?.error || 'Failed to submit clarification response');
      }

      onAccepted?.();
      const acceptedProjectName = startResult.data?.project_name;
      if (typeof acceptedProjectName === 'string' && acceptedProjectName.trim()) {
        onProjectNameAccepted?.(acceptedProjectName.trim());
      }

      const conversationId = startResult.data?.conversation_id || currentConversationId;
      setCurrentConversationId(conversationId);

      const finalResult = await processingService.pollProcessingStatus(
        '',
        projectId,
        conversationId,
        (status) => {
          const workflowStatus = status.data?.workflow_status?.status;
          if (workflowStatus === 'error' || workflowStatus === 'stopped' || workflowStatus === 'awaiting_user_input') {
            setIsProcessing(false);
            setIsTyping(false);
          }
          const step = status.data?.workflow_status?.metadata?.step;
          if (step) {
            setCurrentWorkflowStep(step);
            setPriorWorkflowSteps(getPriorWorkflowSteps(step));
          }
        },
        360,
        5000,
        abortController.signal,
      );

	      if (finalResult.data?.success && finalResult.data?.status === 'completed') {
	        if (promptTheme) {
	          persistPendingThemeSelection(null);
	          set({ isThemePending: false, isTemplatePending: false });
	        }
	        const { conversationService } = await import('@/services/conversationService');
        const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
        const conversation = conversationResponse.conversation;
        const restoredMessages = conversationNodesToMessages(conversation);
        if (restoredMessages.length) {
          get().setMessages(restoredMessages);
        }
        const lastMsg = restoredMessages[restoredMessages.length - 1];
        const dashId = lastMsg?.dashboardCard?.dashboardId;
        if (dashId) {
          set({
            isDashboardOpen: true,
            hasShownInitialDashboard: true,
            isInitialLoading: false,
          });
          get().selectDashboard(dashId, projectId).then((data) => {
            if (data && onProcessedDataChange) {
              onProcessedDataChange(data);
            }
          });
        }
      } else if (finalResult.data?.success && finalResult.data?.status === 'awaiting_user_input') {
        const { conversationService } = await import('@/services/conversationService');
        const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
        const restoredMessages = conversationNodesToMessages(conversationResponse.conversation);
        if (restoredMessages.length) {
          get().setMessages(restoredMessages);
        }
      } else if (finalResult.data?.status === 'error' || !finalResult.success) {
        throw new Error(finalResult.data?.error || 'Clarification response processing failed');
      }
    } catch (error) {
      console.error('Clarification response error:', error);
      updateMessages((prev) => ([
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Error while processing your selection',
          timestamp: new Date(),
          isError: true,
        },
      ]));
    } finally {
      setIsTyping(false);
      setIsProcessing(false);
      set({ abortController: null });
    }
  },

  resumeWorkflowPolling: async (projectId: string, conversationId: string, onProcessedDataChange?: (data: unknown) => void) => {
    // Pre-check (synchronous): processFileWithMessage sets abortController synchronously
    // before its first await, so this catches concurrent fresh-start workflows
    if (get().abortController !== null || get().isProcessing) return;

    const { processingService } = await import('@/services/processingService');

    // Check if a workflow is actually in progress before doing anything
    const statusCheck = await processingService.getWorkflowStatus(conversationId, projectId);
    if (statusCheck.data?.status !== 'processing') {
      // Not actively processing (completed, error, stopped, starting/404) — nothing to resume
      return;
    }

    // Post-check: close the race window — processFileWithMessage may have started while
    // getWorkflowStatus was in-flight (abortController is set synchronously, isProcessing lags)
    if (get().abortController !== null || get().isProcessing) return;

    const { setIsProcessing, setIsTyping, setCurrentWorkflowStep, setCurrentConversationId } = get();

    // Seed the step display with whatever the backend currently reports
    const initialStep = statusCheck.data?.workflow_status?.metadata?.step;
    if (initialStep) {
      setCurrentWorkflowStep(initialStep);
      // Compute all steps that logically preceded this one so the UI can show them as completed
      set({ priorWorkflowSteps: getPriorWorkflowSteps(initialStep) });
    }

    const abortController = new AbortController();
    set({ abortController, isProcessing: true, isTyping: true });
    setCurrentConversationId(conversationId);

    try {
      const finalResult = await processingService.pollProcessingStatus(
        '',
        projectId,
        conversationId,
        (status) => {
          const workflowStatus = status.data?.workflow_status?.status;
          if (workflowStatus === 'error' || workflowStatus === 'stopped') {
            setIsProcessing(false);
            setIsTyping(false);
          }
          const step = status.data?.workflow_status?.metadata?.step;
          if (step) {
            setCurrentWorkflowStep(step);
            set({ priorWorkflowSteps: getPriorWorkflowSteps(step) });
          }
        },
        360,
        5000,
        abortController.signal
      );

      if (finalResult.data?.success && finalResult.data?.status === 'completed') {
        const { conversationService } = await import('@/services/conversationService');
        const { conversationNodesToMessages } = await import('@/chat/conversationToMessages');
        const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
        const conversation = conversationResponse.conversation;
        const restoredMessages = conversationNodesToMessages(conversation);
        if (restoredMessages.length) {
          get().setMessages(restoredMessages);
        }

        // Auto-open dashboard if the latest message has a dashboard card
        const lastMsg = restoredMessages[restoredMessages.length - 1];
        const dashId = lastMsg?.dashboardCard?.dashboardId;
        if (dashId) {
          const restoredThemeOnResume = resolveStoredTheme(getThemeIdForDashboard(dashId), null, getLegacyTemplateIdForDashboard(dashId));
          set({
            selectedDashboardId: dashId,
            isDashboardOpen: true,
            hasShownInitialDashboard: true,
            isInitialLoading: false,
            selectedTheme: restoredThemeOnResume,
            selectedAnalysisFocusId: restoredThemeOnResume?.analysisFocusId ?? null,
            selectedTemplate: restoredThemeOnResume,
            isThemePending: false,
            isTemplatePending: false,
          });
          get().selectDashboard(dashId, projectId).then((data) => {
            if (data && onProcessedDataChange) onProcessedDataChange(data);
          });
        } else if (finalResult.data?.dashboard_data && onProcessedDataChange) {
          onProcessedDataChange(finalResult.data.dashboard_data);
        }
      }
    } catch (error) {
      console.error('Failed to resume workflow polling:', error);
    } finally {
      setIsTyping(false);
      setIsProcessing(false);
      set({ abortController: null });
    }
  },

  stopGeneration: async () => {
    const state = get();
    const { abortController, currentConversationId, setIsProcessing, setIsTyping } = state;

    // Abort the polling if controller exists
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }

    if (currentConversationId) {
      try {
        const projectId = state.currentProjectId || state.uploadedFiles[0]?.projectId;
        if (projectId) {
          const { conversationService } = await import('@/services/conversationService');
          await conversationService.stopWorkflow(currentConversationId, projectId);
        }
      } catch (error) {
        console.error('Failed to stop workflow:', error);
      }
    }

    // Clear abort controller and update state
    set({
      abortController: null,
      isProcessing: false,
      isTyping: false,
    });
  },

  resetChat: (preserveTemplate = false) => {
    if (!preserveTemplate) {
      persistPendingThemeSelection(null);
    }
    const preservedTheme = preserveTemplate ? (get().selectedTheme || get().selectedTemplate) : null;
    set({
      inputValue: "",
      isTyping: false,
      messages: initialMessages,
      uploadedFiles: [],
      currentConversationId: null,
      currentProjectId: null,
      isProcessing: false,
      currentWorkflowStep: null,
      priorWorkflowSteps: [],
      thinkingEvents: [],
      dropdownOpen: false,
      selectedDataSource: "",
      isListening: false,
      transcript: "",
      detectedLanguage: null,
      selectedDashboardId: null,
      selectedTheme: preservedTheme,
      selectedAnalysisFocusId: preservedTheme?.analysisFocusId ?? null,
      selectedTemplate: preservedTheme,
      isThemePending: preserveTemplate ? get().isThemePending : false,
      isTemplatePending: preserveTemplate ? get().isTemplatePending : false,
      // We explicitly DO NOT clear integration modal states here
      // to preserve them across navigation/reloads during picking.
    });
  },

  selectDashboard: async (dashboardId: string, projectId: string): Promise<unknown> => {
    const { currentConversationId, updateFile } = get();
    if (!currentConversationId) return null;

    // Monotonic request id for cancel-and-replace: rapid clicks on different
    // dashboards must end with only the latest result applied. We stash the
    // counter on the module-scoped guard below.
    //
    // NOTE: We deliberately do NOT short-circuit when
    // `dashboardId === selectedDashboardId`. Several auto-open paths
    // (useChatStore lines ~1131, 1520, 1686) call `set({ selectedDashboardId })`
    // *before* invoking selectDashboard to fetch the data — short-circuiting
    // here would skip the fetch and leave the panel empty.
    selectDashboardSeq += 1;
    const myReq = selectDashboardSeq;

    set({ isSwitchingDashboard: true });
    try {
      const { conversationService } = await import('@/services/conversationService');
      const response = await conversationService.getDashboardData(
        currentConversationId,
        projectId,
        dashboardId
      );

      // A newer click superseded this one — discard.
      if (myReq !== selectDashboardSeq) return null;

      if (response?.dashboard_data) {
        // Prefer theme_id baked into the dashboard JSON, then legacy template_id,
        // then localStorage mappings for dashboards generated before this split.
        const serverThemeId = response.dashboard_data.theme_id as string | undefined;
        const serverFocusId = response.dashboard_data.analysis_focus_id as string | undefined;
        const serverTemplateId = response.dashboard_data.template_id as string | undefined;
        const resolvedTheme = serverThemeId ?? getThemeIdForDashboard(dashboardId);
        const restoredTheme = resolveStoredTheme(
          resolvedTheme,
          serverFocusId,
          serverTemplateId ?? getLegacyTemplateIdForDashboard(dashboardId),
        );
        if (restoredTheme?.suggestedTheme) saveDashboardThemeId(dashboardId, restoredTheme.suggestedTheme);
        persistPendingThemeSelection(null);
        set({
          selectedDashboardId: dashboardId,
          selectedTheme: restoredTheme,
          selectedAnalysisFocusId: restoredTheme?.analysisFocusId ?? null,
          selectedTemplate: restoredTheme,
          isThemePending: false,
          isTemplatePending: false,
        });
        // Update file only if one exists in store
        const files = get().uploadedFiles;
        if (files.length > 0) {
          updateFile(files[0].fileID, { processedData: response.dashboard_data });
        }
        return response.dashboard_data;
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      // Only the latest request can clear the flag — stale resolves must not
      // un-spin a still-running newer fetch.
      if (myReq === selectDashboardSeq) {
        set({ isSwitchingDashboard: false });
      }
    }
    return null;
  },
}));
